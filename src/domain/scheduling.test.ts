import { describe, expect, it } from 'vitest'
import { baht, makeAccount, makeCategory, makeDebt, makeObligation, makeScheduled } from '@/test/factories'
import type { Account, ID, RecurringObligation } from './entities'
import { satang } from './money'
import {
  buildObligation,
  obligationKind,
  daysOverdue,
  monthlyObligationSummary,
  obligationStatus,
  paymentState,
  planMissingOccurrences,
  planRuleChange,
  unpaidToRemove,
  type ObligationDraft,
} from './scheduling'

const TODAY = '2026-09-25'

const context = {
  accounts: new Map<ID, Account>([
    ['bank', makeAccount({ id: 'bank', kind: 'bank' })],
    ['card', makeAccount({ id: 'card', kind: 'credit_card' })],
  ]),
  categories: new Map<ID, { kind: 'expense' | 'income' }>([
    ['home', makeCategory({ id: 'home', kind: 'expense' })],
    ['salary', makeCategory({ id: 'salary', kind: 'income' })],
  ]),
  debts: new Map([['cc', makeDebt({ id: 'cc', kind: 'credit_card' })], ['car', makeDebt({ id: 'car', kind: 'car_loan', scheduleEnabled: true, installmentSatang: baht(9_000), dueDay: 5 })]]),
}

const draft = (overrides: Partial<ObligationDraft> = {}): ObligationDraft => ({
  name: 'ค่าเช่า',
  amountSatang: baht(7_800),
  categoryId: 'home',
  defaultAccountId: 'bank',
  recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-01-01', dayOfMonth: 6 },
  ...overrides,
})

const rent = (overrides: Partial<RecurringObligation> = {}): RecurringObligation =>
  makeObligation({
    id: 'rent',
    name: 'ค่าเช่า',
    expectedAmountSatang: baht(7_800),
    recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-01-01', dayOfMonth: 6 },
    scheduleFrom: '2026-09-01',
    ...overrides,
  })

