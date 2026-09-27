import { describe, expect, it } from 'vitest'
import { OTHER_CATEGORIES, UNCATEGORIZED } from '@/domain/reporting'
import { baht, makeAccount, makeCategory, makeDebt, makeObligation, makeScheduled, makeTx } from '@/test/factories'
import { buildDashboardModel, upcomingWindow, type DashboardRawData } from './dashboard-data'

const period = { month: '2026-09', today: '2026-09-25' }

function raw(overrides: Partial<DashboardRawData> = {}): DashboardRawData {
  return {
    accounts: [],
    categories: [],
    transactions: [],
    debts: [],
    obligations: [],
    pendingPayments: [],
    transactionIdsWithAttachments: new Set(),
    ...overrides,
  }
}

describe('buildDashboardModel — empty database', () => {
  it('produces zeros and empty lists, flagged as empty', () => {
    const model = buildDashboardModel(raw(), period)
    expect(model.isEmpty).toBe(true)
    expect(model.isCurrentMonth).toBe(true)
    expect(model.available).toEqual({ total: 0, accountCount: 0 })
    expect(model.totals.income).toBe(0)
    expect(model.totals.expense).toBe(0)
    expect(model.upcoming).toEqual({ total: 0, count: 0, overdueCount: 0, items: [] })
    expect(model.spending).toEqual({ total: 0, slices: [] })
    expect(model.cashFlow).toHaveLength(6)
    expect(model.cashFlow.every((p) => p.income === 0 && p.expense === 0 && p.debtPayment === 0)).toBe(true)
    expect(model.recent).toEqual([])
    expect(model.debt).toEqual({ totalOutstanding: 0, activeCount: 0, top: [], progress: null })
  })
})

describe('buildDashboardModel — credit card purchase and payment', () => {
  const bank = makeAccount({ id: 'bank', name: 'KBank', kind: 'bank', openingBalanceSatang: baht(20_000) })
  const card = makeAccount({ id: 'card', name: 'บัตรเครดิต', kind: 'credit_card' })
  const food = makeCategory({ id: 'food', name: 'อาหาร', icon: '🍚' })
  const ccDebt = makeDebt({ id: 'cc', name: 'บัตรเครดิต KBank', kind: 'credit_card', linkedAccountId: 'card' })
  const data = raw({
    accounts: [bank, card],
    categories: [food],
    debts: [ccDebt],
    transactions: [
      makeTx({ id: 'salary', type: 'income', amountSatang: baht(27_500), accountId: 'bank', date: '2026-09-01', payee: 'เงินเดือน' }),
      makeTx({ id: 'buy', type: 'expense', amountSatang: baht(2_500), accountId: 'card', categoryId: 'food', date: '2026-09-10' }),
      makeTx({ id: 'pay', type: 'debt_payment', amountSatang: baht(2_500), accountId: 'bank', toAccountId: 'card', debtId: 'cc', date: '2026-09-20' }),
    ],
  })
  const model = buildDashboardModel(data, period)

  it('counts the purchase as spending exactly once', () => {
    expect(model.totals.expense).toBe(baht(2_500))
    expect(model.totals.expenseCount).toBe(1)
    expect(model.totals.debtPayment).toBe(baht(2_500))
    expect(model.spending.total).toBe(baht(2_500))
  })

  it('keeps the payment in its own cash-flow series', () => {
    const september = model.cashFlow.at(-1)
    expect(september).toEqual({ month: '2026-09', income: baht(27_500), expense: baht(2_500), debtPayment: baht(2_500), transfer: 0 })
  })

  it('reduces the bank balance by the payment and clears the card debt', () => {
    expect(model.available).toEqual({ total: baht(20_000 + 27_500 - 2_500), accountCount: 1 })
    expect(model.debt.totalOutstanding).toBe(0)
    expect(model.debt.activeCount).toBe(1)
  })

  it('describes recent rows with names from categories and accounts', () => {
    expect(model.recent.map((r) => r.id)).toEqual(['pay', 'buy', 'salary'])
    expect(model.recent[0]).toMatchObject({ type: 'debt_payment', title: 'ชำระบัตรเครดิต KBank', accountLabel: 'KBank', toAccountLabel: 'บัตรเครดิต' })
    expect(model.recent[1]).toMatchObject({ title: 'อาหาร', categoryLabel: 'อาหาร', categoryIcon: '🍚', accountLabel: 'บัตรเครดิต' })
    expect(model.recent[2]).toMatchObject({ title: 'เงินเดือน', type: 'income' })
  })
})

