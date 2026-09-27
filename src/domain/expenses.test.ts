import { describe, expect, it } from 'vitest'
import { baht, makeAccount, makeCategory, makeTx } from '@/test/factories'
import type { DebtKind, ID } from './entities'
import { satang, type Satang } from './money'
import { defaultExpenseAccountId, frequentExpenses, orderExpenseCategories } from './suggestions'
import { buildExpense, buildTransaction, isCalendarDate, type ExpenseDraft } from './transactions'

const context = {
  accounts: new Map<ID, { kind: 'cash' | 'credit_card' }>([
    ['cash', { kind: 'cash' }],
    ['card', { kind: 'credit_card' }],
  ]),
  categories: new Map<ID, { kind: 'expense' | 'income' }>([
    ['food', { kind: 'expense' }],
    ['salary', { kind: 'income' }],
  ]),
}
const meta = { id: 'tx-1', now: '2026-09-25T05:00:00.000Z' }
const draft = (overrides: Partial<ExpenseDraft> = {}): ExpenseDraft => ({
  amountSatang: satang(18500),
  categoryId: 'food',
  accountId: 'cash',
  date: '2026-09-25',
  ...overrides,
})

describe('buildExpense', () => {
  it('builds an expense transaction with integer satang', () => {
    const result = buildExpense(draft({ description: '  ข้าวมันไก่  ' }), context, meta)
    expect(result).toEqual({
      ok: true,
      transaction: {
        id: 'tx-1',
        type: 'expense',
        date: '2026-09-25',
        amountSatang: 18500,
        accountId: 'cash',
        categoryId: 'food',
        description: 'ข้าวมันไก่',
        createdAt: meta.now,
        updatedAt: meta.now,
      },
    })
    expect(result.ok && Number.isSafeInteger(result.transaction.amountSatang)).toBe(true)
  })

  it('omits empty optional fields', () => {
    const result = buildExpense(draft({ description: '   ', note: '' }), context, meta)
    expect(result.ok && 'description' in result.transaction).toBe(false)
    expect(result.ok && 'note' in result.transaction).toBe(false)
  })

  it('works with a credit-card account (purchase on card = expense, not a debt payment)', () => {
    const result = buildExpense(draft({ accountId: 'card' }), context, meta)
    expect(result.ok && result.transaction.type).toBe('expense')
  })

  it.each([
    [{ amountSatang: null }, 'amount_required'],
    [{ amountSatang: satang(0) }, 'amount_must_be_positive'],
    [{ amountSatang: satang(-100) }, 'amount_must_be_positive'],
    [{ amountSatang: 1.5 as Satang }, 'amount_not_integer'],
    [{ categoryId: undefined }, 'category_required'],
    [{ categoryId: 'salary' }, 'category_not_expense'],
    [{ accountId: undefined }, 'account_required'],
    [{ date: '' }, 'date_invalid'],
    [{ date: '2026-02-30' }, 'date_invalid'],
  ] as const)('rejects %j with %s', (overrides, issue) => {
    const result = buildExpense(draft(overrides as Partial<ExpenseDraft>), context, meta)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.issues).toContain(issue)
  })

  it('rejects an unknown account via the transaction model', () => {
    const result = buildExpense(draft({ accountId: 'ghost' }), context, meta)
    expect(!result.ok && result.issues).toContain('unknown_account')
  })

  it('validates calendar dates without time zones', () => {
    expect(isCalendarDate('2028-02-29')).toBe(true)
    expect(isCalendarDate('2026-02-29')).toBe(false)
    expect(isCalendarDate('2026-9-1')).toBe(false)
  })
})

