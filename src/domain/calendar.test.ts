import { describe, expect, it } from 'vitest'
import { baht, makeObligation, makeScheduled, makeTx } from '@/test/factories'
import { buildCalendarItems, calendarTotals, groupByDay, matchesCalendarFilter, monthGrid, type CalendarSources } from './calendar'
import type { ScheduledPayment, Transaction } from './entities'
import { monthTotals } from './reporting'

const TODAY = '2026-09-12'
const internet = makeObligation({ id: 'net', name: 'อินเทอร์เน็ต', categoryId: 'bills', defaultAccountId: 'kbank', expectedAmountSatang: baht(899) })
const rent = makeObligation({ id: 'rent', name: 'ค่าเช่า', categoryId: 'home', defaultAccountId: 'kbank', expectedAmountSatang: baht(7_800) })
const salary = makeObligation({ id: 'sal', name: 'เงินเดือน', kind: 'income', categoryId: 'salary', defaultAccountId: 'kbank', expectedAmountSatang: baht(27_500) })
const cardBill = makeObligation({ id: 'ccbill', name: 'บิลบัตร', debtId: 'cc', defaultAccountId: 'kbank', expectedAmountSatang: baht(3_000) })

const payments: ScheduledPayment[] = [
  makeScheduled({ id: 'p-net-10', sourceId: 'net', dueDate: '2026-09-10', expectedAmountSatang: baht(899) }), // overdue
  makeScheduled({ id: 'p-net-15', sourceId: 'net', dueDate: '2026-09-15', expectedAmountSatang: baht(899) }), // upcoming
  makeScheduled({ id: 'p-rent', sourceId: 'rent', dueDate: '2026-09-06', expectedAmountSatang: baht(7_800), status: 'paid', transactionId: 'rent-paid', paidDate: '2026-09-06' }),
  makeScheduled({ id: 'p-sal', sourceId: 'sal', dueDate: '2026-09-30', expectedAmountSatang: baht(27_500) }), // expected income
  makeScheduled({ id: 'p-home', sourceType: 'debt', sourceId: 'home', dueDate: '2026-09-25', expectedAmountSatang: baht(7_800) }),
  makeScheduled({ id: 'p-skip', sourceId: 'net', dueDate: '2026-09-20', expectedAmountSatang: baht(899), status: 'skipped' }),
  makeScheduled({ id: 'p-cc', sourceId: 'ccbill', dueDate: '2026-09-28', expectedAmountSatang: baht(3_000) }),
]
const transactions: Transaction[] = [
  makeTx({ id: 'food', type: 'expense', amountSatang: baht(450), accountId: 'cash', categoryId: 'food', date: '2026-09-10', description: 'อาหาร' }),
  makeTx({ id: 'shoes', type: 'expense', amountSatang: baht(1_200), accountId: 'card', categoryId: 'shopping', date: '2026-09-15', description: 'รองเท้า' }),
  makeTx({ id: 'move', type: 'transfer', amountSatang: baht(5_000), accountId: 'kbank', toAccountId: 'cash', date: '2026-09-05' }),
  makeTx({ id: 'loan', type: 'debt_payment', amountSatang: baht(7_800), accountId: 'kbank', debtId: 'home', date: '2026-09-25' }),
  makeTx({ id: 'pay-card', type: 'debt_payment', amountSatang: baht(3_000), accountId: 'kbank', toAccountId: 'card', debtId: 'cc', date: '2026-09-27' }),
  makeTx({ id: 'wage', type: 'income', amountSatang: baht(27_500), accountId: 'kbank', categoryId: 'salary', date: '2026-09-30', description: 'เงินเดือน' }),
  makeTx({ id: 'rent-paid', type: 'expense', amountSatang: baht(7_800), accountId: 'kbank', categoryId: 'home', date: '2026-09-06', scheduledPaymentId: 'p-rent', description: 'ค่าเช่า' }),
  makeTx({ id: 'fix', type: 'adjustment', amountSatang: baht(-10), accountId: 'cash', date: '2026-09-11' }),
  makeTx({ id: 'aug', type: 'expense', amountSatang: baht(2_000), accountId: 'cash', date: '2026-08-31' }),
  makeTx({ id: 'oct', type: 'expense', amountSatang: baht(3_000), accountId: 'cash', date: '2026-10-01' }),
]
const sources = (overrides: Partial<CalendarSources> = {}): CalendarSources => ({
  transactions,
  payments,
  obligations: [internet, rent, salary, cardBill],
  names: { category: () => undefined, account: () => undefined, debt: (id) => (id === 'home' ? 'สินเชื่อบ้าน' : id === 'cc' ? 'บัตร KBank' : undefined), describe: (tx) => tx.description ?? tx.type },
  ...overrides,
})
const items = buildCalendarItems(sources(), '2026-09', TODAY)
const byId = (id: string) => items.find((i) => i.id === id)

