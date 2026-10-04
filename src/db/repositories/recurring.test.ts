import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduledPayment } from '@/domain/entities'
import { accountBalances, debtSummary, monthTotals } from '@/domain/reporting'
import type { ObligationDraft } from '@/domain/scheduling'
import type { TransactionDraft } from '@/domain/transactions'
import { baht, makeAccount, makeCategory, makeDebt, makeTx } from '@/test/factories'
import { FinanceDatabase } from '../dexie'
import { StorageError } from '../errors'
import { createRecurringObligationsRepository, ObligationValidationError } from './recurring-obligations'
import { createScheduledPaymentsRepository, PaymentAlreadySettledError } from './scheduled-payments'
import { createTransactionsRepository } from './transactions'

const TODAY = '2026-09-25'
let database: FinanceDatabase
let obligations: ReturnType<typeof createRecurringObligationsRepository>
let scheduled: ReturnType<typeof createScheduledPaymentsRepository>
let counter = 0
const newId = () => `id-${++counter}`
const meta = (today = TODAY) => ({ now: `${today}T03:00:00.000Z`, today, newId })

const rentDraft = (overrides: Partial<ObligationDraft> = {}): ObligationDraft => ({
  name: 'ค่าเช่า',
  amountSatang: baht(7_800),
  categoryId: 'home',
  defaultAccountId: 'bank',
  recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-01-01', dayOfMonth: 6 },
  ...overrides,
})

const payDraft = (overrides: Partial<TransactionDraft> = {}): TransactionDraft => ({
  type: 'expense',
  amountSatang: baht(7_800),
  accountId: 'bank',
  categoryId: 'home',
  date: TODAY,
  description: 'ค่าเช่า',
  ...overrides,
})

const byDue = (payments: ScheduledPayment[]) => [...payments].sort((a, b) => a.dueDate.localeCompare(b.dueDate))
const paymentsOf = async (id: string) => byDue(await scheduled.listForSource('obligation', id))
const snapshot = async () => {
  const [accounts, transactions, debts] = await Promise.all([database.accounts.toArray(), database.transactions.toArray(), database.debts.toArray()])
  const balances = accountBalances(accounts, transactions)
  return { balances, transactions, totals: monthTotals(transactions, '2026-09'), debts: debtSummary(debts, transactions, accounts) }
}

beforeEach(async () => {
  database = new FinanceDatabase(`recurring-${crypto.randomUUID()}`)
  obligations = createRecurringObligationsRepository(database)
  scheduled = createScheduledPaymentsRepository(database)
  await database.accounts.bulkAdd([
    makeAccount({ id: 'bank', name: 'KBank', kind: 'bank', openingBalanceSatang: baht(50_000) }),
    makeAccount({ id: 'card', name: 'บัตรเครดิต', kind: 'credit_card' }),
  ])
  await database.categories.bulkAdd([makeCategory({ id: 'home', name: 'บ้าน' }), makeCategory({ id: 'food', name: 'อาหาร' })])
})

afterEach(async () => {
  vi.restoreAllMocks()
  await database.delete()
})

