import { describe, expect, it } from 'vitest'
import { baht, makeAccount, makeDebt, makeObligation, makeTx } from '@/test/factories'
import { creditCardProfile, investmentProfile, nextDayOfMonth } from './account-profiles'
import { ZERO } from './money'

const TODAY = '2026-10-04'

describe('nextDayOfMonth', () => {
  it('this month when still ahead, else next month, clamped to short months', () => {
    expect(nextDayOfMonth('2026-10-04', 25)).toBe('2026-10-25')
    expect(nextDayOfMonth('2026-10-04', 4)).toBe('2026-10-04')
    expect(nextDayOfMonth('2026-10-04', 1)).toBe('2026-11-01')
    expect(nextDayOfMonth('2027-02-10', 31)).toBe('2027-02-28')
  })
})

describe('credit card profile', () => {
  const card = makeAccount({ id: 'card', kind: 'credit_card', openingBalanceSatang: baht(-7_500), openingDate: '2026-09-01', creditLimitSatang: baht(21_000), statementDay: 25, paymentDueDay: 10 })
  const txs = [
    makeTx({ id: 'old', type: 'expense', amountSatang: baht(1_000), accountId: 'card', date: '2026-09-20' }),
    makeTx({ id: 'new1', type: 'expense', amountSatang: baht(500), accountId: 'card', date: '2026-09-27' }),
    makeTx({ id: 'new2', type: 'expense', amountSatang: baht(300), accountId: 'card', date: '2026-10-03' }),
    makeTx({ id: 'pay', type: 'debt_payment', amountSatang: baht(2_000), accountId: 'bank', toAccountId: 'card', debtId: 'kb', date: '2026-10-01' }),
  ]
  const debt = makeDebt({ id: 'kb', kind: 'credit_card', linkedAccountId: 'card', statements: [{ id: 's1', statementDate: '2026-09-25', balanceSatang: baht(8_500), minimumDueSatang: baht(850), dueDate: '2026-10-10', createdAt: '2026-09-25T00:00:00.000Z' }] })
  const rule = makeObligation({ id: 'r', name: 'จ่ายบัตร', debtId: 'kb', expectedAmountSatang: baht(2_500), recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-10-01', dayOfMonth: 1 } })

  it('limit, used, available, share used, cycle spending, next due date, statement and plan', () => {
    const profile = creditCardProfile(card, txs, { debts: [debt], obligations: [rule] }, TODAY)
    // Owed: 7,500 + 1,000 + 500 + 300 − 2,000 = 7,300
    expect(profile).toMatchObject({
      limit: baht(21_000),
      used: baht(7_300),
      available: baht(13_700),
      usedBps: 3476,
      statementDay: 25,
      paymentDueDay: 10,
      cycle: { start: '2026-09-26', end: '2026-10-25', spending: baht(800), count: 2 },
      nextDueDate: '2026-10-10',
      spendingThisMonth: baht(300),
      lastStatement: { statementDate: '2026-09-25', balance: baht(8_500), minimumDue: baht(850), dueDate: '2026-10-10' },
      plannedPayment: { name: 'จ่ายบัตร', amount: baht(2_500), nextDate: '2026-11-01' },
    })
  })

  it('a card without limit or days still shows what is used and this month', () => {
    const plain = makeAccount({ id: 'card', kind: 'credit_card', openingBalanceSatang: ZERO, openingDate: '2026-09-01' })
    const profile = creditCardProfile(plain, txs, { debts: [], obligations: [] }, TODAY)
    expect(profile.limit).toBeUndefined()
    expect(profile.cycle).toBeUndefined()
    expect(profile.used).toBe(0)
    expect(profile.inCredit).toBe(baht(200)) // paid 2,000 against 1,800 of purchases
  })
})

describe('investment profile', () => {
  const dca = makeAccount({ id: 'dca', kind: 'investment', openingBalanceSatang: baht(1_000), openingDate: '2026-01-01' })
  const txs = [
    makeTx({ id: 'in1', type: 'transfer', amountSatang: baht(700), accountId: 'bank', toAccountId: 'dca', date: '2026-09-01' }),
    makeTx({ id: 'in2', type: 'transfer', amountSatang: baht(700), accountId: 'bank', toAccountId: 'dca', date: '2026-10-01' }),
    makeTx({ id: 'out', type: 'transfer', amountSatang: baht(200), accountId: 'dca', toAccountId: 'bank', date: '2026-09-15' }),
    makeTx({ id: 'div', type: 'income', amountSatang: baht(50), accountId: 'dca', categoryId: 'x', date: '2026-09-30' }),
    makeTx({ id: 'value', type: 'adjustment', amountSatang: baht(150), accountId: 'dca', date: '2026-10-02' }),
  ]
  const plan = makeObligation({ id: 'p', name: 'DCA', kind: 'transfer', toAccountId: 'dca', expectedAmountSatang: baht(700), recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-10-01', dayOfMonth: 1 } })

  it('value, money put in, gain/loss, contributions and plans', () => {
    const profile = investmentProfile(dca, txs, [plan], TODAY)
    // Put in: 1,000 + 1,400 − 200 = 2,200; value: 2,200 + 50 + 150 = 2,400
    expect(profile).toMatchObject({
      value: baht(2_400),
      invested: baht(2_200),
      gain: baht(200),
      gainBps: 909,
      returns: baht(50),
      fees: 0,
      valueChanges: baht(150),
      lastValuedOn: '2026-10-02',
      investedThisMonth: baht(700),
      investedThisYear: baht(1_400),
      plans: [{ id: 'p', name: 'DCA', amount: baht(700), nextDate: '2026-11-01', paused: false }],
    })
  })

  it('a loss is negative', () => {
    const profile = investmentProfile(dca, [...txs, makeTx({ id: 'drop', type: 'adjustment', amountSatang: baht(-600), accountId: 'dca', date: '2026-10-03' })], [], TODAY)
    expect(profile.gain).toBe(baht(-400))
    expect(profile.gainBps).toBe(-1818)
  })
})
