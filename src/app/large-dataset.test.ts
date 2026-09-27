/**
 * Large synthetic dataset (5,000+ transactions): every page's loader/model,
 * search and paging, the integrity audit and backup/restore stay correct.
 * Times here are for fake IndexedDB in Node and are only a smoke check; the
 * real measurements are taken in the browser (see the phase report).
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/db/dexie'
import { loadIntegritySnapshot } from '@/db/integrity-snapshot'
import { auditIntegrity } from '@/domain/integrity'
import { monthTotals } from '@/domain/reporting'
import { buildAnalyticsModel, loadAnalyticsData } from '@/features/analytics/analytics-data'
import { createBackup, replaceDatabase } from '@/features/backup/create-backup'
import { readBackup } from '@/features/backup/read-backup'
import { buildBudgetModel, loadBudgetData } from '@/features/budget/budget-data'
import { buildCalendarModel, loadCalendarData } from '@/features/calendar/calendar-data'
import { buildDashboardModel, loadDashboardData } from '@/features/dashboard/dashboard-data'
import { buildLedger, defaultFilters, loadLedgerData, PAGE_SIZE } from '@/features/transactions/ledger-data'
import { SYN_TODAY, seedSynthetic } from '@/test/synthetic'

const MONTH = '2026-09'
const timings: Record<string, number> = {}
async function timed<T>(label: string, run: () => Promise<T> | T): Promise<T> {
  const start = performance.now()
  const result = await run()
  timings[label] = Math.round(performance.now() - start)
  return result
}

beforeAll(async () => {
  await Promise.all(db.tables.map((table) => table.clear()))
  await seedSynthetic(db)
}, 120_000)

describe('large dataset', () => {
  it('has the required size and is clean by the integrity audit', async () => {
    const snapshot = await timed('audit snapshot', () => loadIntegritySnapshot(db))
    const report = await timed('audit', () => auditIntegrity(snapshot))
    expect(report.counts.transactions).toBeGreaterThanOrEqual(5_000)
    expect(report.counts.accounts + report.counts.categories).toBeGreaterThanOrEqual(100)
    expect(report.counts).toMatchObject({ recurring: 50, debts: 20, budgets: 100, attachments: 50, blobs: 50 })
    expect(report.issues.filter((i) => i.severity === 'error')).toEqual([])
  }, 60_000)

  it('dashboard, analytics, calendar and budget build and agree', async () => {
    const period = { month: MONTH, today: SYN_TODAY }
    const dashboard = await timed('dashboard', async () => buildDashboardModel(await loadDashboardData(period), period))
    const analytics = await timed('analytics', async () => buildAnalyticsModel(await loadAnalyticsData(MONTH), SYN_TODAY))
    const calendar = await timed('calendar', async () => buildCalendarModel(await loadCalendarData(MONTH), 'all', SYN_TODAY))
    const budget = await timed('budget', async () => buildBudgetModel(await loadBudgetData(), MONTH))
    const all = await db.transactions.toArray()
    const expected = monthTotals(all, MONTH)
    expect(dashboard.totals).toEqual(expected)
    expect(analytics.totals).toEqual(expected)
    expect(calendar.totals).toMatchObject({ moneyIn: expected.income, expenses: expected.expense, debtPayments: expected.debtPayment })
    expect(analytics.trend).toHaveLength(6)
    expect(analytics.categoryRows.reduce((sum, row) => sum + row.amount, 0)).toBe(expected.expense)
    expect(analytics.debts.lines).toHaveLength(20)
    expect(budget.rows).toHaveLength(20)
    expect(analytics.cash.available).toBe(dashboard.available.total)
  }, 60_000)

  it('the calendar reads only the selected month', async () => {
    const raw = await loadCalendarData(MONTH)
    const inMonth = await db.transactions.where('date').between(`${MONTH}-01`, `${MONTH}-31`, true, true).count()
    // Only the month's transactions (plus any paying one of its occurrences) — never the whole table.
    expect(raw.transactions.length).toBeGreaterThanOrEqual(inMonth)
    expect(raw.transactions.length).toBeLessThan(inMonth + 60)
    expect(raw.transactions.every((tx) => tx.date.startsWith(MONTH) || tx.scheduledPaymentId)).toBe(true)
  })

  it('ledger search, filters and "load more": no duplicate or missing rows', async () => {
    const raw = await timed('ledger load', () => loadLedgerData())
    const filters = { ...defaultFilters(SYN_TODAY), preset: 'custom' as const, customStart: '2025-01-01', customEnd: '2026-09-30' }
    const everything = await timed('ledger build (all)', () => buildLedger(raw, filters, SYN_TODAY, 100_000))
    const ids = everything.groups.flatMap((g) => g.rows.map((r) => r.id))
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe(raw.transactions.length)

    // Paging: each "load more" extends the same list, in the same order.
    const page1 = buildLedger(raw, filters, SYN_TODAY, PAGE_SIZE).groups.flatMap((g) => g.rows.map((r) => r.id))
    const page2 = buildLedger(raw, filters, SYN_TODAY, PAGE_SIZE * 2).groups.flatMap((g) => g.rows.map((r) => r.id))
    expect(page1).toHaveLength(PAGE_SIZE)
    expect(page2.slice(0, PAGE_SIZE)).toEqual(page1)
    expect(new Set(page2).size).toBe(PAGE_SIZE * 2)

    // Search (every term must appear): "บันทึก" is only ever in notes, so the matches are exactly the noted transactions.
    const search = await timed('ledger search', () => buildLedger(raw, { ...filters, search: 'บันทึก' }, SYN_TODAY, 100_000))
    const noted = raw.transactions
      .filter((tx) => tx.note?.includes('บันทึก'))
      .map((tx) => tx.id)
      .sort()
    expect(search.groups.flatMap((g) => g.rows.map((r) => r.id)).sort()).toEqual(noted)
    expect(noted.length).toBeGreaterThan(400)

    const expensesOnly = buildLedger(raw, { ...filters, type: 'expense' }, SYN_TODAY, 100_000)
    expect(expensesOnly.matchCount).toBe(raw.transactions.filter((tx) => tx.type === 'expense').length)
  }, 60_000)

  it('backup and restore round-trip the whole dataset', async () => {
    const before = JSON.stringify(await loadIntegritySnapshot(db))
    const backup = await timed('backup create', () => createBackup(db, `${SYN_TODAY}T03:00:00.000Z`))
    const text = await timed('backup stringify', () => JSON.stringify(backup))
    const prepared = await timed('restore validate', () => readBackup(text))
    await timed('restore write', () => replaceDatabase(db, prepared))
    const after = await loadIntegritySnapshot(db)
    const original = JSON.parse(before) as Record<string, unknown[]>
    const restored = after as unknown as Record<string, unknown[]>
    // Byte-identical per table (records are stored exactly as written in the file).
    expect(Object.keys(original).filter((table) => JSON.stringify(restored[table]) !== JSON.stringify(original[table]))).toEqual([])
    timings['backup size KB'] = Math.round(text.length / 1024)
  }, 120_000)
})
