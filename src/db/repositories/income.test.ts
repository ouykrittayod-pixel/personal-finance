import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduledPayment } from '@/domain/entities'
import { incomePeriodTotal } from '@/domain/income'
import { accountBalances, cashFlow, monthTotals } from '@/domain/reporting'
import type { ObligationDraft } from '@/domain/scheduling'
import type { TransactionDraft } from '@/domain/transactions'
import { baht, makeAccount, makeCategory } from '@/test/factories'
import { FinanceDatabase } from '../dexie'
import { StorageError } from '../errors'
import { createRecurringObligationsRepository } from './recurring-obligations'
import { createScheduledPaymentsRepository, PaymentAlreadySettledError, paymentTypeFor } from './scheduled-payments'
import { createTransactionsRepository, ExpenseValidationError } from './transactions'

const TODAY = '2026-09-25'
const SEPTEMBER = { start: '2026-09-01', end: '2026-09-30' }
let database: FinanceDatabase
let transactions: ReturnType<typeof createTransactionsRepository>
let obligations: ReturnType<typeof createRecurringObligationsRepository>
let scheduled: ReturnType<typeof createScheduledPaymentsRepository>
let counter = 0
const newId = () => `id-${++counter}`
const meta = (today = TODAY) => ({ now: `${today}T03:00:00.000Z`, today, newId })
const noFiles = { add: [], remove: [] }

const income = (overrides: Partial<TransactionDraft> = {}): TransactionDraft => ({
  type: 'income',
  amountSatang: baht(27_500),
  accountId: 'kbank',
  categoryId: 'salary',
  date: TODAY,
  description: 'เงินเดือน กันยายน',
  ...overrides,
})

const salaryRule = (overrides: Partial<ObligationDraft> = {}): ObligationDraft => ({
  name: 'เงินเดือน',
  kind: 'income',
  amountSatang: baht(27_500),
  categoryId: 'salary',
  defaultAccountId: 'kbank',
  recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-01-01', dayOfMonth: 25 },
  ...overrides,
})

const byDue = (payments: ScheduledPayment[]) => [...payments].sort((a, b) => a.dueDate.localeCompare(b.dueDate))
const occurrences = async (id: string) => byDue(await scheduled.listForSource('obligation', id))
const snapshot = async () => {
  const [accounts, txs] = await Promise.all([database.accounts.toArray(), database.transactions.toArray()])
  return { balances: accountBalances(accounts, txs), totals: monthTotals(txs, '2026-09'), income: incomePeriodTotal(txs, SEPTEMBER), txs }
}

beforeEach(async () => {
  database = new FinanceDatabase(`income-${crypto.randomUUID()}`)
  transactions = createTransactionsRepository(database)
  obligations = createRecurringObligationsRepository(database)
  scheduled = createScheduledPaymentsRepository(database)
  await database.accounts.bulkAdd([
    makeAccount({ id: 'kbank', name: 'KBank', kind: 'bank', openingBalanceSatang: baht(1_000) }),
    makeAccount({ id: 'scb', name: 'SCB', kind: 'bank', openingBalanceSatang: baht(0) }),
    makeAccount({ id: 'cash', name: 'เงินสด', kind: 'cash', openingBalanceSatang: baht(0) }),
    makeAccount({ id: 'card', name: 'บัตร', kind: 'credit_card' }),
  ])
  await database.categories.bulkAdd([
    makeCategory({ id: 'salary', name: 'เงินเดือน', kind: 'income' }),
    makeCategory({ id: 'side', name: 'รายได้เสริม', kind: 'income' }),
    makeCategory({ id: 'food', name: 'อาหาร', kind: 'expense' }),
  ])
})

afterEach(async () => {
  vi.restoreAllMocks()
  await database.delete()
})

