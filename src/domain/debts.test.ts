import { describe, expect, it } from 'vitest'
import { baht, makeAccount, makeDebt, makeObligation, makeTx } from '@/test/factories'
import {
  addPrincipalAdjustment,
  buildDebt,
  cardPosition,
  debtPosition,
  debtScheduleSource,
  formatBpsAsPercent,
  hasOwnSchedule,
  loanPosition,
  loanProgress,
  parsePercentToBps,
  statementExpectedAmount,
  validateLoanTimeline,
  validateStatement,
  type DebtContext,
  type DebtDraft,
} from './debts'
import type { Transaction } from './entities'
import type { Satang } from './money'

const TODAY = '2026-09-25'
const pay = (principal: Satang | undefined, overrides: Partial<Transaction> = {}) =>
  makeTx({
    type: 'debt_payment',
    debtId: 'home',
    accountId: 'bank',
    amountSatang: baht(10_000),
    ...(principal === undefined ? {} : { principalSatang: principal, interestSatang: (baht(10_000) - principal) as Satang, feeSatang: baht(0) }),
    date: '2026-09-10',
    ...overrides,
  })

describe('loanPosition', () => {
  const home = makeDebt({ id: 'home', kind: 'mortgage', principalSatang: baht(3_000_000), openingBalanceSatang: baht(1_000_000), openingDate: '2026-03-01' })

  it('starts from the opening balance at its effective date — never from the original principal', () => {
    const position = loanPosition(home, [])
    expect(position.outstanding).toBe(baht(1_000_000))
    expect(position.opening).toBe(baht(1_000_000))
  })

  it('subtracts only explicitly allocated principal; interest and fees are separate', () => {
    const position = loanPosition(home, [pay(baht(7_000)), pay(baht(6_000), { date: '2026-08-10' })])
    expect(position).toMatchObject({ principalPaid: baht(13_000), interestPaid: baht(7_000), feesPaid: 0, totalPaid: baht(20_000), outstanding: baht(987_000) })
  })

  it('ignores payments before the effective date (already reflected in the opening balance)', () => {
    expect(loanPosition(home, [pay(baht(7_000), { date: '2026-02-10' })]).outstanding).toBe(baht(1_000_000))
  })

  it('keeps unallocated payments out of principal and reports them', () => {
    const position = loanPosition(home, [pay(undefined)])
    expect(position).toMatchObject({ outstanding: baht(1_000_000), unallocatedPaid: baht(10_000), unallocatedCount: 1, principalPaid: 0 })
  })

  it('adds principal increases and corrections from their date', () => {
    const topped = { ...home, principalAdjustments: [{ id: 'a', date: '2026-06-01', amountSatang: baht(50_000), createdAt: 'x' }] }
    expect(loanPosition(topped, [], '2026-05-31').outstanding).toBe(baht(1_000_000))
    expect(loanPosition(topped, []).outstanding).toBe(baht(1_050_000))
    expect(loanProgress(loanPosition(topped, [pay(baht(10_000))]))).toEqual({ base: baht(1_050_000), paid: baht(10_000) })
  })

  it('reports historical balances as of a date', () => {
    const txs = [pay(baht(10_000), { date: '2026-08-10' }), pay(baht(10_000), { date: '2026-09-10' })]
    expect(loanPosition(home, txs, '2026-08-31').outstanding).toBe(baht(990_000))
    expect(loanPosition(home, txs, '2026-02-28').outstanding).toBe(0)
  })

  it('an extra (unscheduled) repayment reduces principal like any allocated payment', () => {
    const extra = makeTx({ type: 'debt_payment', debtId: 'home', accountId: 'bank', amountSatang: baht(100_000), principalSatang: baht(100_000), interestSatang: baht(0), feeSatang: baht(0), date: '2026-09-20' })
    expect(loanPosition(home, [pay(baht(7_000)), extra]).outstanding).toBe(baht(893_000))
  })
})