describe('buildDashboardModel — month switching', () => {
  const data = raw({
    accounts: [makeAccount({ id: 'cash', kind: 'cash' })],
    transactions: [
      makeTx({ type: 'income', amountSatang: baht(1_000), accountId: 'cash', date: '2026-08-05' }),
      makeTx({ type: 'expense', amountSatang: baht(300), accountId: 'cash', date: '2026-08-06' }),
      makeTx({ type: 'expense', amountSatang: baht(50), accountId: 'cash', date: '2026-09-06' }),
    ],
  })

  it('scopes income, expenses, categories and cash flow to the selected month', () => {
    const september = buildDashboardModel(data, period)
    const august = buildDashboardModel(data, { ...period, month: '2026-08' })
    expect(september.totals).toMatchObject({ income: 0, expense: baht(50) })
    expect(august.totals).toMatchObject({ income: baht(1_000), expense: baht(300) })
    expect(august.isCurrentMonth).toBe(false)
    expect(august.spending.total).toBe(baht(300))
    expect(august.cashFlow.at(-1)?.month).toBe('2026-08')
    expect(september.cashFlow.map((p) => p.month)).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'])
  })

  it('shows available money as of the month-end for a past month (labelled), today for the current month', () => {
    const august = buildDashboardModel(data, { ...period, month: '2026-08' })
    expect(august.available.total).toBe(baht(700))
    expect(august.availableAsOf).toBe('2026-08-31')
    const september = buildDashboardModel(data, period)
    expect(september.available.total).toBe(baht(650))
    expect(september).not.toHaveProperty('availableAsOf')
  })

  it('leaves out accounts not yet opened in a past month', () => {
    const later = raw({ accounts: [makeAccount({ id: 'k', kind: 'bank', openingDate: '2026-09-01', openingBalanceSatang: baht(50_000) })] })
    expect(buildDashboardModel(later, { ...period, month: '2026-08' }).available).toEqual({ total: 0, accountCount: 0 })
    expect(buildDashboardModel(later, period).available).toEqual({ total: baht(50_000), accountCount: 1 })
  })
})

describe('buildDashboardModel — categories', () => {
  it('names, colours and groups category slices', () => {
    const cats = ['a', 'b', 'c', 'd', 'e'].map((id, i) => makeCategory({ id, name: `หมวด ${id}`, sortOrder: i }))
    cats[0]!.color = '#123456'
    const model = buildDashboardModel(
      raw({
        categories: cats,
        transactions: [
          ...cats.map((c, i) => makeTx({ type: 'expense', amountSatang: baht(600 - i * 100), accountId: 'x', categoryId: c.id })),
          makeTx({ type: 'expense', amountSatang: baht(50), accountId: 'x' }),
        ],
      }),
      period,
    )
    const slices = model.spending.slices
    expect(slices.map((s) => s.key)).toEqual(['a', 'b', 'c', 'd', OTHER_CATEGORIES])
    expect(slices[0]).toMatchObject({ label: 'หมวด a', color: '#123456' })
    expect(slices[1]?.color).toBe('var(--chart-1)')
    expect(slices[4]).toMatchObject({ label: 'อื่น ๆ', amount: baht(200 + 50) })
    expect(slices.reduce((acc, s) => acc + s.shareBps, 0)).toBe(10_000)
  })

  it('labels uncategorized spending', () => {
    const model = buildDashboardModel(raw({ transactions: [makeTx({ type: 'expense', amountSatang: baht(10), accountId: 'x' })] }), period)
    expect(model.spending.slices[0]).toMatchObject({ key: UNCATEGORIZED, label: 'ไม่ระบุหมวดหมู่' })
  })
})

describe('buildDashboardModel — upcoming payments', () => {
  it('extends the window past month end by the due-soon days', () => {
    expect(upcomingWindow(period)).toEqual({ until: '2026-10-02', dueSoonUntil: '2026-10-02' })
    expect(upcomingWindow({ month: '2026-10', today: '2026-09-25' }).until).toBe('2026-10-31')
  })

  it('names payments from obligations and debts, totals all, lists at most five', () => {
    const rent = makeObligation({ id: 'rent', name: 'ค่าบ้าน' })
    const loan = makeDebt({ id: 'loan', name: 'ผ่อนรถ' })
    const pending = [
      makeScheduled({ sourceId: 'rent', dueDate: '2026-09-20', expectedAmountSatang: baht(7_700) }),
      makeScheduled({ sourceType: 'debt', sourceId: 'loan', dueDate: '2026-09-28', expectedAmountSatang: baht(9_000) }),
      ...Array.from({ length: 5 }, (_, i) =>
        makeScheduled({ sourceId: 'rent', dueDate: `2026-09-2${i + 5}`, expectedAmountSatang: baht(100) }),
      ),
    ]
    const model = buildDashboardModel(raw({ obligations: [rent], debts: [loan], pendingPayments: pending }), period)
    expect(model.upcoming.count).toBe(7)
    expect(model.upcoming.total).toBe(baht(7_700 + 9_000 + 500))
    expect(model.upcoming.overdueCount).toBe(1)
    expect(model.upcoming.items).toHaveLength(5)
    expect(model.upcoming.items[0]).toMatchObject({ name: 'ค่าบ้าน', status: 'overdue', amount: baht(7_700) })
    expect(model.upcoming.items.find((i) => i.sourceType === 'debt')).toMatchObject({ name: 'ผ่อนรถ', status: 'due_soon' })
  })
})