describe('frequentExpenses', () => {
  const since = '2026-06-27'
  const coffee = (date: string, amount = 60, extra = {}) =>
    makeTx({ type: 'expense', amountSatang: baht(amount), accountId: 'cash', categoryId: 'drink', description: 'กาแฟ', date, ...extra })

  it('suggests repeated description + category + amount, most frequent first', () => {
    const txs = [
      coffee('2026-09-01'),
      coffee('2026-09-10'),
      coffee('2026-09-20', 60, { description: ' กาแฟ ', accountId: 'card' }),
      makeTx({ type: 'expense', amountSatang: baht(85), accountId: 'cash', categoryId: 'food', description: 'ข้าวกลางวัน', date: '2026-09-21' }),
      makeTx({ type: 'expense', amountSatang: baht(85), accountId: 'cash', categoryId: 'food', description: 'ข้าวกลางวัน', date: '2026-09-22' }),
    ]
    expect(frequentExpenses(txs, { since })).toEqual([
      { description: 'กาแฟ', categoryId: 'drink', amountSatang: baht(60), accountId: 'card', count: 3, lastDate: '2026-09-20' },
      { description: 'ข้าวกลางวัน', categoryId: 'food', amountSatang: baht(85), accountId: 'cash', count: 2, lastDate: '2026-09-22' },
    ])
  })

  it('needs enough history: single, old, undescribed or non-expense entries are ignored', () => {
    const txs = [
      coffee('2026-09-01'),
      coffee('2026-01-01'),
      coffee('2026-01-02'),
      coffee('2026-09-02', 65),
      makeTx({ type: 'expense', amountSatang: baht(45), accountId: 'cash', categoryId: 'travel', date: '2026-09-03' }),
      makeTx({ type: 'expense', amountSatang: baht(45), accountId: 'cash', categoryId: 'travel', date: '2026-09-04' }),
      makeTx({ type: 'income', amountSatang: baht(60), accountId: 'cash', categoryId: 'drink', description: 'กาแฟ', date: '2026-09-05' }),
    ]
    expect(frequentExpenses(txs, { since })).toEqual([])
  })
})

describe('orderExpenseCategories', () => {
  it('puts recently used expense categories first and hides income/archived ones', () => {
    const cats = [
      makeCategory({ id: 'food', name: 'อาหาร', sortOrder: 0 }),
      makeCategory({ id: 'travel', name: 'เดินทาง', sortOrder: 1 }),
      makeCategory({ id: 'old', name: 'เก่า', sortOrder: 2, archivedAt: '2026-01-01T00:00:00Z' }),
      makeCategory({ id: 'salary', name: 'เงินเดือน', kind: 'income', sortOrder: 3 }),
    ]
    const txs = [makeTx({ type: 'expense', amountSatang: baht(45), accountId: 'cash', categoryId: 'travel', date: '2026-09-01' })]
    expect(orderExpenseCategories(cats, txs, '2026-06-01').map((c) => c.id)).toEqual(['travel', 'food'])
  })
})

describe('defaultExpenseAccountId', () => {
  const cash = makeAccount({ id: 'cash', sortOrder: 1 })
  const bank = makeAccount({ id: 'bank', sortOrder: 0 })

  it('prefers the account of the latest expense', () => {
    const txs = [
      makeTx({ type: 'expense', amountSatang: baht(1), accountId: 'bank', date: '2026-09-01' }),
      makeTx({ type: 'expense', amountSatang: baht(1), accountId: 'cash', date: '2026-09-02' }),
      makeTx({ type: 'income', amountSatang: baht(1), accountId: 'bank', date: '2026-09-03' }),
    ]
    expect(defaultExpenseAccountId([cash, bank], txs)).toBe('cash')
  })

  it('falls back to the first open account, and never invents one', () => {
    expect(defaultExpenseAccountId([cash, bank], [])).toBe('bank')
    expect(defaultExpenseAccountId([], [])).toBeUndefined()
    const archived = makeAccount({ id: 'x', archivedAt: '2026-01-01T00:00:00Z' })
    expect(defaultExpenseAccountId([archived], [makeTx({ type: 'expense', amountSatang: baht(1), accountId: 'x' })])).toBeUndefined()
  })
})

