import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { calculateAvailableMoney, creditCardOwed } from '@/domain/accounts'
import type { AccountDraft } from '@/domain/accounts'
import { accountBalances, cashFlow, monthTotals } from '@/domain/reporting'
import type { TransactionDraft } from '@/domain/transactions'
import { baht, makeCategory } from '@/test/factories'
import { FinanceDatabase } from '../dexie'
import { StorageError } from '../errors'
import { AccountValidationError, createAccountsRepository } from './accounts'
import { createDebtsRepository } from './debts'
import { createRecurringObligationsRepository, ObligationValidationError } from './recurring-obligations'
import { createScheduledPaymentsRepository } from './scheduled-payments'
import { createTransactionsRepository, ExpenseValidationError } from './transactions'

const TODAY = '2026-09-25'
let database: FinanceDatabase
let accounts: ReturnType<typeof createAccountsRepository>
let transactions: ReturnType<typeof createTransactionsRepository>
let counter = 0
const newId = () => `id-${++counter}`
const now = `${TODAY}T03:00:00.000Z`
const meta = { now, newId }

const account = (overrides: Partial<AccountDraft> = {}): AccountDraft => ({ name: 'KBank', kind: 'bank', openingAmountSatang: baht(50_000), openingDate: '2026-09-01', ...overrides })
const transfer = (overrides: Partial<TransactionDraft> = {}): TransactionDraft => ({ type: 'transfer', amountSatang: baht(5_000), accountId: 'kbank', toAccountId: 'cash', date: TODAY, ...overrides })

async function state() {
  const [accts, txs] = await Promise.all([database.accounts.toArray(), database.transactions.toArray()])
  return { balances: accountBalances(accts, txs), available: calculateAvailableMoney(accts, txs).total, totals: monthTotals(txs, '2026-09'), flow: cashFlow(txs, ['2026-09'])[0]!, txs, cardOwed: creditCardOwed(accts, txs) }
}

async function seed() {
  await accounts.create(account(), { id: 'kbank', now })
  await accounts.create(account({ name: 'เงินสด', kind: 'cash', openingAmountSatang: baht(0) }), { id: 'cash', now })
  await accounts.create(account({ name: 'SCB', openingAmountSatang: baht(20_000) }), { id: 'scb', now })
  await accounts.create(account({ name: 'KBank Credit Card', kind: 'credit_card', openingAmountSatang: baht(8_000) }), { id: 'card', now })
  await accounts.create(account({ name: 'Investment', kind: 'investment', openingAmountSatang: baht(100_000) }), { id: 'invest', now })
  await database.categories.bulkAdd([makeCategory({ id: 'food', name: 'อาหาร' }), makeCategory({ id: 'salary', name: 'เงินเดือน', kind: 'income' })])
}

beforeEach(async () => {
  database = new FinanceDatabase(`accounts-${crypto.randomUUID()}`)
  accounts = createAccountsRepository(database)
  transactions = createTransactionsRepository(database)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await database.delete()
})

describe('accounts', () => {
  it('creates accounts with opening balances as starting state — no transactions; available money excludes investment and card', async () => {
    await seed()
    expect(await database.transactions.count()).toBe(0)
    expect(await database.accounts.get('card')).toMatchObject({ kind: 'credit_card', openingBalanceSatang: baht(-8_000) })
    const { available, cardOwed, balances } = await state()
    expect(available).toBe(baht(70_000))
    expect(cardOwed).toBe(baht(8_000))
    expect(balances.get('invest')).toBe(baht(100_000))
    expect((await accounts.listAll()).map((a) => a.id)).toEqual(['kbank', 'cash', 'scb', 'card', 'invest'])
  })

  it('create is idempotent on its id and validates', async () => {
    await Promise.all([accounts.create(account(), { id: 'kbank', now }), accounts.create(account(), { id: 'kbank', now })])
    expect(await database.accounts.count()).toBe(1)
    await expect(accounts.create(account({ name: ' ' }), { id: 'x', now })).rejects.toMatchObject({ issues: ['name_required'] })
    await expect(accounts.create(account({ name: 'kbank' }), { id: 'x', now })).rejects.toMatchObject({ issues: ['name_taken'] })
    expect(await database.accounts.count()).toBe(1)
  })

  it('update edits in place; opening date may not pass the first transaction; card ↔ asset is refused', async () => {
    await seed()
    await transactions.create(transfer({ date: '2026-09-05' }), [], { id: 't1', ...meta })
    const updated = await accounts.update('kbank', account({ name: 'KBank ออมทรัพย์', kind: 'savings', openingAmountSatang: baht(51_000) }), { now: 'later' })
    expect(updated).toMatchObject({ id: 'kbank', kind: 'savings', openingBalanceSatang: baht(51_000), createdAt: now, sortOrder: 0 })
    expect((await state()).balances.get('kbank')).toBe(baht(46_000))
    expect(await database.transactions.count()).toBe(1) // editing an account never creates transactions
    await expect(accounts.update('kbank', account({ openingDate: '2026-09-10' }), { now })).rejects.toMatchObject({ issues: ['opening_after_transactions'] })
    await expect(accounts.update('kbank', account({ kind: 'credit_card' }), { now })).rejects.toMatchObject({ issues: ['kind_change_not_allowed'] })
  })

  it('archive keeps history, leaves selectors and available money; restore brings it back', async () => {
    await seed()
    await transactions.create(transfer({ toAccountId: 'scb' }), [], { id: 't1', ...meta })
    await accounts.archive('scb', { now })
    expect((await accounts.listActive()).map((a) => a.id)).not.toContain('scb')
    expect(await database.transactions.get('t1')).toBeDefined()
    expect((await state()).available).toBe(baht(45_000)) // KBank 45,000 + cash 0; SCB (25,000) excluded
    expect((await state()).balances.get('scb')).toBe(baht(25_000))
    await accounts.restore('scb', { now })
    expect((await state()).available).toBe(baht(70_000))
  })

  it('a card account tracked by a live debt cannot be archived', async () => {
    await seed()
    await createDebtsRepository(database).create({ name: 'KTC', kind: 'credit_card', openingBalanceSatang: null, openingDate: TODAY, interestMethod: 'unknown', linkedAccountId: 'card' }, { ...meta, today: TODAY, id: 'cc' })
    await expect(accounts.archive('card', { now })).rejects.toBeInstanceOf(AccountValidationError)
    expect((await database.accounts.get('card'))?.archivedAt).toBeUndefined()
  })

  it('lists accounts that existed on a date', async () => {
    await seed()
    await accounts.create(account({ name: 'Later', openingDate: '2026-10-01' }), { id: 'later', now })
    expect((await accounts.listForDate('2026-09-30')).map((a) => a.id)).not.toContain('later')
    expect((await accounts.listForDate('2026-08-31')).length).toBe(0)
  })
})

