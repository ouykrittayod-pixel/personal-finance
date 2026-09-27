import { describe, expect, it } from 'vitest'
import { baht, makeAccount, makeCategory, makeDebt, makeTx } from '@/test/factories'
import {
  accountActivity,
  buildAccount,
  calculateAccountBalance,
  calculateAvailableMoney,
  calculateTransferEffect,
  creditCardOwed,
  isAccountActiveAtDate,
  isAccountSelectable,
  openingAmountOf,
  transactionsForAccount,
  validateTransferAccounts,
  type AccountContext,
  type AccountDraft,
} from './accounts'
import type { ID } from './entities'
import { accountBalances, cashFlow, monthTotals } from './reporting'
import { buildTransaction, type DraftContext, type TransactionDraft } from './transactions'

const kbank = makeAccount({ id: 'kbank', name: 'KBank', kind: 'bank', openingBalanceSatang: baht(50_000), openingDate: '2026-09-01' })
const cash = makeAccount({ id: 'cash', name: 'เงินสด', kind: 'cash', openingBalanceSatang: baht(0), openingDate: '2026-09-01' })
const scb = makeAccount({ id: 'scb', name: 'SCB', kind: 'bank', openingBalanceSatang: baht(20_000), openingDate: '2026-09-01' })
const card = makeAccount({ id: 'card', name: 'KBank Credit Card', kind: 'credit_card', openingBalanceSatang: baht(-8_000), openingDate: '2026-09-01' })
const invest = makeAccount({ id: 'invest', name: 'Investment', kind: 'investment', openingBalanceSatang: baht(100_000), openingDate: '2026-09-01' })
const accounts = [kbank, cash, scb, card, invest]
const transfer = (amount = 5_000, overrides = {}) => makeTx({ id: 't1', type: 'transfer', amountSatang: baht(amount), accountId: 'kbank', toAccountId: 'cash', date: '2026-09-25', ...overrides })

describe('balances and available money', () => {
  it('available money = active cash/bank/savings/e-wallet only (not investment, card or archived)', () => {
    expect(calculateAvailableMoney(accounts, [])).toEqual({ total: baht(70_000), accountCount: 3 })
    expect(calculateAvailableMoney([...accounts.filter((a) => a.id !== 'scb'), { ...scb, archivedAt: 'x' }], [])).toEqual({ total: baht(50_000), accountCount: 2 })
  })

  it('a transfer moves money: source −, destination +, total available unchanged, never income or expense', () => {
    const txs = [transfer()]
    const balances = accountBalances(accounts, txs)
    expect(balances.get('kbank')).toBe(baht(45_000))
    expect(balances.get('cash')).toBe(baht(5_000))
    expect(calculateAvailableMoney(accounts, txs).total).toBe(baht(70_000))
    expect(monthTotals(txs, '2026-09')).toMatchObject({ income: 0, expense: 0, debtPayment: 0 })
    expect(cashFlow(txs, ['2026-09'])[0]).toMatchObject({ transfer: baht(5_000), income: 0, expense: 0, debtPayment: 0 })
    expect(calculateTransferEffect(txs[0]!)).toEqual([
      { accountId: 'kbank', deltaSatang: baht(-5_000) },
      { accountId: 'cash', deltaSatang: baht(5_000) },
    ])
  })

  it('historical: an account does not exist before its opening date; balances as of a date', () => {
    const txs = [makeTx({ type: 'expense', amountSatang: baht(1_000), accountId: 'kbank', date: '2026-09-20' })]
    expect(calculateAccountBalance(kbank, txs, '2026-08-31')).toBeNull()
    expect(calculateAccountBalance(kbank, txs, '2026-09-10')).toBe(baht(50_000))
    expect(calculateAccountBalance(kbank, txs)).toBe(baht(49_000))
    expect(calculateAvailableMoney(accounts, txs, '2026-08-31')).toEqual({ total: 0, accountCount: 0 })
    expect(isAccountActiveAtDate(kbank, '2026-09-01')).toBe(true)
    expect(isAccountActiveAtDate(kbank, '2026-08-31')).toBe(false)
  })

  it('credit card: owed = opening owed + purchases − card payments (from the card account)', () => {
    const txs = [
      makeTx({ type: 'expense', amountSatang: baht(1_200), accountId: 'card', date: '2026-09-21' }),
      makeTx({ type: 'debt_payment', amountSatang: baht(3_000), accountId: 'kbank', toAccountId: 'card', debtId: 'cc', date: '2026-09-22' }),
    ]
    expect(calculateAccountBalance(card, txs)).toBe(baht(-6_200))
    expect(creditCardOwed(accounts, txs)).toBe(baht(6_200))
    expect(calculateAvailableMoney(accounts, txs).total).toBe(baht(67_000)) // the payment left KBank
    expect(monthTotals(txs, '2026-09')).toMatchObject({ expense: baht(1_200), debtPayment: baht(3_000), income: 0 })
  })

  it('archived accounts are not selectable but keep their history', () => {
    const archived = { ...scb, archivedAt: '2026-09-26T00:00:00Z' }
    expect(isAccountSelectable(archived)).toBe(false)
    expect(isAccountSelectable(scb)).toBe(true)
    const txs = [makeTx({ id: 'old', type: 'income', amountSatang: baht(1), accountId: 'scb', date: '2026-09-10' })]
    expect(transactionsForAccount('scb', txs).map((tx) => tx.id)).toEqual(['old'])
    expect(calculateAccountBalance(archived, txs)).toBe(baht(20_001))
  })
})