describe('buildDashboardModel — debt summary', () => {
  it('reports outstanding, active count, top debts and progress', () => {
    const debts = [
      makeDebt({ id: 'car', name: 'ผ่อนรถ', openingBalanceSatang: baht(300_000) }),
      makeDebt({ id: 'phone', name: 'ผ่อนโทรศัพท์', openingBalanceSatang: baht(30_000) }),
      makeDebt({ id: 'home', name: 'บ้าน', openingBalanceSatang: baht(2_000_000) }),
      makeDebt({ id: 'tv', name: 'ทีวี', openingBalanceSatang: baht(10_000) }),
      makeDebt({ id: 'done', name: 'ปิดแล้ว', status: 'paid_off', openingBalanceSatang: baht(1) }),
    ]
    const model = buildDashboardModel(
      raw({
        debts,
        transactions: [makeTx({ type: 'debt_payment', amountSatang: baht(40_000), principalSatang: baht(40_000), interestSatang: baht(0), feeSatang: baht(0), accountId: 'bank', debtId: 'car' })],
      }),
      period,
    )
    expect(model.debt.activeCount).toBe(4)
    expect(model.debt.totalOutstanding).toBe(baht(2_300_000))
    expect(model.debt.top.map((d) => d.name)).toEqual(['บ้าน', 'ผ่อนรถ', 'ผ่อนโทรศัพท์'])
    expect(model.debt.progress).toEqual({ original: baht(2_340_000), paid: baht(40_000), paidBps: 171 })
  })
})

describe('buildDashboardModel — debts over time', () => {
  const loan = makeDebt({ id: 'car', name: 'ผ่อนรถ', openingBalanceSatang: baht(300_000), openingDate: '2026-01-01' })
  const paid = (date: string) =>
    makeTx({ type: 'debt_payment', amountSatang: baht(10_000), principalSatang: baht(9_000), interestSatang: baht(1_000), feeSatang: baht(0), accountId: 'bank', debtId: 'car', date })
  const data = raw({ debts: [loan], transactions: [paid('2026-08-05'), paid('2026-09-05')] })

  it('a past month shows that month-end balance, labelled with its date — not today’s balance', () => {
    const august = buildDashboardModel(data, { month: '2026-08', today: '2026-09-25' })
    expect(august.debt).toMatchObject({ asOf: '2026-08-31', totalOutstanding: baht(291_000) })
    const september = buildDashboardModel(data, period)
    expect(september.debt.totalOutstanding).toBe(baht(282_000))
    expect(september.debt).not.toHaveProperty('asOf')
  })

  it('never counts a debt payment as an expense', () => {
    const model = buildDashboardModel(data, period)
    expect(model.totals.expense).toBe(0)
    expect(model.totals.debtPayment).toBe(baht(10_000))
  })
})

describe('buildDashboardModel — budget headline', () => {
  const b = (categoryId: string, limit: number, month = '2026-09') => ({ id: `${month}-${categoryId}`, month, categoryId, limitSatang: baht(limit), createdAt: 'c', updatedAt: 'u' })
  const txs = [
    makeTx({ type: 'expense', amountSatang: baht(2_500), accountId: 'cash', categoryId: 'food', date: '2026-09-03' }),
    makeTx({ type: 'debt_payment', amountSatang: baht(7_800), accountId: 'cash', debtId: 'home', date: '2026-09-05' }),
    makeTx({ type: 'transfer', amountSatang: baht(5_000), accountId: 'cash', toAccountId: 'bank', date: '2026-09-06' }),
  ]

  it('is null without budgets (the Dashboard stays as it was)', () => {
    expect(buildDashboardModel(raw({ transactions: txs }), period).budget).toBeNull()
  })

  it('uses the same budget arithmetic: expenses only, overall limit preferred over the category sum', () => {
    const categories = buildDashboardModel(raw({ transactions: txs, budgets: [b('food', 6_000)] }), period).budget
    expect(categories).toEqual({ scope: 'categories', limit: baht(6_000), spent: baht(2_500), usageBps: 4_166, status: 'under_budget' })
    const overall = buildDashboardModel(raw({ transactions: txs, budgets: [b('food', 6_000), b('__overall', 25_000)] }), period).budget
    expect(overall).toMatchObject({ scope: 'overall', limit: baht(25_000), spent: baht(2_500) })
  })
})