describe('income transactions', () => {
  it('creates an income in the shared transactions table and raises the receiving account', async () => {
    const { transaction } = await transactions.create(income(), [], { id: 'i1', ...meta() })
    expect(transaction).toMatchObject({ id: 'i1', type: 'income', amountSatang: baht(27_500), categoryId: 'salary', accountId: 'kbank', description: 'เงินเดือน กันยายน' })
    const { balances, totals } = await snapshot()
    expect(balances.get('kbank')).toBe(baht(28_500))
    expect(totals).toMatchObject({ income: baht(27_500), expense: 0, debtPayment: 0 })
  })

  it.each([
    [{ amountSatang: baht(0) }, 'amount_must_be_positive'],
    [{ amountSatang: null }, 'amount_required'],
    [{ accountId: undefined }, 'account_required'],
    [{ categoryId: undefined }, 'category_required'],
    [{ categoryId: 'food' }, 'category_not_income'],
  ] as const)('rejects %j with %s and writes nothing', async (overrides, issue) => {
    await expect(transactions.create(income(overrides as Partial<TransactionDraft>), [], { id: 'i1', ...meta() })).rejects.toMatchObject({ issues: expect.arrayContaining([issue]) })
    expect(await database.transactions.count()).toBe(0)
  })

  it('is idempotent on its id (double-click saves one income)', async () => {
    await Promise.all([transactions.create(income(), [], { id: 'i1', ...meta() }), transactions.create(income(), [], { id: 'i1', ...meta() })])
    expect(await database.transactions.count()).toBe(1)
  })

  it('an edit keeps id and createdAt and moves the balance by the difference only', async () => {
    const { transaction } = await transactions.create(income(), [], { id: 'i1', ...meta() })
    const updated = await transactions.update('i1', income({ amountSatang: baht(30_000) }), noFiles, meta('2026-09-26'))
    expect(updated).toMatchObject({ id: 'i1', createdAt: transaction.createdAt, amountSatang: baht(30_000) })
    const { balances, txs, income: total } = await snapshot()
    expect(txs).toHaveLength(1)
    expect(balances.get('kbank')).toBe(baht(1_000 + 30_000))
    expect(total.total).toBe(baht(30_000))
  })

  it('an edit to an expense category or no account is rejected and the old version stays', async () => {
    const { transaction } = await transactions.create(income(), [], { id: 'i1', ...meta() })
    await expect(transactions.update('i1', income({ categoryId: 'food' }), noFiles, meta())).rejects.toBeInstanceOf(ExpenseValidationError)
    await expect(transactions.update('i1', income({ accountId: undefined }), noFiles, meta())).rejects.toBeInstanceOf(ExpenseValidationError)
    expect(await database.transactions.get('i1')).toEqual(transaction)
  })

  it('delete removes the income and its attachments and restores the balance', async () => {
    await transactions.create(income(), [{ blob: new Blob(['slip']), fileName: 'slip.pdf', mimeType: 'application/pdf' }], { id: 'i1', ...meta() })
    expect(await database.attachments.count()).toBe(1)
    await transactions.delete('i1', meta())
    expect(await database.transactions.count()).toBe(0)
    expect(await database.attachments.count()).toBe(0)
    expect(await database.attachmentBlobs.count()).toBe(0)
    expect((await snapshot()).balances.get('kbank')).toBe(baht(1_000))
  })

  it('a failed delete leaves income, attachments and balance untouched (atomic)', async () => {
    await transactions.create(income(), [{ blob: new Blob(['slip']), fileName: 'slip.pdf', mimeType: 'application/pdf' }], { id: 'i1', ...meta() })
    vi.spyOn(database.transactions, 'delete').mockRejectedValueOnce(new DOMException('boom', 'UnknownError'))
    await expect(transactions.delete('i1', meta())).rejects.toBeInstanceOf(StorageError)
    expect(await database.transactions.count()).toBe(1)
    expect(await database.attachments.count()).toBe(1)
    expect(await database.attachmentBlobs.count()).toBe(1)
  })

  it('transfers, expenses and debt payments are never income; transfers keep their own cash-flow series', async () => {
    await transactions.create(income(), [], { id: 'i1', ...meta() })
    await transactions.create({ type: 'transfer', amountSatang: baht(5_000), accountId: 'kbank', toAccountId: 'cash', date: TODAY }, [], { id: 't1', ...meta() })
    await transactions.create({ type: 'expense', amountSatang: baht(200), accountId: 'cash', categoryId: 'food', date: TODAY }, [], { id: 'e1', ...meta() })
    const { balances, totals, income: total, txs } = await snapshot()
    expect(total).toMatchObject({ total: baht(27_500), count: 1 })
    expect(totals).toMatchObject({ income: baht(27_500), expense: baht(200) })
    expect(balances.get('kbank')).toBe(baht(1_000 + 27_500 - 5_000))
    expect(balances.get('cash')).toBe(baht(5_000 - 200))
    expect(cashFlow(txs, ['2026-09'])[0]).toEqual({ month: '2026-09', income: baht(27_500), expense: baht(200), debtPayment: 0, transfer: baht(5_000) })
  })
})