describe('accountActivity', () => {
  it('totals by type for an asset account, and purchases/payments for a card', () => {
    const txs = [
      makeTx({ id: 'a', type: 'income', amountSatang: baht(27_500), accountId: 'kbank', date: '2026-09-25' }),
      makeTx({ id: 'b', type: 'expense', amountSatang: baht(1_000), accountId: 'kbank', date: '2026-09-25' }),
      transfer(5_000),
      makeTx({ id: 'c', type: 'transfer', amountSatang: baht(2_000), accountId: 'scb', toAccountId: 'kbank', date: '2026-09-25' }),
      makeTx({ id: 'd', type: 'debt_payment', amountSatang: baht(3_000), accountId: 'kbank', toAccountId: 'card', debtId: 'cc', date: '2026-09-25' }),
      makeTx({ id: 'e', type: 'expense', amountSatang: baht(1_200), accountId: 'card', date: '2026-09-25' }),
      makeTx({ id: 'early', type: 'income', amountSatang: baht(9), accountId: 'kbank', date: '2026-08-01' }),
    ]
    expect(accountActivity(kbank, txs)).toMatchObject({ incomeIn: baht(27_500), expensesOut: baht(1_000), transfersIn: baht(2_000), transfersOut: baht(5_000), debtPaymentsOut: baht(3_000), count: 5 })
    expect(accountActivity(card, txs)).toMatchObject({ expensesOut: baht(1_200), debtPaymentsIn: baht(3_000), incomeIn: 0, transfersIn: 0 })
    expect(transactionsForAccount('kbank', txs)[0]?.date).toBe('2026-09-25')
  })
})

describe('transfer validation (buildTransaction)', () => {
  const context: DraftContext = {
    accounts: new Map<ID, (typeof accounts)[number]>(accounts.map((a) => [a.id, a])),
    categories: new Map([['food', makeCategory({ id: 'food' })]]),
    debts: new Map([['cc', { ...makeDebt({ id: 'cc', kind: 'credit_card', linkedAccountId: 'card' }) }]]),
  }
  const draft = (overrides: Partial<TransactionDraft> = {}): TransactionDraft => ({ type: 'transfer', amountSatang: baht(5_000), accountId: 'kbank', toAccountId: 'cash', date: '2026-09-25', ...overrides })
  const build = (overrides: Partial<TransactionDraft> = {}) => buildTransaction(draft(overrides), context, { id: 't', now: 'n' })

  it('builds a transfer with source and destination', () => {
    const result = build({ note: 'ถอนเงินสด' })
    expect(result.ok && result.transaction).toMatchObject({ type: 'transfer', accountId: 'kbank', toAccountId: 'cash', amountSatang: baht(5_000), note: 'ถอนเงินสด' })
    expect(result.ok && result.transaction).not.toHaveProperty('categoryId')
  })

  it.each([
    [{ accountId: undefined }, 'account_required'],
    [{ toAccountId: undefined }, 'to_account_required'],
    [{ toAccountId: 'kbank' }, 'same_account'],
    [{ amountSatang: baht(0) }, 'amount_must_be_positive'],
    [{ amountSatang: baht(-5) }, 'amount_must_be_positive'],
    [{ toAccountId: 'ghost' }, 'unknown_to_account'],
    [{ toAccountId: 'card' }, 'transfer_liability_not_allowed'],
    [{ accountId: 'card' }, 'transfer_liability_not_allowed'],
  ] as const)('rejects %j with %s', (overrides, issue) => {
    const result = build(overrides as Partial<TransactionDraft>)
    expect(!result.ok && result.issues).toContain(issue)
  })

  it('never silently swaps source and destination', () => {
    const result = build({ accountId: 'cash', toAccountId: 'kbank' })
    expect(result.ok && [result.transaction.accountId, result.transaction.toAccountId]).toEqual(['cash', 'kbank'])
  })

  it('validateTransferAccounts: asset ↔ asset only', () => {
    expect(validateTransferAccounts(kbank, invest)).toEqual([])
    expect(validateTransferAccounts(kbank, card)).toEqual(['transfer_liability_not_allowed'])
    expect(validateTransferAccounts(card, kbank)).toEqual(['transfer_liability_not_allowed'])
  })
})