describe('transfers', () => {
  beforeEach(seed)

  it('create: source −, destination +, available unchanged, only the transfer series moves', async () => {
    const before = await state()
    const { transaction } = await transactions.create(transfer(), [], { id: 't1', ...meta })
    expect(transaction).toMatchObject({ type: 'transfer', accountId: 'kbank', toAccountId: 'cash', amountSatang: baht(5_000) })
    const after = await state()
    expect(after.balances.get('kbank')).toBe(baht(45_000))
    expect(after.balances.get('cash')).toBe(baht(5_000))
    expect(after.available).toBe(before.available)
    expect(after.totals).toMatchObject({ income: 0, expense: 0, debtPayment: 0 })
    expect(after.flow).toMatchObject({ transfer: baht(5_000), income: 0, expense: 0, debtPayment: 0 })
    expect((await transactions.listBetween('2026-09-01', '2026-09-30', 'transfer')).map((tx) => tx.id)).toEqual(['t1'])
    expect((await transactions.listForAccount('cash')).map((tx) => tx.id)).toEqual(['t1'])
  })

  it('double-click creates one transfer', async () => {
    await Promise.all([transactions.create(transfer(), [], { id: 't1', ...meta }), transactions.create(transfer(), [], { id: 't1', ...meta })])
    expect(await database.transactions.count()).toBe(1)
  })

  it('edit keeps id/createdAt and moves both balances by the difference', async () => {
    const { transaction } = await transactions.create(transfer(), [], { id: 't1', ...meta })
    await Promise.all([
      transactions.update('t1', transfer({ amountSatang: baht(7_000) }), { add: [], remove: [] }, { now: 'later', newId }),
      transactions.update('t1', transfer({ amountSatang: baht(7_000) }), { add: [], remove: [] }, { now: 'later', newId }),
    ])
    const after = await state()
    expect(after.txs).toHaveLength(1)
    expect(after.txs[0]).toMatchObject({ id: 't1', createdAt: transaction.createdAt, amountSatang: baht(7_000) })
    expect(after.balances.get('kbank')).toBe(baht(43_000))
    expect(after.balances.get('cash')).toBe(baht(7_000))
    expect(after.available).toBe(baht(70_000))
  })

  it('delete restores both balances and removes its attachments', async () => {
    await transactions.create(transfer(), [{ blob: new Blob(['slip']), fileName: 'slip.jpg', mimeType: 'image/jpeg' }], { id: 't1', ...meta })
    expect(await database.attachments.count()).toBe(1)
    await transactions.delete('t1', { now })
    const after = await state()
    expect(after.balances.get('kbank')).toBe(baht(50_000))
    expect(after.balances.get('cash')).toBe(0)
    expect(await database.attachments.count()).toBe(0)
    expect(await database.attachmentBlobs.count()).toBe(0)
  })

  it('a failed write leaves nothing behind (atomic)', async () => {
    vi.spyOn(database.attachmentBlobs, 'bulkAdd').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'))
    await expect(transactions.create(transfer(), [{ blob: new Blob(['slip']), fileName: 'slip.jpg', mimeType: 'image/jpeg' }], { id: 't1', ...meta })).rejects.toBeInstanceOf(StorageError)
    expect(await database.transactions.count()).toBe(0)
    expect(await database.attachments.count()).toBe(0)
    expect((await state()).balances.get('kbank')).toBe(baht(50_000))
  })

  it('refuses archived accounts for new transfers, and an edit cannot switch to one — but can keep one it already used', async () => {
    await transactions.create(transfer({ toAccountId: 'scb' }), [], { id: 'old', ...meta })
    await accounts.archive('scb', { now })
    await expect(transactions.create(transfer({ toAccountId: 'scb' }), [], { id: 't2', ...meta })).rejects.toMatchObject({ issues: ['unknown_to_account'] })
    await expect(transactions.update('old', transfer({ toAccountId: 'scb', amountSatang: baht(6_000) }), { add: [], remove: [] }, { now, newId })).resolves.toMatchObject({ amountSatang: baht(6_000) })
    await transactions.create(transfer(), [], { id: 't3', ...meta })
    await expect(transactions.update('t3', transfer({ toAccountId: 'scb' }), { add: [], remove: [] }, { now, newId })).rejects.toBeInstanceOf(ExpenseValidationError)
  })

  it('never moves money into or out of a credit card (purchases and card payments keep their own rules)', async () => {
    await expect(transactions.create(transfer({ toAccountId: 'card' }), [], { id: 't1', ...meta })).rejects.toMatchObject({ issues: ['transfer_liability_not_allowed'] })
    await expect(transactions.create(transfer({ accountId: 'card' }), [], { id: 't2', ...meta })).rejects.toMatchObject({ issues: ['transfer_liability_not_allowed'] })
    expect(await database.transactions.count()).toBe(0)
  })
})

