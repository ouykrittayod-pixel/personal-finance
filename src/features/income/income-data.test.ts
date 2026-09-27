import { describe, expect, it } from 'vitest'
import { buildDashboardModel, type DashboardRawData } from '@/features/dashboard/dashboard-data'
import { buildRecurringModel } from '@/features/recurring/recurring-data'
import { baht, makeAccount, makeCategory, makeObligation, makeScheduled, makeTx } from '@/test/factories'
import { ALL, buildIncomeModel, defaultIncomeFilters, type IncomeFilters, type IncomeRawData } from './income-data'

const TODAY = '2026-09-26'
const accounts = [makeAccount({ id: 'kbank', name: 'KBank', kind: 'bank' }), makeAccount({ id: 'scb', name: 'SCB', kind: 'bank' }), makeAccount({ id: 'cash', name: 'เงินสด', kind: 'cash' })]
const categories = [
  makeCategory({ id: 'salary', name: 'เงินเดือน', kind: 'income', icon: '💼', sortOrder: 0 }),
  makeCategory({ id: 'side', name: 'รายได้เสริม', kind: 'income', sortOrder: 1 }),
  makeCategory({ id: 'food', name: 'อาหาร', kind: 'expense' }),
]
const transactions = [
  makeTx({ id: 'salary', type: 'income', amountSatang: baht(27_500), accountId: 'kbank', categoryId: 'salary', date: '2026-09-25', description: 'เงินเดือน กันยายน' }),
  makeTx({ id: 'free', type: 'income', amountSatang: baht(5_000), accountId: 'scb', categoryId: 'side', date: '2026-09-10', description: 'Freelance' }),
  makeTx({ id: 'bonus', type: 'income', amountSatang: baht(10_000), accountId: 'kbank', categoryId: 'salary', date: '2026-09-12', description: 'โบนัส' }),
  makeTx({ id: 'aug', type: 'income', amountSatang: baht(27_500), accountId: 'kbank', categoryId: 'salary', date: '2026-08-25', description: 'เงินเดือน สิงหาคม' }),
  makeTx({ id: 'move', type: 'transfer', amountSatang: baht(5_000), accountId: 'kbank', toAccountId: 'cash', date: '2026-09-26' }),
  makeTx({ id: 'lunch', type: 'expense', amountSatang: baht(85), accountId: 'cash', categoryId: 'food', date: '2026-09-26' }),
]
const rule = makeObligation({ id: 'sal', name: 'เงินเดือน', kind: 'income', categoryId: 'salary', defaultAccountId: 'kbank', expectedAmountSatang: baht(27_500) })
const rent = makeObligation({ id: 'rent', name: 'ค่าเช่า', categoryId: 'home', defaultAccountId: 'kbank', expectedAmountSatang: baht(7_800) })
const payments = [
  makeScheduled({ id: 'p-sal', sourceId: 'sal', dueDate: '2026-09-25', expectedAmountSatang: baht(27_500) }),
  makeScheduled({ id: 'p-rent', sourceId: 'rent', dueDate: '2026-09-27', expectedAmountSatang: baht(7_800) }),
]
const raw: IncomeRawData = { transactions, accounts, categories, debts: [], transactionIdsWithAttachments: new Set(['free']), obligations: [rule, rent], payments }
const build = (overrides: Partial<IncomeFilters> = {}, data = raw) => buildIncomeModel(data, { ...defaultIncomeFilters(TODAY), ...overrides }, TODAY, 50)
const ids = (model: ReturnType<typeof build>) => model.groups.flatMap((g) => g.rows.map((r) => r.id))