describe('buildObligation', () => {
  it('builds a bill obligation and starts generation no earlier than this month', () => {
    const result = buildObligation(draft({ name: '  ค่าเช่า  ' }), context, { id: 'o1', now: 'n', today: TODAY })
    expect(result).toMatchObject({ ok: true, obligation: { id: 'o1', name: 'ค่าเช่า', expectedAmountSatang: baht(7_800), categoryId: 'home', scheduleFrom: '2026-09-01' } })
  })

  it('uses a later start date as-is', () => {
    const result = buildObligation(draft({ recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-11-15' } }), context, { id: 'o1', now: 'n', today: TODAY })
    expect(result.ok && result.obligation.scheduleFrom).toBe('2026-11-15')
  })

  it.each([
    [{ name: '  ' }, 'name_required'],
    [{ amountSatang: null }, 'amount_required'],
    [{ amountSatang: satang(0) }, 'amount_must_be_positive'],
    [{ categoryId: undefined }, 'category_required'],
    [{ categoryId: 'salary' }, 'category_not_expense'],
    [{ defaultAccountId: undefined }, 'account_required'],
    [{ defaultAccountId: 'ghost' }, 'unknown_account'],
    [{ debtId: 'ghost', categoryId: undefined }, 'debt_not_found'],
    [{ debtId: 'cc', defaultAccountId: 'card' }, 'pay_from_liability'],
    [{ debtId: 'car', categoryId: undefined }, 'debt_has_own_schedule'],
    [{ recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-02-30' } }, 'start_date_invalid'],
    [{ recurrence: { frequency: 'monthly', interval: 0, startDate: '2026-01-01' } }, 'interval_invalid'],
  ] as const)('rejects %j with %s', (overrides, issue) => {
    const result = buildObligation(draft(overrides as Partial<ObligationDraft>), context, { id: 'o', now: 'n', today: TODAY })
    expect(!result.ok && result.issues).toContain(issue)
  })

  it('a debt-linked obligation needs no category and drops one', () => {
    const result = buildObligation(draft({ debtId: 'cc' }), context, { id: 'o', now: 'n', today: TODAY })
    expect(result.ok && result.obligation).toMatchObject({ debtId: 'cc' })
    expect(result.ok && 'categoryId' in result.obligation).toBe(false)
  })

  it('edit keeps id, creation time, pause state and generation start', () => {
    const existing = rent({ createdAt: 'c0', pausedAt: 'p0', scheduleFrom: '2026-05-01' })
    const result = buildObligation(draft({ amountSatang: baht(9_000) }), context, { id: 'x', now: 'n2', today: TODAY, existing })
    expect(result.ok && result.obligation).toMatchObject({ id: 'rent', createdAt: 'c0', pausedAt: 'p0', scheduleFrom: '2026-05-01', updatedAt: 'n2', expectedAmountSatang: baht(9_000) })
  })
})

describe('planMissingOccurrences', () => {
  it('covers this month through the 3-month horizon', () => {
    expect(planMissingOccurrences(rent(), [], TODAY).map((o) => o.dueDate)).toEqual(['2026-09-06', '2026-10-06', '2026-11-06', '2026-12-06'])
  })

  it('is idempotent: nothing to add once stored', () => {
    const first = planMissingOccurrences(rent(), [], TODAY)
    expect(planMissingOccurrences(rent(), first, TODAY)).toEqual([])
  })

  it('only fills gaps (e.g. a new month came into the horizon)', () => {
    const existing = ['2026-09-06', '2026-10-06', '2026-11-06'].map((dueDate) => ({ dueDate }))
    expect(planMissingOccurrences(rent(), existing, TODAY).map((o) => o.dueDate)).toEqual(['2026-12-06'])
  })

  it('never recreates a paid or skipped occurrence', () => {
    const existing = [makeScheduled({ sourceId: 'rent', dueDate: '2026-09-06', status: 'paid' }), makeScheduled({ sourceId: 'rent', dueDate: '2026-10-06', status: 'skipped' })]
    expect(planMissingOccurrences(rent(), existing, TODAY).map((o) => o.dueDate)).toEqual(['2026-11-06', '2026-12-06'])
  })

  it('generates nothing while paused or deleted', () => {
    expect(planMissingOccurrences(rent({ pausedAt: 'x' }), [], TODAY)).toEqual([])
    expect(planMissingOccurrences(rent({ archivedAt: 'x' }), [], TODAY)).toEqual([])
  })

  it('after resume starts from the resume date (no back-fill of the paused period)', () => {
    expect(planMissingOccurrences(rent({ scheduleFrom: TODAY }), [], TODAY).map((o) => o.dueDate)).toEqual(['2026-10-06', '2026-11-06', '2026-12-06'])
  })
})

describe('planRuleChange', () => {
  const existing = [
    makeScheduled({ id: 'aug', sourceId: 'rent', dueDate: '2026-08-06', status: 'paid', expectedAmountSatang: baht(7_800), transactionId: 't' }),
    makeScheduled({ id: 'sep', sourceId: 'rent', dueDate: '2026-09-06', status: 'pending', expectedAmountSatang: baht(7_800) }),
    makeScheduled({ id: 'oct', sourceId: 'rent', dueDate: '2026-10-06', status: 'pending', expectedAmountSatang: baht(7_800) }),
    makeScheduled({ id: 'nov', sourceId: 'rent', dueDate: '2026-11-06', status: 'skipped', expectedAmountSatang: baht(7_800) }),
    makeScheduled({ id: 'dec', sourceId: 'rent', dueDate: '2026-12-06', status: 'pending', expectedAmountSatang: baht(7_800) }),
  ]

  it('new amount applies to future unpaid only; history untouched; ids kept', () => {
    const plan = planRuleChange(rent({ expectedAmountSatang: baht(9_000) }), existing, TODAY)
    expect(plan.remove).toEqual([])
    expect(plan.update).toEqual([
      { id: 'oct', expectedAmountSatang: baht(9_000) },
      { id: 'dec', expectedAmountSatang: baht(9_000) },
    ])
    expect(plan.create).toEqual([])
  })

  it('new day replaces future unpaid dates, keeping paid, skipped and overdue', () => {
    const plan = planRuleChange(rent({ recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-01-01', dayOfMonth: 15 } }), existing, TODAY)
    expect(plan.remove.sort()).toEqual(['dec', 'oct'])
    expect(plan.create.map((o) => o.dueDate)).toEqual(['2026-10-15', '2026-11-15', '2026-12-15'])
    expect(plan.update).toEqual([])
  })

  it('does nothing when nothing changed', () => {
    expect(planRuleChange(rent(), existing, TODAY)).toEqual({ remove: [], update: [], create: [] })
  })

  it('a paused rule keeps no future unpaid occurrences', () => {
    expect(planRuleChange(rent({ pausedAt: 'x' }), existing, TODAY).remove.sort()).toEqual(['dec', 'oct'])
  })

  it('pause/delete removal scopes', () => {
    expect(unpaidToRemove(existing, TODAY, 'future').sort()).toEqual(['dec', 'oct'])
    expect(unpaidToRemove(existing, TODAY, 'all').sort()).toEqual(['dec', 'oct', 'sep'])
  })
})

describe('derived status', () => {
  it('overdue / due soon / pending are derived from today', () => {
    expect(paymentState({ status: 'pending', dueDate: '2026-09-05' }, TODAY)).toBe('overdue')
    expect(paymentState({ status: 'pending', dueDate: '2026-10-02' }, TODAY)).toBe('due_soon')
    expect(paymentState({ status: 'pending', dueDate: '2026-10-06' }, TODAY)).toBe('pending')
    expect(paymentState({ status: 'paid', dueDate: '2026-09-05' }, TODAY)).toBe('paid')
    expect(paymentState({ status: 'skipped', dueDate: '2026-09-05' }, TODAY)).toBe('skipped')
    expect(daysOverdue({ status: 'pending', dueDate: '2026-09-05' }, TODAY)).toBe(20)
    expect(daysOverdue({ status: 'paid', dueDate: '2026-09-05' }, TODAY)).toBe(0)
  })

  it('an obligation points at its oldest overdue occurrence first', () => {
    const payments = [
      makeScheduled({ id: 'a', sourceId: 'r', dueDate: '2026-10-06' }),
      makeScheduled({ id: 'b', sourceId: 'r', dueDate: '2026-08-06' }),
      makeScheduled({ id: 'c', sourceId: 'r', dueDate: '2026-09-06' }),
      makeScheduled({ id: 'd', sourceId: 'r', dueDate: '2026-07-06', status: 'paid' }),
    ]
    expect(obligationStatus(payments, TODAY)).toMatchObject({ current: { id: 'b' }, state: 'overdue', overdueCount: 2, lastPaid: { id: 'd' } })
    expect(obligationStatus([payments[3]!], TODAY)).toMatchObject({ state: 'paid' })
    expect(obligationStatus([], TODAY).state).toBe('none')
  })
})

describe('monthlyObligationSummary', () => {
  it('sums this month’s obligations (not spending), excluding skipped', () => {
    const payments = [
      makeScheduled({ sourceId: 'a', dueDate: '2026-09-06', status: 'paid', expectedAmountSatang: baht(7_800) }),
      makeScheduled({ sourceId: 'b', dueDate: '2026-09-15', status: 'paid', expectedAmountSatang: baht(8_900) }),
      makeScheduled({ sourceId: 'c', dueDate: '2026-09-20', status: 'pending', expectedAmountSatang: baht(7_800) }),
      makeScheduled({ sourceId: 'd', dueDate: '2026-09-21', status: 'skipped', expectedAmountSatang: baht(999) }),
      makeScheduled({ sourceId: 'e', dueDate: '2026-08-20', status: 'pending', expectedAmountSatang: baht(500) }),
      makeScheduled({ sourceId: 'f', dueDate: '2026-10-06', status: 'pending', expectedAmountSatang: baht(1) }),
    ]
    const obligations = [rent(), rent({ id: 'p', pausedAt: 'x' }), rent({ id: 'z', archivedAt: 'x' })]
    expect(monthlyObligationSummary(payments, obligations, '2026-09', TODAY)).toEqual({
      due: baht(24_500),
      paid: baht(16_700),
      outstanding: baht(7_800),
      overdueEarlier: baht(500),
      activeCount: 1,
    })
  })
})

describe('recurring income rules', () => {
  const salary = (overrides: Partial<ObligationDraft> = {}) =>
    draft({ name: 'เงินเดือน', kind: 'income', amountSatang: baht(27_500), categoryId: 'salary', recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-01-01', dayOfMonth: 25 }, ...overrides })

  it('is an explicit kind on the same rule model', () => {
    const result = buildObligation(salary(), context, { id: 'sal', now: 'n', today: TODAY })
    expect(result.ok && result.obligation).toMatchObject({ kind: 'income', categoryId: 'salary', expectedAmountSatang: baht(27_500), scheduleFrom: '2026-09-01' })
    expect(result.ok && obligationKind(result.obligation)).toBe('income')
    expect(obligationKind(makeObligation({ debtId: 'cc' }))).toBe('debt')
    expect(obligationKind(makeObligation())).toBe('bill')
  })

  it.each([
    [{ categoryId: undefined }, 'category_required'],
    [{ categoryId: 'home' }, 'category_not_income'],
    [{ defaultAccountId: 'card' }, 'pay_from_liability'],
    [{ amountSatang: satang(0) }, 'amount_must_be_positive'],
  ] as const)('rejects %j with %s', (overrides, issue) => {
    const result = buildObligation(salary(overrides as Partial<ObligationDraft>), context, { id: 'o', now: 'n', today: TODAY })
    expect(!result.ok && result.issues).toContain(issue)
  })

  it('never carries a debt link', () => {
    const result = buildObligation(salary({ debtId: 'cc' }), context, { id: 'o', now: 'n', today: TODAY })
    expect(result.ok && result.obligation).not.toHaveProperty('debtId')
  })

  it('uses the same occurrence engine (monthly on the 25th)', () => {
    const rule = makeObligation({ kind: 'income', expectedAmountSatang: baht(27_500), recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-01-01', dayOfMonth: 25 }, scheduleFrom: '2026-09-01' })
    expect(planMissingOccurrences(rule, [], TODAY).map((o) => o.dueDate)).toEqual(['2026-09-25', '2026-10-25', '2026-11-25', '2026-12-25'])
  })
})