describe('recurring income', () => {
  beforeEach(async () => {
    await obligations.create(salaryRule(), { ...meta(), id: 'salary-rule' })
  })

  it('reuses obligations + scheduled payments; generation creates expected occurrences, never income', async () => {
    expect(await database.recurringObligations.get('salary-rule')).toMatchObject({ kind: 'income', categoryId: 'salary' })
    expect((await occurrences('salary-rule')).map((p) => [p.dueDate, p.status, p.expectedAmountSatang])).toEqual([
      ['2026-09-25', 'pending', baht(27_500)],
      ['2026-10-25', 'pending', baht(27_500)],
      ['2026-11-25', 'pending', baht(27_500)],
      ['2026-12-25', 'pending', baht(27_500)],
    ])
    expect(await database.transactions.count()).toBe(0)
    expect(paymentTypeFor((await occurrences('salary-rule'))[0]!, { kind: 'income' })).toEqual({ type: 'income' })
  })

  it('generation is idempotent (reloads never duplicate)', async () => {
    expect(await scheduled.generateMissing(TODAY, meta())).toBe(0)
    expect(await scheduled.generateMissing(TODAY, meta())).toBe(0)
    expect(await database.scheduledPayments.count()).toBe(4)
  })

  it('receiving creates one income with the actual amount and date, links it and keeps the rule amount', async () => {
    const [first] = await occurrences('salary-rule')
    const result = await scheduled.markPaid(first!.id, income({ amountSatang: baht(28_200), date: '2026-09-26' }), [], { transactionId: 'r1', now: meta().now, newId })
    expect(result.transaction).toMatchObject({ id: 'r1', type: 'income', amountSatang: baht(28_200), date: '2026-09-26', categoryId: 'salary', scheduledPaymentId: first!.id })
    expect(await scheduled.get(first!.id)).toMatchObject({ status: 'paid', transactionId: 'r1', paidDate: '2026-09-26', expectedAmountSatang: baht(27_500) })
    expect((await database.recurringObligations.get('salary-rule'))?.expectedAmountSatang).toBe(baht(27_500))
    expect((await snapshot()).balances.get('kbank')).toBe(baht(29_200))
  })

  it('a double-click on confirm receives once', async () => {
    const [first] = await occurrences('salary-rule')
    const receive = () => scheduled.markPaid(first!.id, income(), [], { transactionId: 'r1', now: meta().now, newId })
    const results = await Promise.all([receive(), receive()])
    expect(results.map((r) => r.status).sort()).toEqual(['already_paid', 'paid'])
    expect(await database.transactions.count()).toBe(1)
    await expect(scheduled.markPaid(first!.id, income(), [], { transactionId: 'r2', now: meta().now, newId })).rejects.toBeInstanceOf(PaymentAlreadySettledError)
  })

  it('a receipt with an expense category is rejected (the rule stays income)', async () => {
    const [first] = await occurrences('salary-rule')
    await expect(scheduled.markPaid(first!.id, income({ categoryId: 'food' }), [], { transactionId: 'r1', now: meta().now, newId })).rejects.toMatchObject({ issues: ['category_not_income'] })
    expect((await scheduled.get(first!.id))?.status).toBe('pending')
  })

  it('a failure part-way rolls everything back: no income, no attachment, still unpaid', async () => {
    const [first] = await occurrences('salary-rule')
    vi.spyOn(database.scheduledPayments, 'put').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'))
    const file = { blob: new Blob(['slip']), fileName: 'slip.pdf', mimeType: 'application/pdf' }
    await expect(scheduled.markPaid(first!.id, income(), [file], { transactionId: 'r1', now: meta().now, newId })).rejects.toBeInstanceOf(StorageError)
    expect(await database.transactions.count()).toBe(0)
    expect(await database.attachments.count()).toBe(0)
    expect(await database.attachmentBlobs.count()).toBe(0)
    expect((await scheduled.get(first!.id))?.status).toBe('pending')
    expect((await snapshot()).balances.get('kbank')).toBe(baht(1_000))
  })

  it('deleting the received income makes the occurrence unpaid again', async () => {
    const [first] = await occurrences('salary-rule')
    await scheduled.markPaid(first!.id, income(), [], { transactionId: 'r1', now: meta().now, newId })
    await transactions.delete('r1', meta())
    const payment = await scheduled.get(first!.id)
    expect(payment?.status).toBe('pending')
    expect(payment).not.toHaveProperty('transactionId')
  })

  it('editing the rule changes future unpaid occurrences only; paid history and its income stay', async () => {
    const [first] = await occurrences('salary-rule')
    await scheduled.markPaid(first!.id, income(), [], { transactionId: 'r1', now: meta().now, newId })
    await obligations.update('salary-rule', salaryRule({ amountSatang: baht(30_000) }), meta())
    expect((await occurrences('salary-rule')).map((p) => [p.status, p.expectedAmountSatang])).toEqual([
      ['paid', baht(27_500)],
      ['pending', baht(30_000)],
      ['pending', baht(30_000)],
      ['pending', baht(30_000)],
    ])
    expect((await database.transactions.get('r1'))?.amountSatang).toBe(baht(27_500))
  })

  it('deleting the rule keeps received income and removes unpaid occurrences (no orphans)', async () => {
    const [first] = await occurrences('salary-rule')
    await scheduled.markPaid(first!.id, income(), [], { transactionId: 'r1', now: meta().now, newId })
    expect(await obligations.archive('salary-rule', meta())).toEqual({ removedUnpaid: 3 })
    expect((await occurrences('salary-rule')).map((p) => p.status)).toEqual(['paid'])
    expect(await database.transactions.get('r1')).toBeDefined()
    expect(await scheduled.generateMissing('2026-12-26', meta('2026-12-26'))).toBe(0)
    // Every remaining occurrence belongs to a rule that exists.
    const ruleIds = new Set((await database.recurringObligations.toArray()).map((o) => o.id))
    expect((await database.scheduledPayments.toArray()).every((p) => ruleIds.has(p.sourceId))).toBe(true)
  })
})