describe('buildIncomeModel', () => {
  it('this month by default: income only, newest first, grouped by date; never the transfer or expense', () => {
    const model = build()
    expect(ids(model)).toEqual(['salary', 'bonus', 'free'])
    expect(model.summary).toEqual({ total: baht(42_500), count: 3, average: 1_416_667 })
    expect(model.groups[0]).toMatchObject({ date: '2026-09-25' })
    expect(model.groups.flatMap((g) => g.rows).find((r) => r.id === 'free')).toMatchObject({ categoryLabel: 'รายได้เสริม', accountLabel: 'SCB', hasAttachment: true, type: 'income' })
  })

  it('periods use the transaction date (a past month excludes later income)', () => {
    const august = build({ preset: 'custom', customStart: '2026-08-01', customEnd: '2026-08-31' })
    expect(ids(august)).toEqual(['aug'])
    expect(build({ preset: 'today' }).emptyReason).toBe('no_match')
    // A reversed custom range is swapped, as on Transactions.
    const reversed = build({ preset: 'custom', customStart: '2026-09-30', customEnd: '2026-09-01' })
    expect(reversed.rangeReversed).toBe(true)
    expect(ids(reversed)).toHaveLength(3)
  })

  it('searches description, category and account names', () => {
    expect(ids(build({ search: 'free' }))).toEqual(['free'])
    expect(ids(build({ search: 'รายได้เสริม' }))).toEqual(['free'])
    expect(ids(build({ search: 'scb' }))).toEqual(['free'])
    expect(build({ search: 'ไม่มีแน่นอน' }).emptyReason).toBe('no_match')
  })

  it('filters by income category and by account; the summary follows the filters', () => {
    const salaryOnly = build({ categoryId: 'salary' })
    expect(ids(salaryOnly)).toEqual(['salary', 'bonus'])
    expect(salaryOnly.summary.total).toBe(baht(37_500))
    expect(ids(build({ accountId: 'scb' }))).toEqual(['free'])
    expect(build().categoryOptions.map((o) => o.value)).toEqual([ALL, 'salary', 'side'])
    expect(build().accountOptions.map((o) => o.value)).toEqual([ALL, 'kbank', 'scb', 'cash'])
  })

  it('an empty state only when there is no income at all', () => {
    const none = build({}, { ...raw, transactions: transactions.filter((tx) => tx.type !== 'income') })
    expect(none.emptyReason).toBe('no_data')
    expect(none.summary).toEqual({ total: 0, count: 0, average: null })
  })

  it('lists recurring income rules only (not bills) with their next occurrence', () => {
    const [row] = build().rules
    expect(build().rules).toHaveLength(1)
    expect(row).toMatchObject({ id: 'sal', name: 'เงินเดือน', icon: '💼', accountLabel: 'KBank', status: { kind: 'overdue', label: 'เลยกำหนดรับ 1 วัน' } })
    expect(build({}, { ...raw, obligations: [{ ...rule, archivedAt: 'x' }, rent] }).rules).toEqual([])
  })
})

describe('expected income stays out of payment views', () => {
  it('the Recurring page lists bills, not income rules', () => {
    const model = buildRecurringModel({ obligations: [rule, rent], payments, categories, accounts, debts: [] }, { filter: 'all', search: '' }, TODAY)
    expect(model.rows.map((r) => r.id)).toEqual(['rent'])
    expect(model.summary.due).toBe(baht(7_800))
  })

  it('the Dashboard shows income in รายรับ and never as a payment to make', () => {
    const data: DashboardRawData = { accounts, categories, transactions, debts: [], obligations: [rule, rent], pendingPayments: payments, transactionIdsWithAttachments: new Set() }
    const model = buildDashboardModel(data, { month: '2026-09', today: TODAY })
    expect(model.totals.income).toBe(baht(42_500))
    expect(model.upcoming.items.map((i) => i.name)).toEqual(['ค่าเช่า'])
    expect(model.cashFlow.at(-1)).toMatchObject({ income: baht(42_500), transfer: baht(5_000), expense: baht(85) })
    const august = buildDashboardModel(data, { month: '2026-08', today: TODAY })
    expect(august.totals.income).toBe(baht(27_500))
  })
})

describe('Transactions integration', () => {
  it('the ledger’s รายรับ filter shows income and never the transfer', async () => {
    const { buildLedger, defaultFilters } = await import('@/features/transactions/ledger-data')
    const ledger = buildLedger(raw, { ...defaultFilters(TODAY), type: 'income' }, TODAY, 50)
    expect(ledger.groups.flatMap((g) => g.rows.map((r) => r.id))).toEqual(['salary', 'bonus', 'free'])
    expect(ledger.summary).toMatchObject({ income: baht(42_500), incomeCount: 3 })
  })
})