describe('buildCalendarItems', () => {
  it('shows actual transactions on their date with their own kind (adjustments are not shown)', () => {
    expect(byId('tx:food')).toMatchObject({ date: '2026-09-10', kind: 'expense', status: 'actual', amountSatang: baht(450), transactionId: 'food' })
    expect(byId('tx:wage')).toMatchObject({ kind: 'income', status: 'actual' })
    expect(byId('tx:move')).toMatchObject({ kind: 'transfer', accountId: 'kbank', toAccountId: 'cash' })
    expect(byId('tx:loan')).toMatchObject({ kind: 'debt_payment', debtId: 'home' })
    expect(byId('tx:fix')).toBeUndefined()
  })

  it('shows occurrences on their due date with derived status: upcoming, overdue, paid, skipped', () => {
    expect(byId('sp:p-net-15')).toMatchObject({ date: '2026-09-15', kind: 'scheduled_expense', status: 'upcoming', title: 'อินเทอร์เน็ต', amountSatang: baht(899), obligationId: 'net' })
    expect(byId('sp:p-net-10')).toMatchObject({ date: '2026-09-10', status: 'overdue' })
    expect(byId('sp:p-skip')).toMatchObject({ status: 'skipped' })
    expect(byId('sp:p-sal')).toMatchObject({ kind: 'scheduled_income', status: 'upcoming', amountSatang: baht(27_500) })
    expect(byId('sp:p-home')).toMatchObject({ kind: 'scheduled_debt', title: 'สินเชื่อบ้าน', debtId: 'home' })
    expect(byId('sp:p-cc')).toMatchObject({ kind: 'scheduled_debt', debtId: 'cc', obligationId: 'ccbill' })
  })

  it('a paid occurrence and its same-day payment are ONE event; rules themselves never appear', () => {
    expect(byId('sp:p-rent')).toMatchObject({ status: 'paid', transactionId: 'rent-paid', paidDate: '2026-09-06', amountSatang: baht(7_800) })
    expect(byId('tx:rent-paid')).toBeUndefined()
    expect(items.filter((i) => i.title === 'ค่าเช่า')).toHaveLength(1)
    expect(items.filter((i) => i.obligationId === 'net' && i.date === '2026-09-15')).toHaveLength(1)
    expect(items.some((i) => i.id.startsWith('rule:'))).toBe(false)
  })

  it('paid on another day: the occurrence stays on its due date (with the actual date and amount), the payment on its own date', () => {
    const early = buildCalendarItems(
      sources({
        payments: [makeScheduled({ id: 'p', sourceId: 'net', dueDate: '2026-09-15', expectedAmountSatang: baht(899), status: 'paid', transactionId: 'paid-early', paidDate: '2026-09-14' })],
        transactions: [makeTx({ id: 'paid-early', type: 'expense', amountSatang: baht(950), accountId: 'kbank', date: '2026-09-14', scheduledPaymentId: 'p', description: 'อินเทอร์เน็ต' })],
      }),
      '2026-09',
      TODAY,
    )
    expect(early.find((i) => i.id === 'sp:p')).toMatchObject({ date: '2026-09-15', status: 'paid', paidDate: '2026-09-14', amountSatang: baht(950), expectedSatang: baht(899) })
    expect(early.find((i) => i.id === 'tx:paid-early')).toMatchObject({ date: '2026-09-14', status: 'actual', paysDueDate: '2026-09-15' })
  })

  it('card purchase and card payment stay two different events', () => {
    expect(byId('tx:shoes')).toMatchObject({ kind: 'expense' })
    expect(byId('tx:pay-card')).toMatchObject({ kind: 'debt_payment', debtId: 'cc' })
  })

  it('only the month’s events: nothing from 31 Aug or 1 Oct leaks in; dates stay as stored (no timezone shift)', () => {
    expect(items.every((i) => i.date.startsWith('2026-09-'))).toBe(true)
    expect(byId('tx:aug')).toBeUndefined()
    expect(byId('tx:oct')).toBeUndefined()
    expect(byId('tx:wage')?.date).toBe('2026-09-30')
    expect(buildCalendarItems(sources(), '2026-10', TODAY).map((i) => i.id)).toEqual(['tx:oct'])
    expect(buildCalendarItems(sources(), '2026-08', TODAY).map((i) => i.id)).toEqual(['tx:aug'])
  })

  it('is empty for a month without events', () => {
    expect(buildCalendarItems(sources(), '2027-01', TODAY)).toEqual([])
  })
})

