import { describe, expect, it } from 'vitest'
import type { Account, ID, Transaction } from './entities'
import { add, parseBaht, sum, type Satang, ZERO } from './money'
import { accountClassOf, accountEffects, countsAsSpending, validateTransaction } from './transactions'

const accounts = new Map<ID, Pick<Account, 'kind'>>([
  ['bank', { kind: 'bank' }],
  ['cash', { kind: 'cash' }],
  ['card', { kind: 'credit_card' }],
])

type TxInput = Pick<Transaction, 'type' | 'amountSatang' | 'accountId'> & Partial<Transaction>

function balances(txs: TxInput[]): Map<ID, Satang> {
  const result = new Map<ID, Satang>()
  for (const tx of txs) {
    for (const effect of accountEffects(tx)) {
      result.set(effect.accountId, add(result.get(effect.accountId) ?? ZERO, effect.deltaSatang))
    }
  }
  return result
}

describe('account classes', () => {
  it('classifies liabilities', () => {
    expect(accountClassOf('credit_card')).toBe('liability')
    expect(accountClassOf('loan')).toBe('liability')
    expect(accountClassOf('bank')).toBe('asset')
  })
})

describe('credit card purchase then payment', () => {
  const purchase: TxInput = { type: 'expense', amountSatang: parseBaht('500'), accountId: 'card', categoryId: 'food' }
  const payment: TxInput = {
    type: 'debt_payment',
    amountSatang: parseBaht('500'),
    accountId: 'bank',
    toAccountId: 'card',
    debtId: 'card-debt',
  }

  it('purchase increases the card liability', () => {
    expect(balances([purchase]).get('card')).toBe(-50000)
  })

  it('payment decreases the bank balance and the card liability', () => {
    const result = balances([purchase, payment])
    expect(result.get('bank')).toBe(-50000)
    expect(result.get('card')).toBe(0)
  })

  it('counts the spending exactly once', () => {
    const spending = sum([purchase, payment].filter(countsAsSpending).map((t) => t.amountSatang))
    expect(spending).toBe(50000)
  })

  it('both transactions are valid', () => {
    expect(validateTransaction(purchase, accounts)).toEqual([])
    expect(validateTransaction(payment, accounts)).toEqual([])
  })
})

describe('transfer', () => {
  it('moves money between accounts without changing the total', () => {
    const result = balances([{ type: 'transfer', amountSatang: parseBaht('100'), accountId: 'bank', toAccountId: 'cash' }])
    expect(result.get('bank')).toBe(-10000)
    expect(result.get('cash')).toBe(10000)
  })
})

describe('validateTransaction', () => {
  it('rejects non-positive amounts except for adjustments', () => {
    expect(validateTransaction({ type: 'expense', amountSatang: parseBaht('-1'), accountId: 'cash' }, accounts)).toContain(
      'amount_must_be_positive',
    )
    expect(validateTransaction({ type: 'adjustment', amountSatang: parseBaht('-1'), accountId: 'cash' }, accounts)).toEqual([])
    expect(validateTransaction({ type: 'adjustment', amountSatang: ZERO, accountId: 'cash' }, accounts)).toContain(
      'adjustment_must_be_non_zero',
    )
  })

  it('rejects floating-point amounts', () => {
    expect(validateTransaction({ type: 'expense', amountSatang: 1.5 as Satang, accountId: 'cash' }, accounts)).toContain(
      'amount_not_integer',
    )
  })

  it('requires a debt for debt payments and a liability target', () => {
    const issues = validateTransaction(
      { type: 'debt_payment', amountSatang: parseBaht('10'), accountId: 'bank', toAccountId: 'cash' },
      accounts,
    )
    expect(issues).toContain('debt_payment_requires_debt')
    expect(issues).toContain('debt_payment_to_account_must_be_liability')
  })

  it('does not allow a debt payment to be categorised as an expense', () => {
    expect(
      validateTransaction(
        { type: 'debt_payment', amountSatang: parseBaht('10'), accountId: 'bank', debtId: 'd', categoryId: 'food' },
        accounts,
      ),
    ).toContain('category_not_allowed')
  })

  it('rejects interest + fees larger than the payment', () => {
    expect(
      validateTransaction(
        {
          type: 'debt_payment',
          amountSatang: parseBaht('10'),
          accountId: 'bank',
          debtId: 'd',
          interestSatang: parseBaht('8'),
          feeSatang: parseBaht('3'),
        },
        accounts,
      ),
    ).toContain('breakdown_exceeds_amount')
  })

  it('requires a destination for transfers and forbids same-account transfers', () => {
    expect(validateTransaction({ type: 'transfer', amountSatang: parseBaht('1'), accountId: 'bank' }, accounts)).toContain(
      'transfer_requires_to_account',
    )
    expect(
      validateTransaction({ type: 'transfer', amountSatang: parseBaht('1'), accountId: 'bank', toAccountId: 'bank' }, accounts),
    ).toContain('same_account')
  })

  it('flags unknown accounts', () => {
    expect(validateTransaction({ type: 'income', amountSatang: parseBaht('1'), accountId: 'nope' }, accounts)).toContain(
      'unknown_account',
    )
  })
})