describe('buildTransaction — edit and debt payments', () => {
  const card = { kind: 'credit_card' as const, linkedAccountId: 'card', openingDate: '2026-01-01' }
  const home = { kind: 'mortgage' as const, openingDate: '2026-01-01' }
  const ctx = { ...context, debts: new Map<string, { kind: DebtKind; linkedAccountId?: string; openingDate: string }>([['cc', card], ['home', home]]) }
  const cardPayment = makeTx({
    id: 'keep-me',
    type: 'debt_payment',
    amountSatang: baht(1_000),
    accountId: 'cash',
    toAccountId: 'card',
    debtId: 'cc',
    payee: 'ธนาคาร',
    scheduledPaymentId: 'sp-1',
    createdAt: '2026-09-01T00:00:00.000Z',
  })
  const loan = (overrides: Partial<Parameters<typeof buildTransaction>[0]> = {}) =>
    buildTransaction(
      { type: 'debt_payment', debtId: 'home', amountSatang: baht(10_000), accountId: 'cash', date: '2026-09-02', principalSatang: baht(7_000), interestSatang: baht(2_900), feeSatang: baht(100), ...overrides },
      ctx,
      { id: 'x', now: 'n' },
    )

  it('edit keeps id, type, creation time and fields the form does not edit', () => {
    const result = buildTransaction({ type: 'debt_payment', amountSatang: baht(1_200), accountId: 'cash', date: '2026-09-02' }, ctx, {
      id: 'ignored',
      now: '2026-09-26T00:00:00.000Z',
      existing: cardPayment,
    })
    expect(result).toMatchObject({
      ok: true,
      transaction: { id: 'keep-me', type: 'debt_payment', debtId: 'cc', toAccountId: 'card', payee: 'ธนาคาร', scheduledPaymentId: 'sp-1', amountSatang: baht(1_200), createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-26T00:00:00.000Z' },
    })
  })

  it('refuses to change the type', () => {
    const result = buildTransaction({ type: 'expense', amountSatang: baht(1), accountId: 'cash', categoryId: 'food', date: '2026-09-02' }, ctx, { id: 'x', now: 'n', existing: cardPayment })
    expect(!result.ok && result.issues).toContain('type_change_not_allowed')
  })

  it('card payments take no split (card interest/fees are separate card expenses)', () => {
    const result = buildTransaction({ type: 'debt_payment', amountSatang: baht(10), accountId: 'cash', date: '2026-09-02', interestSatang: baht(1) }, ctx, { id: 'x', now: 'n', existing: cardPayment })
    expect(!result.ok && result.issues).toContain('breakdown_not_allowed')
  })

  it('loan payments store an explicit split whose parts sum to the payment', () => {
    const result = loan()
    expect(result).toMatchObject({ ok: true, transaction: { principalSatang: baht(7_000), interestSatang: baht(2_900), feeSatang: baht(100) } })
    expect(result.ok && 'toAccountId' in result.transaction).toBe(false)
    expect(loan({ interestSatang: satang(0), feeSatang: satang(0), principalSatang: baht(10_000) })).toMatchObject({ ok: true, transaction: { interestSatang: 0, feeSatang: 0 } })
  })

  it.each([
    [{ principalSatang: undefined }, 'allocation_required'],
    [{ feeSatang: null }, 'allocation_required'],
    [{ feeSatang: satang(-100), interestSatang: baht(3_000) }, 'breakdown_invalid'],
    [{ principalSatang: baht(7_001) }, 'allocation_mismatch'],
    [{ date: '2025-12-31' }, 'payment_before_opening'],
  ] as const)('loan payment %j → %s', (overrides, issue) => {
    const result = loan(overrides as Partial<Parameters<typeof buildTransaction>[0]>)
    expect(!result.ok && result.issues).toContain(issue)
  })

  it('an explicitly unallocated loan payment stores no split', () => {
    const result = loan({ allocation: 'unallocated', principalSatang: undefined, interestSatang: undefined, feeSatang: undefined })
    expect(result.ok).toBe(true)
    expect(result.ok && ['principalSatang', 'interestSatang', 'feeSatang'].some((k) => k in result.transaction)).toBe(false)
  })

  it('an unknown debt is refused', () => {
    const result = loan({ debtId: 'ghost' })
    expect(!result.ok && result.issues).toContain('debt_required')
  })
})
