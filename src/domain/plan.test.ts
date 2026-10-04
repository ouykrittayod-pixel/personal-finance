import { describe, expect, it } from 'vitest'
import { baht, makeDebt, makeObligation, makeScheduled, makeTx } from '@/test/factories'
import { buildMonthPlan, monthsFrom, type PlanSources } from './plan'

const TODAY = '2026-10-04'

const rent = makeObligation({ id: 'rent', name: 'ค่าเช่า', expectedAmountSatang: baht(3_750), categoryId: 'home', recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-07-01', dayOfMonth: 1 } })
const power = makeObligation({ id: 'power', name: 'ค่าไฟ', expectedAmountSatang: baht(1_100), variableAmount: true, recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-10-01', dayOfMonth: 1 } })
const salary = makeObligation({ id: 'salary', name: 'เงินเดือน', kind: 'income', expectedAmountSatang: baht(28_548), recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-09-25', dayOfMonth: 25 } })
const dca = makeObligation({ id: 'dca', name: 'DCA', kind: 'transfer', toAccountId: 'invest', expectedAmountSatang: baht(700), recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-10-01', dayOfMonth: 1 } })
const card = makeObligation({ id: 'card', name: 'บัตร', debtId: 'kbank', expectedAmountSatang: baht(2_500), recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-10-01', dayOfMonth: 1 } })
const insurance = makeObligation({ id: 'ins', name: 'ประกันรถ', expectedAmountSatang: baht(9_000), recurrence: { frequency: 'monthly', interval: 1, startDate: '2027-02-10', dayOfMonth: 10, count: 1 } })

/** Order-independent comparison for items due the same day (name order depends on the collation). */
const sorted = <T,>(rows: T[]) => [...rows].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1))

const sources = (overrides: Partial<PlanSources> = {}): PlanSources => ({
  obligations: [rent, power, salary, dca, card, insurance],
  debts: [],
  payments: [
    // September: rent paid with the actual amount; salary not received yet (carried into October).
    makeScheduled({ id: 'rent-09', sourceId: 'rent', dueDate: '2026-09-01', expectedAmountSatang: baht(3_750), status: 'paid', transactionId: 'tx-rent-09' }),
    makeScheduled({ id: 'salary-09', sourceId: 'salary', dueDate: '2026-09-25', expectedAmountSatang: baht(28_548) }),
    // October (generated): rent paid; power planned by hand at 1,250; card and DCA open.
    makeScheduled({ id: 'rent-10', sourceId: 'rent', dueDate: '2026-10-01', expectedAmountSatang: baht(3_750), status: 'paid', transactionId: 'tx-rent-10' }),
    makeScheduled({ id: 'power-10', sourceId: 'power', dueDate: '2026-10-01', expectedAmountSatang: baht(1_250) }),
    makeScheduled({ id: 'card-10', sourceId: 'card', dueDate: '2026-10-01', expectedAmountSatang: baht(2_500) }),
    makeScheduled({ id: 'dca-10', sourceId: 'dca', dueDate: '2026-10-01', expectedAmountSatang: baht(700), status: 'skipped' }),
    makeScheduled({ id: 'salary-10', sourceId: 'salary', dueDate: '2026-10-25', expectedAmountSatang: baht(28_548) }),
  ],
  transactions: [
    makeTx({ id: 'tx-rent-09', type: 'expense', amountSatang: baht(3_750), accountId: 'bank', date: '2026-09-01', scheduledPaymentId: 'rent-09' }),
    makeTx({ id: 'tx-rent-10', type: 'expense', amountSatang: baht(3_800), accountId: 'bank', date: '2026-10-02', scheduledPaymentId: 'rent-10' }),
    makeTx({ id: 'lunch', type: 'expense', amountSatang: baht(120), accountId: 'bank', date: '2026-10-03' }),
    makeTx({ id: 'move', type: 'transfer', amountSatang: baht(500), accountId: 'bank', toAccountId: 'invest', date: '2026-10-03' }),
  ],
  ...overrides,
})

describe('monthly plan', () => {
  it('this month: income − everything to pay = what is left, with what is overdue carried over', () => {
    const plan = buildMonthPlan(sources(), '2026-10', TODAY)
    expect(plan.income.map((i) => [i.key, i.status, i.carriedOver, i.amountSatang])).toEqual([
      ['salary-09', 'overdue', true, baht(28_548)],
      ['salary-10', 'pending', false, baht(28_548)],
    ])
    expect(sorted(plan.outgoing.map((i) => [i.name, i.group, i.status, i.amountSatang]))).toEqual(
      sorted([
        ['DCA', 'transfer', 'skipped', 0],
        ['ค่าเช่า', 'bill', 'paid', baht(3_800)],
        ['ค่าไฟ', 'bill', 'overdue', baht(1_250)],
        ['บัตร', 'debt', 'overdue', baht(2_500)],
      ]),
    )
    expect(plan.totals).toEqual({
      income: baht(57_096),
      incomeReceived: 0,
      incomeExpected: baht(57_096),
      outgoing: baht(7_550),
      outgoingPaid: baht(3_800),
      outgoingUnpaid: baht(3_750),
      remaining: baht(49_546),
      otherSpending: baht(120),
      remainingAfterSpending: baht(49_426),
    })
  })

  it('marks a month planned by hand and keeps the actual amount of a paid one', () => {
    const plan = buildMonthPlan(sources(), '2026-10', TODAY)
    const power10 = plan.outgoing.find((i) => i.key === 'power-10')!
    expect(power10).toMatchObject({ adjusted: true, variable: true, expectedSatang: baht(1_250) })
    const rent10 = plan.outgoing.find((i) => i.key === 'rent-10')!
    expect(rent10).toMatchObject({ expectedSatang: baht(3_750), actualSatang: baht(3_800), adjusted: false })
  })

  it('a month not generated yet is projected from the rules, one-off items included', () => {
    const plan = buildMonthPlan(sources(), '2027-02', TODAY)
    expect(sorted(plan.outgoing.map((i) => [i.name, i.dueDate, i.status, i.amountSatang]))).toEqual(
      sorted([
        ['ค่าเช่า', '2027-02-01', 'projected', baht(3_750)],
        ['ค่าไฟ', '2027-02-01', 'projected', baht(1_100)],
        ['บัตร', '2027-02-01', 'projected', baht(2_500)],
        ['DCA', '2027-02-01', 'projected', baht(700)],
        ['ประกันรถ', '2027-02-10', 'projected', baht(9_000)],
      ]),
    )
    expect(plan.outgoing.at(-1)?.name).toBe('ประกันรถ')
    expect(plan.income.map((i) => [i.key, i.amountSatang])).toEqual([['proj:obligation:salary:2027-02-25', baht(28_548)]])
    expect(plan.totals.remaining).toBe(baht(28_548 - 3_750 - 1_100 - 2_500 - 700 - 9_000))
    // A one-off item happens once only.
    expect(buildMonthPlan(sources(), '2027-03', TODAY).outgoing.some((i) => i.name === 'ประกันรถ')).toBe(false)
  })

  it('a stored month is never projected twice, and paused or deleted rules project nothing', () => {
    const stored = makeScheduled({ id: 'rent-12', sourceId: 'rent', dueDate: '2026-12-01', expectedAmountSatang: baht(4_000) })
    const s = sources({ payments: [...sources().payments, stored] })
    expect(buildMonthPlan(s, '2026-12', TODAY).outgoing.filter((i) => i.sourceId === 'rent').map((i) => [i.key, i.amountSatang])).toEqual([['rent-12', baht(4_000)]])
    const paused = sources({ obligations: [{ ...rent, pausedAt: '2026-10-01T00:00:00.000Z' }, { ...power, archivedAt: '2026-10-01T00:00:00.000Z' }] })
    expect(buildMonthPlan(paused, '2027-01', TODAY).outgoing).toEqual([])
  })

  it('past months show history only (no projections, nothing carried)', () => {
    const plan = buildMonthPlan(sources(), '2026-09', TODAY)
    expect(plan.outgoing.map((i) => [i.key, i.status])).toEqual([['rent-09', 'paid']])
    expect(plan.income.map((i) => [i.key, i.status])).toEqual([['salary-09', 'overdue']])
    expect(plan.income.every((i) => !i.carriedOver)).toBe(true)
  })

  it('loan installments from a debt schedule count as payments too', () => {
    const loan = makeDebt({ id: 'home-loan', name: 'บ้าน ธอส.', kind: 'mortgage', scheduleEnabled: true, installmentSatang: baht(7_700), dueDay: 1, openingDate: '2023-01-01' })
    const plan = buildMonthPlan(sources({ obligations: [], debts: [loan], payments: [], transactions: [] }), '2026-11', TODAY)
    expect(plan.outgoing.map((i) => [i.name, i.group, i.sourceType, i.amountSatang])).toEqual([['บ้าน ธอส.', 'debt', 'debt', baht(7_700)]])
  })

  it('a short month has a negative remaining', () => {
    const plan = buildMonthPlan(sources({ obligations: [rent, insurance] }), '2027-02', TODAY)
    expect(plan.totals.remaining).toBe(-baht(12_750))
  })

  it('lists months ahead across a year boundary', () => {
    expect(monthsFrom('2026-11', 4)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02'])
  })
})