describe('validateLoanTimeline', () => {
  const loan = makeDebt({ id: 'home', openingBalanceSatang: baht(10_000), openingDate: '2026-01-01' })

  it('rejects principal repaid beyond what was outstanding at that time', () => {
    expect(validateLoanTimeline(loan, [pay(baht(10_000))]).ok).toBe(true)
    expect(validateLoanTimeline(loan, [pay(baht(6_000)), pay(baht(5_000), { date: '2026-09-11' })])).toMatchObject({ ok: false, date: '2026-09-11' })
  })

  it('applies a same-day increase before a repayment, but not a later one', () => {
    const txs = [pay(baht(10_000)), pay(baht(5_000), { date: '2026-09-12' })]
    const sameDay = { ...loan, principalAdjustments: [{ id: 'a', date: '2026-09-12', amountSatang: baht(5_000), createdAt: 'x' }] }
    expect(validateLoanTimeline(sameDay, txs).ok).toBe(true)
    const later = { ...loan, principalAdjustments: [{ id: 'a', date: '2026-09-13', amountSatang: baht(5_000), createdAt: 'x' }] }
    expect(validateLoanTimeline(later, txs).ok).toBe(false)
  })

  it('unallocated payments never count as principal', () => {
    expect(validateLoanTimeline(loan, [pay(undefined, { amountSatang: baht(50_000) })]).ok).toBe(true)
  })
})

describe('cardPosition', () => {
  const card = makeAccount({ id: 'card', name: 'บัตร KTC', kind: 'credit_card', openingBalanceSatang: baht(-2_000), openingDate: '2026-01-01' })
  const cc = makeDebt({ id: 'cc', kind: 'credit_card', linkedAccountId: 'card' })

  it('is the card account’s liability: purchases, interest, refunds and payments — no second balance', () => {
    const txs = [
      makeTx({ type: 'expense', amountSatang: baht(3_000), accountId: 'card', date: '2026-09-02' }),
      makeTx({ type: 'expense', amountSatang: baht(150), accountId: 'card', date: '2026-09-03', description: 'ดอกเบี้ยบัตร' }),
      makeTx({ type: 'adjustment', amountSatang: baht(500), accountId: 'card', date: '2026-09-04', description: 'คืนเงิน' }),
      makeTx({ type: 'debt_payment', amountSatang: baht(1_000), accountId: 'bank', toAccountId: 'card', debtId: 'cc', date: '2026-09-05' }),
    ]
    const position = cardPosition(cc, [card], txs)
    expect(position).toMatchObject({ liability: baht(2_000 + 3_000 + 150 - 500 - 1_000), paymentsTotal: baht(1_000), paymentCount: 1, accountName: 'บัตร KTC' })
    expect(cardPosition(cc, [card], txs, '2026-09-02')?.liability).toBe(baht(5_000))
  })

  it('is unknown (null) when the linked account is missing', () => {
    expect(debtPosition(cc, [], []).outstanding).toBeNull()
  })

  it('an overpaid card is in credit (negative liability)', () => {
    const txs = [makeTx({ type: 'debt_payment', amountSatang: baht(2_500), accountId: 'bank', toAccountId: 'card', debtId: 'cc' })]
    expect(cardPosition(cc, [card], txs)?.liability).toBe(baht(-500))
  })
})