describe('the other transaction types still behave', () => {
  beforeEach(seed)

  it('income, expense, card purchase and card payment each stay what they are', async () => {
    await createDebtsRepository(database).create({ name: 'KTC', kind: 'credit_card', openingBalanceSatang: null, openingDate: TODAY, interestMethod: 'unknown', linkedAccountId: 'card' }, { ...meta, today: TODAY, id: 'cc' })
    await transactions.create({ type: 'income', amountSatang: baht(27_500), accountId: 'kbank', categoryId: 'salary', date: TODAY }, [], { id: 'i1', ...meta })
    await transactions.createExpense({ amountSatang: baht(1_000), accountId: 'kbank', categoryId: 'food', date: TODAY }, [], { id: 'e1', ...meta })
    await transactions.createExpense({ amountSatang: baht(1_200), accountId: 'card', categoryId: 'food', date: TODAY }, [], { id: 'e2', ...meta })
    expect((await state()).cardOwed).toBe(baht(9_200))
    await transactions.create({ type: 'debt_payment', amountSatang: baht(3_000), accountId: 'kbank', debtId: 'cc', date: TODAY }, [], { id: 'p1', ...meta })
    await transactions.create(transfer(), [], { id: 't1', ...meta })
    const { totals, flow, cardOwed, balances, available } = await state()
    expect(cardOwed).toBe(baht(6_200))
    expect(totals).toMatchObject({ income: baht(27_500), expense: baht(2_200), debtPayment: baht(3_000) })
    expect(flow).toMatchObject({ income: baht(27_500), expense: baht(2_200), debtPayment: baht(3_000), transfer: baht(5_000) })
    expect(balances.get('kbank')).toBe(baht(50_000 + 27_500 - 1_000 - 3_000 - 5_000))
    expect(available).toBe(baht(70_000 + 27_500 - 1_000 - 3_000))
  })

  it('recurring rules cannot use an archived account; paying still works with an active one', async () => {
    const obligations = createRecurringObligationsRepository(database)
    const scheduled = createScheduledPaymentsRepository(database)
    const rule = { name: 'ค่าเน็ต', amountSatang: baht(599), categoryId: 'food', defaultAccountId: 'scb', recurrence: { frequency: 'monthly' as const, interval: 1, startDate: '2026-09-01', dayOfMonth: 28 } }
    await obligations.create(rule, { ...meta, today: TODAY, id: 'net' })
    await accounts.archive('scb', { now })
    await expect(obligations.create({ ...rule, name: 'อื่น' }, { ...meta, today: TODAY, id: 'net2' })).rejects.toBeInstanceOf(ObligationValidationError)
    const [occurrence] = await scheduled.listForSource('obligation', 'net')
    await expect(scheduled.markPaid(occurrence!.id, { type: 'expense', amountSatang: baht(599), accountId: 'scb', categoryId: 'food', date: TODAY }, [], { transactionId: 'x', now, newId })).rejects.toBeInstanceOf(ExpenseValidationError)
    await scheduled.markPaid(occurrence!.id, { type: 'expense', amountSatang: baht(599), accountId: 'kbank', categoryId: 'food', date: TODAY }, [], { transactionId: 'y', now, newId })
    expect(await database.transactions.count()).toBe(1)
  })
})
