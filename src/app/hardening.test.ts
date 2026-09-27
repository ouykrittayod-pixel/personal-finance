/**
 * Production-hardening regression suite: the same dataset read through every
 * page's own loader and view model must agree, month by month, before and
 * after a backup/restore. Uses the app's database (fake IndexedDB).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/dexie'
import { loadIntegritySnapshot } from '@/db/integrity-snapshot'
import { createScheduledPaymentsRepository, createTransactionsRepository } from '@/db/repositories'
import { calculateAvailableMoney } from '@/domain/accounts'
import { auditIntegrity } from '@/domain/integrity'
import { buildAnalyticsModel, loadAnalyticsData } from '@/features/analytics/analytics-data'
import { replaceDatabase } from '@/features/backup/create-backup'
import { BackupError } from '@/features/backup/format'
import { readBackup } from '@/features/backup/read-backup'
import { createBackup } from '@/features/backup/create-backup'
import { buildBudgetModel, formatUsage, loadBudgetData } from '@/features/budget/budget-data'
import { buildCalendarModel, loadCalendarData } from '@/features/calendar/calendar-data'
import { buildDashboardModel, loadDashboardData } from '@/features/dashboard/dashboard-data'
import { buildLedger, defaultFilters, loadLedgerData } from '@/features/transactions/ledger-data'
import { baht, makeTx } from '@/test/factories'
import { REP_NOW, REP_TODAY, seedRepresentative } from '@/test/representative'

const today = REP_TODAY

async function views(month: string, asOfToday = today) {
  const period = { month, today: asOfToday }
  const dashboard = buildDashboardModel(await loadDashboardData(period), period)
  const analytics = buildAnalyticsModel(await loadAnalyticsData(month), asOfToday)
  const calendar = buildCalendarModel(await loadCalendarData(month), 'all', asOfToday)
  const budget = buildBudgetModel(await loadBudgetData(), month)
  return { dashboard, analytics, calendar, budget }
}

const ledgerFor = async (month: string, search = '') => {
  const [year, m] = month.split('-').map(Number)
  const end = new Date(Date.UTC(year!, m!, 0)).getUTCDate()
  return buildLedger(
    await loadLedgerData(),
    { ...defaultFilters(today), preset: 'custom', customStart: `${month}-01`, customEnd: `${month}-${String(end).padStart(2, '0')}`, search },
    today,
    10_000,
  )
}

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()))
})

describe('accounting regression (September 2026)', () => {
  beforeEach(() => seedRepresentative(db))

  it('income ฿27,500 · expense ฿13,850 · debt payments ฿10,800 · transfer excluded · income − expense ฿13,650', async () => {
    const { dashboard, analytics, calendar } = await views('2026-09')
    expect(dashboard.totals).toMatchObject({ income: baht(27_500), expense: baht(13_850), debtPayment: baht(10_800) })
    expect(analytics.comparison.leftFromIncome.current).toBe(baht(13_650))
    expect(calendar.totals).toMatchObject({ moneyIn: baht(27_500), expenses: baht(13_850), debtPayments: baht(10_800), transfers: baht(5_000) })
    const ledger = await ledgerFor('2026-09')
    expect(ledger.summary).toMatchObject({ income: baht(27_500), expense: baht(13_850), debtPayment: baht(10_800) })
  })

  it('Analytics and Dashboard agree on income, expenses, debt payments and available money', async () => {
    const { dashboard, analytics } = await views('2026-09')
    expect(analytics.totals).toMatchObject({ income: dashboard.totals.income, expense: dashboard.totals.expense, debtPayment: dashboard.totals.debtPayment })
    expect(analytics.cash.available).toBe(dashboard.available.total)
    // KBank 50,000 + 27,500 − 7,800 (rent) − 5,000 − 7,800 − 3,000 ; Cash 5,000 + 5,000 − 2,500
    expect(dashboard.available.total).toBe(baht(53_900 + 7_500))
  })

  it('budget: Food ฿2,500 of ฿6,000 = 41.7% on #/budget, the Dashboard and #/analytics', async () => {
    const { budget, dashboard, analytics } = await views('2026-09')
    const food = budget.rows.find((row) => row.budget.categoryId === 'food')!
    expect(food.spent).toBe(baht(2_500))
    expect(formatUsage(food.usageBps!)).toBe('41.7%')
    expect(dashboard.budget).toMatchObject({ spent: baht(2_500), limit: baht(6_000), usageBps: food.usageBps })
    expect(analytics.budget.categories[0]).toMatchObject({ spent: baht(2_500), usageBps: food.usageBps })
  })

  it('calendar: unpaid Internet ฿899 is "กำหนดจ่าย", not an expense; paying it creates exactly one expense', async () => {
    const before = (await views('2026-09')).calendar
    const internet = before.agenda.flatMap((day) => day.items).find((item) => item.title === 'Internet')!
    expect(internet).toMatchObject({ date: '2026-09-28', kind: 'scheduled_expense', status: 'upcoming', amountSatang: baht(899) })
    expect(before.totals).toMatchObject({ expenses: baht(13_850), scheduledOut: baht(899) })

    const scheduled = createScheduledPaymentsRepository(db)
    const occurrence = (await scheduled.listForSource('obligation', 'net-rule')).find((p) => p.dueDate === '2026-09-28')!
    const draft = { type: 'expense' as const, amountSatang: baht(899), accountId: 'kbank', categoryId: 'internet', date: '2026-09-26' }
    const meta = { transactionId: 'net-paid', now: REP_NOW, newId: () => 'x' }
    await scheduled.markPaid(occurrence.id, draft, [], meta)
    // A repeated confirmation is recognised, never a second expense.
    expect((await scheduled.markPaid(occurrence.id, draft, [], meta)).status).toBe('already_paid')

    const after = (await views('2026-09')).calendar
    expect(after.totals).toMatchObject({ expenses: baht(13_850 + 899), scheduledOut: 0 })
    expect((await db.transactions.where('scheduledPaymentId').equals(occurrence.id).toArray()).map((tx) => tx.id)).toEqual(['net-paid'])
    expect(auditIntegrity(await loadIntegritySnapshot(db)).ok).toBe(true)
  })
})

describe('credit card and transfer regressions', () => {
  it('card purchase ฿1,200 + card payment ฿1,200: expense ฿1,200 (not ฿2,400), debt payment ฿1,200, card settled', async () => {
    await seedRepresentative(db)
    await db.transactions.bulkDelete(['shop', 'cardpay'])
    const transactions = createTransactionsRepository(db)
    const meta = (id: string) => ({ id, now: REP_NOW, newId: () => `${id}-a` })
    const before = (await views('2026-09')).dashboard.totals
    await transactions.create({ type: 'expense', amountSatang: baht(1_200), accountId: 'card', categoryId: 'shopping', date: '2026-09-10' }, [], meta('c1'))
    await transactions.create({ type: 'debt_payment', debtId: 'cc', amountSatang: baht(1_200), accountId: 'kbank', date: '2026-09-12' }, [], meta('c2'))
    const { dashboard, analytics } = await views('2026-09')
    expect(dashboard.totals.expense - before.expense).toBe(baht(1_200))
    expect(dashboard.totals.debtPayment - before.debtPayment).toBe(baht(1_200))
    expect(analytics.debts.lines.find((line) => line.debt.id === 'cc')?.outstanding).toBe(0)
  })

  it('transfer KBank ฿50,000 → Cash ฿5,000: available money unchanged, only the split moves', async () => {
    await seedRepresentative(db)
    const accounts = await db.accounts.toArray()
    const without = (await db.transactions.toArray()).filter((tx) => tx.id !== 'move')
    const withIt = await db.transactions.toArray()
    expect(calculateAvailableMoney(accounts, withIt).total).toBe(calculateAvailableMoney(accounts, without).total)
    const lines = (await views('2026-09')).analytics.cash.lines
    expect(lines.find((line) => line.account.id === 'cash')?.balance).toBe(baht(5_000 + 5_000 - 2_500))
  })
})

describe('history and future months', () => {
  beforeEach(async () => {
    await seedRepresentative(db)
    const extra = [
      ['2026-06', 20_000, 1_000],
      ['2026-07', 21_000, 2_000],
      ['2026-08', 22_000, 3_000],
      ['2026-10', 23_000, 4_000],
    ] as const
    await db.transactions.bulkAdd(
      extra.flatMap(([month, income, food]) => [
        makeTx({
          id: `in-${month}`,
          type: 'income',
          amountSatang: baht(income),
          accountId: 'kbank',
          categoryId: 'salary',
          date: `${month}-15`,
          createdAt: REP_NOW,
          updatedAt: REP_NOW,
        }),
        makeTx({
          id: `food-${month}`,
          type: 'expense',
          amountSatang: baht(food),
          accountId: 'cash',
          categoryId: 'food',
          date: `${month}-28`,
          createdAt: REP_NOW,
          updatedAt: REP_NOW,
        }),
      ]),
    )
  })

  it('each month shows only its own transactions on every page (no leakage)', async () => {
    const expected: Record<string, [number, number]> = {
      '2026-06': [20_000, 1_000],
      '2026-07': [21_000, 2_000],
      '2026-08': [22_000, 3_000],
      '2026-09': [27_500, 13_850],
      '2026-10': [23_000, 4_000],
    }
    for (const [month, [income, expense]] of Object.entries(expected)) {
      const { dashboard, analytics, calendar } = await views(month)
      const totals = { income: baht(income), expense: baht(expense) }
      expect({ month, ...dashboard.totals }).toMatchObject({ month, ...totals })
      expect({ month, ...analytics.totals }).toMatchObject({ month, ...totals })
      expect({ month, ...calendar.totals }).toMatchObject({ month, moneyIn: totals.income, expenses: totals.expense })
      expect({ month, ...(await ledgerFor(month)).summary }).toMatchObject({ month, ...totals })
    }
  })

  it('historical balances and debt values are as of each month end', async () => {
    // Accounts opened 1 Aug: June/July transactions are before the opening balance (already included in it).
    const august = (await views('2026-08')).analytics
    expect(august.cash.available).toBe(baht(50_000 + 22_000 + 5_000 - 3_000))
    expect(august.debts.totalOutstanding).toBe(baht(1_200_000))
    const september = (await views('2026-09')).analytics
    expect(september.debts.totalOutstanding).toBe(baht(1_194_000 + 550))
    const snapshot = auditIntegrity(await loadIntegritySnapshot(db))
    expect(snapshot.ok).toBe(true)
    expect(
      snapshot.issues
        .filter((i) => i.code === 'before_account_opening')
        .map((i) => i.id)
        .sort(),
    ).toEqual(['food-2026-06', 'food-2026-07', 'in-2026-06', 'in-2026-07'])
  })

  it('future months: occurrences only inside the 3-month window; actual data beyond it still shows', async () => {
    await db.transactions.add(
      makeTx({
        id: 'jan',
        type: 'income',
        amountSatang: baht(1_000),
        accountId: 'kbank',
        categoryId: 'salary',
        date: '2027-01-10',
        createdAt: REP_NOW,
        updatedAt: REP_NOW,
      }),
    )
    const scheduledIn = async (month: string) =>
      (await views(month)).calendar.agenda
        .flatMap((day) => day.items)
        .filter((item) => item.kind === 'scheduled_expense')
        .map((item) => `${item.title} ${item.date}`)
        .sort()
    expect(await scheduledIn('2026-10')).toEqual(['Internet 2026-10-28', 'Rent 2026-10-06'])
    expect(await scheduledIn('2026-11')).toEqual(['Internet 2026-11-28', 'Rent 2026-11-06'])
    // The window ends 2026-12-26: Rent on the 6th is generated, Internet on the 28th not yet.
    expect(await scheduledIn('2026-12')).toEqual(['Rent 2026-12-06'])
    expect(await scheduledIn('2027-01')).toEqual([])
    const january = await views('2027-01')
    expect(january.calendar.totals.moneyIn).toBe(baht(1_000))
    expect(january.dashboard.totals.income).toBe(baht(1_000))
    expect(january.analytics.totals.income).toBe(baht(1_000))
  })
})

describe('backup / restore regression', () => {
  it('backup → change → restore → every page and the audit match; restoring twice changes nothing', async () => {
    await seedRepresentative(db)
    const before = await views('2026-09')
    const text = JSON.stringify(await createBackup(db, REP_NOW))
    await createTransactionsRepository(db).delete('food', { now: REP_NOW })
    await db.accounts.add({ ...(await db.accounts.get('cash'))!, id: 'test', name: 'Test Account' })
    expect((await views('2026-09')).dashboard.totals.expense).toBe(baht(13_850 - 2_500))

    await replaceDatabase(db, readBackup(text))
    const after = await views('2026-09')
    expect(after.dashboard.totals).toEqual(before.dashboard.totals)
    expect(after.dashboard.available).toEqual(before.dashboard.available)
    expect(after.analytics.insightTexts).toEqual(before.analytics.insightTexts)
    expect(after.calendar.totals).toEqual(before.calendar.totals)
    expect(after.budget.rows.map((r) => [r.budget.id, r.spent, r.usageBps])).toEqual(before.budget.rows.map((r) => [r.budget.id, r.spent, r.usageBps]))
    expect(await db.accounts.get('test')).toBeUndefined()
    const [attachment] = await db.attachments.where('transactionId').equals('food').toArray()
    expect((await db.attachmentBlobs.get(attachment!.id))?.blob.size).toBe(attachment!.sizeBytes)
    expect(auditIntegrity(await loadIntegritySnapshot(db)).ok).toBe(true)

    const once = JSON.stringify(await loadIntegritySnapshot(db))
    await replaceDatabase(db, readBackup(text))
    expect(JSON.stringify(await loadIntegritySnapshot(db))).toBe(once)
  })

  it('an invalid backup leaves the database unchanged', async () => {
    await seedRepresentative(db)
    const before = JSON.stringify(await loadIntegritySnapshot(db))
    const text = JSON.stringify(await createBackup(db, REP_NOW)).replace('"accountId":"cash"', '"accountId":"nowhere"')
    expect(() => readBackup(text)).toThrow(BackupError)
    expect(() => readBackup('{')).toThrow(BackupError)
    expect(JSON.stringify(await loadIntegritySnapshot(db))).toBe(before)
  })
})