describe('calendarTotals', () => {
  const range = { start: '2026-09-01', end: '2026-09-30' }

  it('actual totals from transactions only; debt payments and transfers kept apart; scheduled = unpaid only', () => {
    expect(calendarTotals(sources(), range)).toEqual({
      moneyIn: baht(27_500),
      expenses: baht(450 + 1_200 + 7_800),
      debtPayments: baht(7_800 + 3_000),
      transfers: baht(5_000),
      scheduledOut: baht(899 + 899 + 7_800 + 3_000), // overdue + upcoming internet, installment, card bill — not the paid rent or the skipped one
      expectedIn: baht(27_500),
    })
  })

  it('expected income and unpaid bills never change actual reporting', () => {
    const noTx = sources({ transactions: [] })
    expect(calendarTotals(noTx, range)).toMatchObject({ moneyIn: 0, expenses: 0, debtPayments: 0 })
    expect(monthTotals([], '2026-09')).toMatchObject({ income: 0, expense: 0 })
    // The calendar's actual figures equal the Dashboard's for the same month.
    const month = monthTotals(transactions, '2026-09')
    const totals = calendarTotals(sources(), range)
    expect([totals.moneyIn, totals.expenses, totals.debtPayments]).toEqual([month.income, month.expense, month.debtPayment])
  })

  it('a day’s totals', () => {
    expect(calendarTotals(sources(), { start: '2026-09-10', end: '2026-09-10' })).toMatchObject({ expenses: baht(450), scheduledOut: baht(899) })
  })
})

describe('grouping, filters and the grid', () => {
  it('groups by day in date order', () => {
    const days = groupByDay(items)
    expect(days.map((d) => d.date)).toEqual([...new Set(items.map((i) => i.date))].sort())
    expect(days.find((d) => d.date === '2026-09-10')?.items.map((i) => i.id)).toEqual(['sp:p-net-10', 'tx:food'])
  })

  it('keeps many events of one day', () => {
    const many = Array.from({ length: 9 }, (_, n) => makeTx({ id: `m${n}`, type: 'expense', amountSatang: baht(n + 1), accountId: 'cash', date: '2026-09-09', description: `x${n}` }))
    expect(groupByDay(buildCalendarItems(sources({ transactions: many, payments: [] }), '2026-09', TODAY))[0]?.items).toHaveLength(9)
  })

  it.each([
    ['income', ['tx:wage', 'sp:p-sal']],
    ['debt', ['tx:loan', 'tx:pay-card', 'sp:p-home', 'sp:p-cc']],
    ['transfer', ['tx:move']],
  ] as const)('filter %s', (filter, expected) => {
    expect(items.filter((i) => matchesCalendarFilter(i, filter)).map((i) => i.id).sort()).toEqual([...expected].sort())
  })

  it('filters expense (actual + scheduled bills) and scheduled (all occurrences)', () => {
    expect(items.filter((i) => matchesCalendarFilter(i, 'expense')).every((i) => i.kind === 'expense' || i.kind === 'scheduled_expense')).toBe(true)
    expect(items.filter((i) => matchesCalendarFilter(i, 'scheduled'))).toHaveLength(payments.length)
  })

  it('month grid: whole Monday-first weeks; neighbouring days are flagged', () => {
    const weeks = monthGrid('2026-09')
    expect(weeks).toHaveLength(5)
    expect(weeks[0]![0]).toEqual({ date: '2026-08-31', inMonth: false })
    expect(weeks[0]![1]).toEqual({ date: '2026-09-01', inMonth: true })
    expect(weeks.at(-1)!.at(-1)).toEqual({ date: '2026-10-04', inMonth: false })
    expect(weeks.flat().filter((d) => d.inMonth)).toHaveLength(30)
    expect(monthGrid('2026-02').flat().filter((d) => d.inMonth)).toHaveLength(28)
  })
})