describe('buildDebt', () => {
  const accounts = new Map([
    ['bank', makeAccount({ id: 'bank', kind: 'bank' })],
    ['card', makeAccount({ id: 'card', kind: 'credit_card' })],
  ])
  const ctx = (overrides: Partial<DebtContext> = {}): DebtContext => ({ accounts, debts: [], obligations: [], transactions: [], ...overrides })
  const loanDraft = (overrides: Partial<DebtDraft> = {}): DebtDraft => ({
    name: ' สินเชื่อบ้าน ',
    kind: 'mortgage',
    lender: 'ธนาคาร',
    principalSatang: baht(3_000_000),
    openingBalanceSatang: baht(2_400_000),
    openingDate: '2026-09-01',
    interestMethod: 'reducing_balance',
    annualInterestRateBps: 550,
    installmentSatang: baht(18_000),
    dueDay: 5,
    scheduleEnabled: true,
    ...overrides,
  })
  const meta = { id: 'home', now: 'now', today: TODAY }

  it('builds a loan with an explicit effective date and schedule start', () => {
    const result = buildDebt(loanDraft(), ctx(), meta)
    expect(result.ok && result.debt).toMatchObject({
      id: 'home',
      name: 'สินเชื่อบ้าน',
      principalSatang: baht(3_000_000),
      openingBalanceSatang: baht(2_400_000),
      openingDate: '2026-09-01',
      scheduleEnabled: true,
      scheduleFrom: '2026-09-01',
      status: 'active',
    })
  })

  it.each([
    [{ name: ' ' }, 'name_required'],
    [{ openingBalanceSatang: null }, 'opening_required'],
    [{ openingBalanceSatang: baht(-1) }, 'opening_invalid'],
    [{ openingDate: '2026-02-30' }, 'opening_date_invalid'],
    [{ principalSatang: baht(0) }, 'principal_invalid'],
    [{ maturityDate: '2020-01-01' }, 'maturity_before_start'],
    [{ annualInterestRateBps: 10_001 }, 'rate_invalid'],
    [{ installmentSatang: baht(0) }, 'installment_invalid'],
    [{ dueDay: 32 }, 'due_day_invalid'],
    [{ installmentSatang: null }, 'schedule_incomplete'],
    [{ dueDay: undefined }, 'schedule_incomplete'],
  ] as const)('rejects %j with %s', (overrides, issue) => {
    const result = buildDebt(loanDraft(overrides as Partial<DebtDraft>), ctx(), meta)
    expect(!result.ok && result.issues).toContain(issue)
  })

  it('keeps one schedule owner: no installment schedule if a recurring obligation already pays the debt', () => {
    const result = buildDebt(loanDraft(), ctx({ obligations: [makeObligation({ debtId: 'home' })] }), meta)
    expect(!result.ok && result.issues).toEqual(['schedule_owned_by_obligation'])
    // An archived obligation no longer owns it.
    expect(buildDebt(loanDraft(), ctx({ obligations: [makeObligation({ debtId: 'home', archivedAt: 'x' })] }), meta).ok).toBe(true)
  })

  it('credit cards need their own credit-card account, one debt per account, and store no second balance', () => {
    const card: DebtDraft = { name: 'KTC', kind: 'credit_card', openingBalanceSatang: null, openingDate: TODAY, interestMethod: 'unknown' }
    expect(buildDebt(card, ctx(), meta)).toEqual({ ok: false, issues: ['card_account_required'] })
    expect(buildDebt({ ...card, linkedAccountId: 'bank' }, ctx(), meta)).toEqual({ ok: false, issues: ['card_account_invalid'] })
    const other = makeDebt({ id: 'other', kind: 'credit_card', linkedAccountId: 'card' })
    expect(buildDebt({ ...card, linkedAccountId: 'card' }, ctx({ debts: [other] }), meta)).toEqual({ ok: false, issues: ['card_account_in_use'] })
    const result = buildDebt({ ...card, linkedAccountId: 'card', installmentSatang: baht(1), scheduleEnabled: true }, ctx(), meta)
    expect(result.ok && result.debt).toMatchObject({ openingBalanceSatang: 0, linkedAccountId: 'card' })
    expect(result.ok && result.debt).not.toHaveProperty('scheduleEnabled')
    expect(result.ok && result.debt).not.toHaveProperty('installmentSatang')
  })

  it('an edit may not lower the opening balance below principal already repaid', () => {
    const existing = buildDebt(loanDraft({ scheduleEnabled: false }), ctx(), meta)
    if (!existing.ok) throw new Error('setup')
    const txs = [pay(baht(10_000), { debtId: 'home' })]
    const edit = buildDebt(loanDraft({ scheduleEnabled: false, openingBalanceSatang: baht(5_000) }), ctx({ transactions: txs }), { ...meta, existing: existing.debt })
    expect(edit).toEqual({ ok: false, issues: ['opening_below_repaid'] })
  })

  it('an edit keeps id, createdAt and fields the form does not edit', () => {
    const existing = { ...makeDebt({ id: 'home', createdAt: 'created' }), principalAdjustments: [{ id: 'a', date: '2026-09-02', amountSatang: baht(1), createdAt: 'x' }] }
    const result = buildDebt(loanDraft({ scheduleEnabled: false }), ctx(), { ...meta, id: 'ignored', existing })
    expect(result.ok && result.debt).toMatchObject({ id: 'home', createdAt: 'created', principalAdjustments: existing.principalAdjustments })
  })
})