describe('buildAccount', () => {
  const ctx = (overrides: Partial<AccountContext> = {}): AccountContext => ({ accounts: [kbank], transactions: [], linkedToDebt: false, ...overrides })
  const draft = (overrides: Partial<AccountDraft> = {}): AccountDraft => ({ name: ' SCB ', kind: 'bank', openingAmountSatang: baht(20_000), openingDate: '2026-09-01', ...overrides })
  const meta = { id: 'new', now: 'now', sortOrder: 3 }

  it('stores the opening balance as the starting state (no transaction); a card opening is what is owed, stored negative', () => {
    const bank = buildAccount(draft(), ctx(), meta)
    expect(bank.ok && bank.account).toMatchObject({ id: 'new', name: 'SCB', kind: 'bank', openingBalanceSatang: baht(20_000), openingDate: '2026-09-01', currency: 'THB', sortOrder: 3 })
    const cardResult = buildAccount(draft({ name: 'KBank Credit Card', kind: 'credit_card', openingAmountSatang: baht(8_000) }), ctx(), meta)
    expect(cardResult.ok && cardResult.account.openingBalanceSatang).toBe(baht(-8_000))
    expect(cardResult.ok && openingAmountOf(cardResult.account)).toBe(baht(8_000))
    const empty = buildAccount(draft({ openingAmountSatang: null }), ctx(), meta)
    expect(empty.ok && empty.account.openingBalanceSatang).toBe(0)
    expect(buildAccount(draft({ kind: 'other' }), ctx(), meta).ok).toBe(true)
  })

  it.each([
    [{ name: '  ' }, 'name_required'],
    [{ name: 'kbank' }, 'name_taken'],
    [{ kind: 'loan' }, 'kind_invalid'],
    [{ openingAmountSatang: baht(-1) }, 'opening_invalid'],
    [{ openingDate: '2026-02-30' }, 'opening_date_invalid'],
  ] as const)('rejects %j with %s', (overrides, issue) => {
    const result = buildAccount(draft(overrides as Partial<AccountDraft>), ctx(), meta)
    expect(!result.ok && result.issues).toContain(issue)
  })

  it('an archived account’s name can be reused', () => {
    expect(buildAccount(draft({ name: 'KBank' }), ctx({ accounts: [{ ...kbank, archivedAt: 'x' }] }), meta).ok).toBe(true)
  })

  it('edits keep id/createdAt/sortOrder; kind changes only within its class and not for a debt-linked card', () => {
    const existing = { ...scb, createdAt: 'created', sortOrder: 7 }
    const savings = buildAccount(draft({ kind: 'savings' }), ctx(), { ...meta, existing })
    expect(savings.ok && savings.account).toMatchObject({ id: 'scb', kind: 'savings', createdAt: 'created', sortOrder: 7 })
    expect(buildAccount(draft({ kind: 'credit_card' }), ctx(), { ...meta, existing })).toEqual({ ok: false, issues: ['kind_change_not_allowed'] })
    expect(buildAccount(draft({ kind: 'cash' }), ctx({ linkedToDebt: true }), { ...meta, existing })).toEqual({ ok: false, issues: ['kind_linked_to_debt'] })
  })

  it('the opening date cannot move after the first transaction; a new opening balance is applied as the starting state', () => {
    const txs = [{ date: '2026-09-05', accountId: 'scb' }]
    expect(buildAccount(draft({ openingDate: '2026-09-10' }), ctx({ transactions: txs }), { ...meta, existing: scb })).toEqual({ ok: false, issues: ['opening_after_transactions'] })
    const moved = buildAccount(draft({ openingAmountSatang: baht(25_000) }), ctx({ transactions: txs }), { ...meta, existing: scb })
    expect(moved.ok && moved.account.openingBalanceSatang).toBe(baht(25_000))
  })
})