describe('create', () => {
  it('stores the rule and its occurrences from this month to the 3-month horizon — no transactions', async () => {
    const rule = await obligations.create(rentDraft(), { ...meta(), id: 'rent' })
    expect(rule).toMatchObject({ id: 'rent', name: 'ค่าเช่า', scheduleFrom: '2026-09-01' })
    expect((await paymentsOf('rent')).map((p) => [p.dueDate, p.status, p.expectedAmountSatang])).toEqual([
      ['2026-09-06', 'pending', baht(7_800)],
      ['2026-10-06', 'pending', baht(7_800)],
      ['2026-11-06', 'pending', baht(7_800)],
      ['2026-12-06', 'pending', baht(7_800)],
    ])
    expect(await database.transactions.count()).toBe(0)
    expect((await snapshot()).balances.get('bank')).toBe(baht(50_000))
  })

  it('validates through the domain and stores nothing when invalid', async () => {
    await expect(obligations.create(rentDraft({ name: '', amountSatang: baht(0) }), { ...meta(), id: 'x' })).rejects.toMatchObject({
      issues: expect.arrayContaining(['name_required', 'amount_must_be_positive']),
    })
    await expect(obligations.create(rentDraft({ recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-02-30' } }), { ...meta(), id: 'x' })).rejects.toBeInstanceOf(ObligationValidationError)
    expect(await database.recurringObligations.count()).toBe(0)
    expect(await database.scheduledPayments.count()).toBe(0)
  })
})

describe('generation', () => {
  it('is idempotent: running twice (or reopening the app) creates nothing new', async () => {
    await obligations.create(rentDraft(), { ...meta(), id: 'rent' })
    expect(await scheduled.generateMissing(TODAY, meta())).toBe(0)
    expect(await scheduled.generateMissing(TODAY, meta())).toBe(0)
    expect(await database.scheduledPayments.count()).toBe(4)
  })

  it('concurrent runs still produce no duplicates', async () => {
    await obligations.create(rentDraft(), { ...meta(), id: 'rent' })
    await Promise.all([scheduled.generateMissing('2026-10-25', meta('2026-10-25')), scheduled.generateMissing('2026-10-25', meta('2026-10-25'))])
    const dates = (await paymentsOf('rent')).map((p) => p.dueDate)
    expect(dates).toEqual(['2026-09-06', '2026-10-06', '2026-11-06', '2026-12-06', '2027-01-06'])
    expect(new Set(dates).size).toBe(dates.length)
  })

  it('the database itself rejects a duplicate occurrence', async () => {
    await obligations.create(rentDraft(), { ...meta(), id: 'rent' })
    const [first] = await paymentsOf('rent')
    await expect(database.scheduledPayments.add({ ...first!, id: 'dup' })).rejects.toThrow(Dexie.ConstraintError)
  })

  it('adds a new month as time passes', async () => {
    await obligations.create(rentDraft(), { ...meta(), id: 'rent' })
    expect(await scheduled.generateMissing('2026-10-10', meta('2026-10-10'))).toBe(1)
    expect((await paymentsOf('rent')).at(-1)?.dueDate).toBe('2027-01-06')
  })

  it('does not recreate a paid occurrence after reload', async () => {
    await obligations.create(rentDraft(), { ...meta(), id: 'rent' })
    const [sep] = await paymentsOf('rent')
    await scheduled.markPaid(sep!.id, payDraft(), [], { transactionId: 'tx-1', now: 'n', newId })
    await scheduled.generateMissing(TODAY, meta())
    const september = (await paymentsOf('rent')).filter((p) => p.dueDate === '2026-09-06')
    expect(september).toHaveLength(1)
    expect(september[0]?.status).toBe('paid')
    expect(await database.transactions.count()).toBe(1)
  })
})

describe('markPaid', () => {
  beforeEach(async () => {
    await obligations.create(rentDraft(), { ...meta(), id: 'rent' })
  })

  it('creates exactly one expense with the actual date and amount, links it, and marks the occurrence paid', async () => {
    const [sep] = await paymentsOf('rent')
    const result = await scheduled.markPaid(sep!.id, payDraft({ date: '2026-09-08', amountSatang: baht(7_932) }), [], { transactionId: 'tx-1', now: 'n', newId })

    expect(result.status).toBe('paid')
    expect(result.transaction).toMatchObject({ id: 'tx-1', type: 'expense', date: '2026-09-08', amountSatang: baht(7_932), categoryId: 'home', accountId: 'bank', description: 'ค่าเช่า', scheduledPaymentId: sep!.id })
    const stored = await scheduled.get(sep!.id)
    expect(stored).toMatchObject({ status: 'paid', transactionId: 'tx-1', paidDate: '2026-09-08', dueDate: '2026-09-06', expectedAmountSatang: baht(7_800) })
    // The rule keeps its configured amount for the next occurrences.
    expect((await obligations.get('rent'))?.expectedAmountSatang).toBe(baht(7_800))
    expect((await paymentsOf('rent'))[1]?.expectedAmountSatang).toBe(baht(7_800))

    const { balances, totals, transactions } = await snapshot()
    expect(transactions).toHaveLength(1)
    expect(balances.get('bank')).toBe(baht(50_000 - 7_932))
    expect(totals.expense).toBe(baht(7_932))
  })

  it('a repeated confirmation (same dialog) returns the existing result; another attempt is refused', async () => {
    const [sep] = await paymentsOf('rent')
    const pay = () => scheduled.markPaid(sep!.id, payDraft(), [], { transactionId: 'tx-1', now: 'n', newId })
    const results = await Promise.all([pay(), pay(), pay()])
    expect(results.map((r) => r.status).sort()).toEqual(['already_paid', 'already_paid', 'paid'])
    await expect(scheduled.markPaid(sep!.id, payDraft(), [], { transactionId: 'tx-2', now: 'n', newId })).rejects.toBeInstanceOf(PaymentAlreadySettledError)
    expect(await database.transactions.count()).toBe(1)
  })

  it('rolls everything back if any write fails', async () => {
    const [sep] = await paymentsOf('rent')
    vi.spyOn(database.attachmentBlobs, 'bulkAdd').mockRejectedValue(new Error('disk'))
    const error = await scheduled
      .markPaid(sep!.id, payDraft(), [{ blob: new Blob(['r']), fileName: 'r.jpg', mimeType: 'image/jpeg' }], { transactionId: 'tx-1', now: 'n', newId })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(StorageError)
    expect(await database.transactions.count()).toBe(0)
    expect(await database.attachments.count()).toBe(0)
    expect((await scheduled.get(sep!.id))?.status).toBe('pending')
  })

  it('rejects invalid payment details via the domain and changes nothing', async () => {
    const [sep] = await paymentsOf('rent')
    await expect(scheduled.markPaid(sep!.id, payDraft({ amountSatang: baht(0) }), [], { transactionId: 'tx-1', now: 'n', newId })).rejects.toMatchObject({ issues: ['amount_must_be_positive'] })
    expect((await scheduled.get(sep!.id))?.status).toBe('pending')
  })

  it('attaches receipts to the actual transaction, not the rule', async () => {
    const [sep] = await paymentsOf('rent')
    await scheduled.markPaid(sep!.id, payDraft(), [{ blob: new Blob(['receipt']), fileName: 'receipt.jpg', mimeType: 'image/jpeg' }], { transactionId: 'tx-1', now: 'n', newId })
    const [attachment] = await database.attachments.toArray()
    expect(attachment).toMatchObject({ transactionId: 'tx-1', fileName: 'receipt.jpg' })
  })

  it('deleting the transaction makes the occurrence unpaid again (no duplicate on regeneration)', async () => {
    const [sep] = await paymentsOf('rent')
    await scheduled.markPaid(sep!.id, payDraft(), [], { transactionId: 'tx-1', now: 'n', newId })
    await createTransactionsRepository(database).delete('tx-1', { now: 'n' })
    expect(await scheduled.get(sep!.id)).toMatchObject({ status: 'pending' })
    await scheduled.generateMissing(TODAY, meta())
    expect((await paymentsOf('rent')).filter((p) => p.dueDate === '2026-09-06')).toHaveLength(1)
  })
})

describe('skip', () => {
  it('marks skipped without a transaction; the rule continues; can be undone', async () => {
    await obligations.create(rentDraft(), { ...meta(), id: 'rent' })
    const [, oct] = await paymentsOf('rent')
    await scheduled.markSkipped(oct!.id, { now: 'n' })
    expect((await paymentsOf('rent')).map((p) => p.status)).toEqual(['pending', 'skipped', 'pending', 'pending'])
    expect(await database.transactions.count()).toBe(0)
    await expect(scheduled.markPaid(oct!.id, payDraft(), [], { transactionId: 't', now: 'n', newId })).rejects.toMatchObject({ status: 'skipped' })
    await scheduled.markUnskipped(oct!.id, { now: 'n' })
    expect((await scheduled.get(oct!.id))?.status).toBe('pending')
  })
})

describe('editing a rule', () => {
  beforeEach(async () => {
    await obligations.create(rentDraft(), { ...meta('2026-08-10'), id: 'rent' })
    const payments = await paymentsOf('rent') // Aug 6 … Nov 6
    await scheduled.markPaid(payments[0]!.id, payDraft({ date: '2026-08-07', description: 'ค่าเช่า ส.ค.' }), [], { transactionId: 'tx-aug', now: 'n', newId })
    await scheduled.markSkipped(payments[1]!.id, { now: 'n' }) // Sep 6 skipped
    await scheduled.generateMissing(TODAY, meta()) // brings in Dec 6
  })

  it('a new amount applies to future unpaid occurrences only; history and paid transactions untouched', async () => {
    const txBefore = await database.transactions.get('tx-aug')
    await obligations.update('rent', rentDraft({ amountSatang: baht(9_000) }), meta())
    expect((await paymentsOf('rent')).map((p) => [p.dueDate, p.status, p.expectedAmountSatang])).toEqual([
      ['2026-08-06', 'paid', baht(7_800)],
      ['2026-09-06', 'skipped', baht(7_800)],
      ['2026-10-06', 'pending', baht(9_000)],
      ['2026-11-06', 'pending', baht(9_000)],
      ['2026-12-06', 'pending', baht(9_000)],
    ])
    expect(await database.transactions.get('tx-aug')).toEqual(txBefore)
  })

  it('a new due day regenerates future unpaid dates without duplicates', async () => {
    await obligations.update('rent', rentDraft({ recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-01-01', dayOfMonth: 15 } }), meta())
    await obligations.update('rent', rentDraft({ recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-01-01', dayOfMonth: 15 } }), meta())
    const payments = await paymentsOf('rent')
    expect(payments.map((p) => [p.dueDate, p.status])).toEqual([
      ['2026-08-06', 'paid'],
      ['2026-09-06', 'skipped'],
      ['2026-10-15', 'pending'],
      ['2026-11-15', 'pending'],
      ['2026-12-15', 'pending'],
    ])
    expect(await database.transactions.count()).toBe(1)
  })
})

describe('pause / resume / delete', () => {
  beforeEach(async () => {
    await obligations.create(rentDraft(), { ...meta('2026-08-10'), id: 'rent' }) // Aug 6 … Nov 6
    const payments = await paymentsOf('rent')
    await scheduled.markPaid(payments[0]!.id, payDraft({ date: '2026-08-07' }), [], { transactionId: 'tx-aug', now: 'n', newId })
    // Sep 6 is left unpaid (overdue by today).
  })

  it('pause keeps history and overdue items, removes future unpaid ones, and stops generation', async () => {
    await obligations.pause('rent', meta())
    expect((await paymentsOf('rent')).map((p) => [p.dueDate, p.status])).toEqual([
      ['2026-08-06', 'paid'],
      ['2026-09-06', 'pending'],
    ])
    expect(await scheduled.generateMissing('2026-12-01', meta('2026-12-01'))).toBe(0)
  })

  it('resume generates from the resume date on, without back-filling or duplicating', async () => {
    await obligations.pause('rent', meta())
    await obligations.resume('rent', meta('2026-11-20'))
    await obligations.resume('rent', meta('2026-11-20'))
    expect((await paymentsOf('rent')).map((p) => [p.dueDate, p.status])).toEqual([
      ['2026-08-06', 'paid'],
      ['2026-09-06', 'pending'],
      ['2026-12-06', 'pending'],
      ['2027-01-06', 'pending'],
      ['2027-02-06', 'pending'],
    ])
  })

  it('delete keeps the paid history, its transaction and attachments; removes unpaid occurrences', async () => {
    await database.attachments.add({ id: 'a', transactionId: 'tx-aug', fileName: 'r.jpg', mimeType: 'image/jpeg', sizeBytes: 1, createdAt: 'n' })
    const result = await obligations.archive('rent', meta())
    expect(result.removedUnpaid).toBe(3)
    expect((await paymentsOf('rent')).map((p) => [p.dueDate, p.status])).toEqual([['2026-08-06', 'paid']])
    expect(await database.transactions.get('tx-aug')).toBeDefined()
    expect(await database.attachments.get('a')).toBeDefined()
    expect((await obligations.get('rent'))?.archivedAt).toBeDefined()
    expect(await scheduled.generateMissing(TODAY, meta())).toBe(0)
  })
})

describe('debt-linked obligation (credit-card bill)', () => {
  beforeEach(async () => {
    await database.debts.add(makeDebt({ id: 'cc', name: 'บัตรเครดิต KBank', kind: 'credit_card', linkedAccountId: 'card' }))
    await database.transactions.add(makeTx({ id: 'buy', type: 'expense', amountSatang: baht(5_000), accountId: 'card', categoryId: 'food', date: '2026-09-02' }))
  })

  it('paying creates a debt payment to the card, never another expense', async () => {
    await obligations.create(rentDraft({ name: 'บัตรเครดิต KBank', debtId: 'cc', categoryId: undefined, amountSatang: baht(5_000), recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-01-01', dayOfMonth: 20 } }), { ...meta(), id: 'ccbill' })
    const [sep] = await paymentsOf('ccbill')
    const { transaction } = await scheduled.markPaid(sep!.id, payDraft({ categoryId: 'food', amountSatang: baht(5_000) }), [], { transactionId: 'pay', now: 'n', newId })
    expect(transaction).toMatchObject({ type: 'debt_payment', debtId: 'cc', toAccountId: 'card' })
    expect(transaction).not.toHaveProperty('categoryId')

    const { totals, balances, debts } = await snapshot()
    expect(totals.expense).toBe(baht(5_000)) // the purchase only
    expect(totals.expenseCount).toBe(1)
    expect(totals.debtPayment).toBe(baht(5_000))
    expect(balances.get('card')).toBe(0)
    expect(debts.items.find((i) => i.debt.id === 'cc')?.outstanding).toBe(0)
  })
})

describe('monthly plan: transfers, one-off items, amounts of single months', () => {
  beforeEach(async () => {
    await database.accounts.add(makeAccount({ id: 'savings', name: 'ออม', kind: 'investment' }))
  })

  it('a planned transfer is paid as a transfer to its account — never an expense', async () => {
    await obligations.create(
      rentDraft({ name: 'DCA', amountSatang: baht(700), categoryId: undefined, kind: 'transfer', toAccountId: 'savings', recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-10-01', dayOfMonth: 1 } }),
      { ...meta(), id: 'dca' },
    )
    const [first] = await paymentsOf('dca')
    expect(first).toMatchObject({ dueDate: '2026-10-01', expectedAmountSatang: baht(700) })
    const result = await scheduled.markPaid(first!.id, payDraft({ type: 'transfer', amountSatang: baht(700), categoryId: undefined }), [], { transactionId: 'tx-dca', now: meta().now, newId })
    expect(result.transaction).toMatchObject({ type: 'transfer', accountId: 'bank', toAccountId: 'savings', amountSatang: baht(700), scheduledPaymentId: first!.id })
    expect(result.transaction.categoryId).toBeUndefined()
    expect((await snapshot()).totals.expense).toBe(0)
  })

  it('a transfer rule needs a different destination account', async () => {
    const transfer = (toAccountId?: string) => rentDraft({ categoryId: undefined, kind: 'transfer', toAccountId })
    await expect(obligations.create(transfer(), { ...meta(), id: 'x1' })).rejects.toMatchObject({ issues: ['to_account_required'] })
    await expect(obligations.create(transfer('bank'), { ...meta(), id: 'x2' })).rejects.toMatchObject({ issues: ['same_account'] })
    await expect(obligations.create(transfer('nope'), { ...meta(), id: 'x3' })).rejects.toBeInstanceOf(ObligationValidationError)
  })

  it('a one-off item creates exactly one occurrence', async () => {
    await obligations.create(rentDraft({ name: 'ประกันรถ', recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-11-15', dayOfMonth: 15, count: 1 } }), { ...meta(), id: 'once' })
    expect((await paymentsOf('once')).map((p) => p.dueDate)).toEqual(['2026-11-15'])
    await scheduled.generateMissing('2027-03-01', meta('2027-03-01'))
    expect((await paymentsOf('once')).map((p) => p.dueDate)).toEqual(['2026-11-15'])
  })

  it('plans one month: an unpaid occurrence takes the amount; a month not generated yet is created', async () => {
    await obligations.create(rentDraft(), { ...meta(), id: 'rent' })
    const october = (await paymentsOf('rent')).find((p) => p.dueDate === '2026-10-06')!
    await scheduled.setExpectedAmount({ sourceType: 'obligation', sourceId: 'rent', dueDate: '2026-10-06' }, baht(8_000), meta())
    expect(await database.scheduledPayments.get(october.id)).toMatchObject({ expectedAmountSatang: baht(8_000), status: 'pending' })

    const far = await scheduled.setExpectedAmount({ sourceType: 'obligation', sourceId: 'rent', dueDate: '2027-06-06' }, baht(8_200), meta())
    expect(far).toMatchObject({ dueDate: '2027-06-06', status: 'pending', expectedAmountSatang: baht(8_200) })
    // The app later generating that month keeps the planned amount.
    await scheduled.generateMissing('2027-04-01', meta('2027-04-01'))
    expect((await paymentsOf('rent')).filter((p) => p.dueDate === '2027-06-06').map((p) => p.expectedAmountSatang)).toEqual([baht(8_200)])
  })

  it('refuses a date that is not on the rule, a past month, a paid month and a bad amount', async () => {
    await obligations.create(rentDraft(), { ...meta(), id: 'rent' })
    const ref = (dueDate: string) => ({ sourceType: 'obligation' as const, sourceId: 'rent', dueDate })
    await expect(scheduled.setExpectedAmount(ref('2027-06-07'), baht(1), meta())).rejects.toMatchObject({ reason: 'not_planned' })
    await expect(scheduled.setExpectedAmount(ref('2026-08-06'), baht(1), meta())).rejects.toMatchObject({ reason: 'not_planned' })
    await expect(scheduled.setExpectedAmount(ref('2026-10-06'), 0 as never, meta())).rejects.toMatchObject({ reason: 'amount_invalid' })
    const september = (await paymentsOf('rent')).find((p) => p.dueDate === '2026-09-06')!
    await scheduled.markPaid(september.id, payDraft(), [], { transactionId: 'tx-sep', now: meta().now, newId })
    await expect(scheduled.setExpectedAmount(ref('2026-09-06'), baht(1), meta())).rejects.toBeInstanceOf(PaymentAlreadySettledError)
  })

  it('editing the rule keeps months planned by hand and months planned beyond the horizon', async () => {
    await obligations.create(rentDraft(), { ...meta(), id: 'rent' })
    await scheduled.setExpectedAmount({ sourceType: 'obligation', sourceId: 'rent', dueDate: '2026-11-06' }, baht(9_000), meta())
    await scheduled.setExpectedAmount({ sourceType: 'obligation', sourceId: 'rent', dueDate: '2027-05-06' }, baht(7_900), meta())
    await obligations.update('rent', rentDraft({ amountSatang: baht(8_100) }), meta())
    const amounts = Object.fromEntries((await paymentsOf('rent')).map((p) => [p.dueDate, p.expectedAmountSatang]))
    expect(amounts).toMatchObject({
      '2026-10-06': baht(8_100),
      '2026-11-06': baht(9_000),
      '2026-12-06': baht(8_100),
      '2027-05-06': baht(7_900),
    })
    // Moving the due day drops planned months that are no longer on the rule (the overdue September one is history and stays).
    await obligations.update('rent', rentDraft({ amountSatang: baht(8_100), recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-01-01', dayOfMonth: 10 } }), meta())
    expect((await paymentsOf('rent')).filter((p) => p.status === 'pending').map((p) => p.dueDate)).toEqual(['2026-09-06', '2026-10-10', '2026-11-10', '2026-12-10'])
  })
})