describe('schedules and statements', () => {
  it('a loan schedule is monthly on the due day from the start date, until maturity', () => {
    const debt = makeDebt({ scheduleEnabled: true, installmentSatang: baht(9_000), dueDay: 31, startDate: '2026-02-01', maturityDate: '2030-01-31', scheduleFrom: '2026-09-01' })
    expect(debtScheduleSource(debt)).toMatchObject({
      recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-02-01', dayOfMonth: 31, endDate: '2030-01-31' },
      expectedAmountSatang: baht(9_000),
      scheduleFrom: '2026-09-01',
    })
    expect(debtScheduleSource({ ...debt, scheduleEnabled: false })).toBeNull()
    expect(debtScheduleSource({ ...debt, status: 'paid_off' })?.archivedAt).toBeDefined()
    expect(hasOwnSchedule(debt)).toBe(true)
    expect(hasOwnSchedule(makeDebt({ kind: 'credit_card' }))).toBe(false)
    expect(hasOwnSchedule(makeDebt({ kind: 'credit_card', statements: [{ id: 's', statementDate: TODAY, balanceSatang: baht(1), dueDate: TODAY, createdAt: 'x' }] }))).toBe(true)
  })

  it('validates card statements; expected amount is the minimum if printed', () => {
    const cc = makeDebt({ id: 'cc', kind: 'credit_card', linkedAccountId: 'card' })
    const ok = { statementDate: '2026-09-15', balanceSatang: baht(12_000), minimumDueSatang: baht(1_200), dueDate: '2026-10-05' }
    expect(validateStatement(cc, ok, [])).toEqual([])
    expect(validateStatement(cc, { ...ok, dueDate: '2026-09-01' }, [])).toEqual(['due_before_statement'])
    expect(validateStatement(cc, { ...ok, minimumDueSatang: baht(20_000) }, [])).toEqual(['minimum_invalid'])
    expect(validateStatement(cc, ok, [makeObligation({ debtId: 'cc' })])).toEqual(['schedule_owned_by_obligation'])
    expect(validateStatement(makeDebt(), ok, [])).toEqual(['not_a_card'])
    expect(statementExpectedAmount(ok)).toBe(baht(1_200))
    expect(statementExpectedAmount({ balanceSatang: baht(12_000) })).toBe(baht(12_000))
  })

  it('principal adjustments are dated, non-zero and cannot make history overpaid', () => {
    const loan = makeDebt({ id: 'home', openingBalanceSatang: baht(10_000), openingDate: '2026-01-01' })
    expect(addPrincipalAdjustment(loan, { id: 'a', date: '2026-09-01', amountSatang: baht(0) }, [], 'now')).toEqual({ ok: false, issues: ['adjustment_invalid'] })
    expect(addPrincipalAdjustment(loan, { id: 'a', date: '2025-12-31', amountSatang: baht(1) }, [], 'now')).toEqual({ ok: false, issues: ['adjustment_before_opening'] })
    expect(addPrincipalAdjustment(loan, { id: 'a', date: '2026-09-01', amountSatang: baht(-5_000) }, [pay(baht(8_000))], 'now')).toEqual({ ok: false, issues: ['opening_below_repaid'] })
    const result = addPrincipalAdjustment(loan, { id: 'a', date: '2026-09-01', amountSatang: baht(5_000), note: ' กู้เพิ่ม ' }, [], 'now')
    expect(result.ok && loanPosition(result.debt, []).outstanding).toBe(baht(15_000))
  })
})

describe('percent parsing', () => {
  it.each([
    ['5.25', 525],
    ['5.5', 550],
    ['0', 0],
    ['100', 10_000],
    ['18%', 1_800],
  ])('%s → %i bps', (input, bps) => expect(parsePercentToBps(input)).toBe(bps))

  it.each(['', 'abc', '5.255', '-1', '100.01', '1e2'])('rejects %j', (input) => expect(parsePercentToBps(input)).toBeNull())

  it('formats bps back', () => {
    expect(formatBpsAsPercent(525)).toBe('5.25')
    expect(formatBpsAsPercent(550)).toBe('5.5')
    expect(formatBpsAsPercent(1_800)).toBe('18')
  })
})
