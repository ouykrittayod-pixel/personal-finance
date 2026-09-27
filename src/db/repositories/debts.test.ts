import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DebtDraft } from '@/domain/debts'
import type { ScheduledPayment } from '@/domain/entities'
import { accountBalances, debtSummary, monthTotals } from '@/domain/reporting'
import type { TransactionDraft } from '@/domain/transactions'
import { baht, makeAccount, makeCategory, makeDebt, makeTx } from '@/test/factories'
import { FinanceDatabase } from '../dexie'
import { StorageError } from '../errors'
import { createDebtsRepository, DebtValidationError } from './debts'
import { createRecurringObligationsRepository, ObligationValidationError } from './recurring-obligations'
import { createScheduledPaymentsRepository, PaymentAlreadySettledError } from './scheduled-payments'
import { createTransactionsRepository, ExpenseValidationError } from './transactions'

const TODAY = '2026-09-25'
let database: FinanceDatabase
let debts: ReturnType<typeof createDebtsRepository>
let scheduled: ReturnType<typeof createScheduledPaymentsRepository>
let transactions: ReturnType<typeof createTransactionsRepository>
let counter = 0
const newId = () => `id-${++counter}`
const meta = (today = TODAY) => ({ now: `${today}T03:00:00.000Z`, today, newId })

const mortgage = (overrides: Partial<DebtDraft> = {}): DebtDraft => ({
  name: 'สินเชื่อบ้าน',
  kind: 'mortgage',
  lender: 'ธนาคารออมสิน',
  principalSatang: baht(3_000_000),
  openingBalanceSatang: baht(1_000_000),
  openingDate: '2026-09-01',
  interestMethod: 'reducing_balance',
  annualInterestRateBps: 550,
  installmentSatang: baht(18_000),
  dueDay: 5,
  scheduleEnabled: true,
  ...overrides,
})

const loanPay = (overrides: Partial<TransactionDraft> = {}): TransactionDraft => ({
  type: 'debt_payment',
  debtId: 'home',
  amountSatang: baht(18_000),
  allocation: 'split',
  principalSatang: baht(13_500),
  interestSatang: baht(4_400),
  feeSatang: baht(100),
  accountId: 'bank',
  date: TODAY,
  ...overrides,
})

const byDue = (payments: ScheduledPayment[]) => [...payments].sort((a, b) => a.dueDate.localeCompare(b.dueDate))
const occurrences = async (id: string) => byDue(await scheduled.listForSource('debt', id))
const snapshot = async () => {
  const [accounts, txs, all] = await Promise.all([database.accounts.toArray(), database.transactions.toArray(), database.debts.toArray()])
  return { balances: accountBalances(accounts, txs), totals: monthTotals(txs, '2026-09'), debts: debtSummary(all, txs, accounts), txs }
}
const outstanding = async (id: string) => (await snapshot()).debts.items.find((i) => i.debt.id === id)?.outstanding

beforeEach(async () => {
  database = new FinanceDatabase(`debts-${crypto.randomUUID()}`)
  debts = createDebtsRepository(database)
  scheduled = createScheduledPaymentsRepository(database)
  transactions = createTransactionsRepository(database)
  await database.accounts.bulkAdd([
    makeAccount({ id: 'bank', name: 'KBank', kind: 'bank', openingBalanceSatang: baht(100_000) }),
    makeAccount({ id: 'card', name: 'บัตร KTC', kind: 'credit_card' }),
  ])
  await database.categories.add(makeCategory({ id: 'food', name: 'อาหาร' }))
})

afterEach(async () => {
  vi.restoreAllMocks()
  await database.delete()
})

describe('loan creation and installments', () => {
  it('stores the loan at its effective date and creates installments this month → horizon — no transactions', async () => {
    const debt = await debts.create(mortgage(), { ...meta(), id: 'home' })
    expect(debt).toMatchObject({ id: 'home', openingBalanceSatang: baht(1_000_000), openingDate: '2026-09-01', principalSatang: baht(3_000_000), scheduleFrom: '2026-09-01' })
    expect((await occurrences('home')).map((p) => [p.dueDate, p.status, p.expectedAmountSatang])).toEqual([
      ['2026-09-05', 'pending', baht(18_000)],
      ['2026-10-05', 'pending', baht(18_000)],
      ['2026-11-05', 'pending', baht(18_000)],
      ['2026-12-05', 'pending', baht(18_000)],
    ])
    expect(await database.transactions.count()).toBe(0)
    expect(await outstanding('home')).toBe(baht(1_000_000))
  })

  it('is idempotent on its id (double-click creates one debt and one set of installments)', async () => {
    await Promise.all([debts.create(mortgage(), { ...meta(), id: 'home' }), debts.create(mortgage(), { ...meta(), id: 'home' })])
    expect(await database.debts.count()).toBe(1)
    expect(await occurrences('home')).toHaveLength(4)
  })

  it('generateMissing extends debt installments and is idempotent', async () => {
    await debts.create(mortgage(), { ...meta(), id: 'home' })
    expect(await scheduled.generateMissing(TODAY, meta())).toBe(0)
    expect(await scheduled.generateMissing('2026-10-25', meta('2026-10-25'))).toBe(1)
    expect(await scheduled.generateMissing('2026-10-25', meta('2026-10-25'))).toBe(0)
    expect((await occurrences('home')).at(-1)?.dueDate).toBe('2027-01-05')
  })

  it('rejects invalid drafts with nothing written', async () => {
    await expect(debts.create(mortgage({ dueDay: undefined }), { ...meta(), id: 'home' })).rejects.toMatchObject({ issues: ['schedule_incomplete'] })
    expect(await database.debts.count()).toBe(0)
    expect(await database.scheduledPayments.count()).toBe(0)
  })
})

describe('one schedule owner per debt', () => {
  it('a recurring obligation cannot pay a debt that has its own installments, and vice versa', async () => {
    const obligations = createRecurringObligationsRepository(database)
    await debts.create(mortgage(), { ...meta(), id: 'home' })
    const draft = { name: 'ผ่อนบ้าน', amountSatang: baht(18_000), debtId: 'home', defaultAccountId: 'bank', recurrence: { frequency: 'monthly' as const, interval: 1, startDate: '2026-09-01', dayOfMonth: 5 } }
    await expect(obligations.create(draft, { ...meta(), id: 'o1' })).rejects.toBeInstanceOf(ObligationValidationError)

    await debts.create(mortgage({ scheduleEnabled: false }), { ...meta(), id: 'car' })
    await obligations.create({ ...draft, debtId: 'car' }, { ...meta(), id: 'o2' })
    const edit = debts.update('car', mortgage({ scheduleEnabled: true }), meta())
    await expect(edit).rejects.toMatchObject({ issues: ['schedule_owned_by_obligation'] })
    // Only the obligation's occurrences exist for "car" — never a second set.
    expect(await occurrences('car')).toHaveLength(0)
  })
})

describe('paying installments and extra repayments', () => {
  beforeEach(async () => {
    await debts.create(mortgage(), { ...meta(), id: 'home' })
  })

  it('mark paid: one debt_payment with its split, occurrence linked, bank down by the total, no expense', async () => {
    const [first] = await occurrences('home')
    const result = await scheduled.markPaid(first!.id, loanPay(), [], { transactionId: 't1', now: meta().now, newId })
    expect(result.transaction).toMatchObject({ id: 't1', type: 'debt_payment', debtId: 'home', principalSatang: baht(13_500), interestSatang: baht(4_400), feeSatang: baht(100), scheduledPaymentId: first!.id })
    expect(await scheduled.get(first!.id)).toMatchObject({ status: 'paid', transactionId: 't1' })
    const { balances, totals } = await snapshot()
    expect(balances.get('bank')).toBe(baht(100_000 - 18_000))
    expect(totals.expense).toBe(0)
    expect(totals.debtPayment).toBe(baht(18_000))
    expect(await outstanding('home')).toBe(baht(1_000_000 - 13_500))
  })

  it('duplicate protection: repeating the same confirmation returns the same transaction; another payment is refused', async () => {
    const [first] = await occurrences('home')
    const pay = () => scheduled.markPaid(first!.id, loanPay(), [], { transactionId: 't1', now: meta().now, newId })
    const [a, b] = await Promise.all([pay(), pay()])
    expect([a.status, b.status].sort()).toEqual(['already_paid', 'paid'])
    expect(await database.transactions.count()).toBe(1)
    await expect(scheduled.markPaid(first!.id, loanPay(), [], { transactionId: 't2', now: meta().now, newId })).rejects.toBeInstanceOf(PaymentAlreadySettledError)
  })

  it('the split must add up; nothing is written otherwise', async () => {
    const [first] = await occurrences('home')
    await expect(scheduled.markPaid(first!.id, loanPay({ feeSatang: baht(0) }), [], { transactionId: 't1', now: meta().now, newId })).rejects.toMatchObject({
      issues: ['allocation_mismatch'],
    })
    expect(await database.transactions.count()).toBe(0)
    expect((await scheduled.get(first!.id))?.status).toBe('pending')
  })

  it('an unscheduled extra repayment reduces principal without touching installments', async () => {
    await transactions.create(loanPay({ amountSatang: baht(50_000), principalSatang: baht(50_000), interestSatang: baht(0), feeSatang: baht(0) }), [], { id: 'x1', ...meta() })
    expect(await outstanding('home')).toBe(baht(950_000))
    expect((await occurrences('home')).every((p) => p.status === 'pending')).toBe(true)
  })

  it('rejects principal beyond the outstanding balance (no overpayment)', async () => {
    await expect(
      transactions.create(loanPay({ amountSatang: baht(1_000_001), principalSatang: baht(1_000_001), interestSatang: baht(0), feeSatang: baht(0) }), [], { id: 'x1', ...meta() }),
    ).rejects.toMatchObject({ issues: ['principal_exceeds_outstanding'] })
    expect(await database.transactions.count()).toBe(0)
  })

  it('rejects a payment dated before the opening balance’s effective date', async () => {
    await expect(transactions.create(loanPay({ date: '2026-08-31' }), [], { id: 'x1', ...meta() })).rejects.toMatchObject({ issues: ['payment_before_opening'] })
  })

  it('an unknown split can be recorded explicitly and never reduces principal', async () => {
    await transactions.create(loanPay({ allocation: 'unallocated', principalSatang: undefined, interestSatang: undefined, feeSatang: undefined }), [], { id: 'x1', ...meta() })
    const { debts: summary } = await snapshot()
    expect(summary.totalOutstanding).toBe(baht(1_000_000))
    expect(summary.unallocated).toBe(baht(18_000))
  })

  it('editing a payment recalculates; an edit that would overpay is rejected and the old version stays', async () => {
    const [first] = await occurrences('home')
    await scheduled.markPaid(first!.id, loanPay(), [], { transactionId: 't1', now: meta().now, newId })
    await transactions.update('t1', loanPay({ amountSatang: baht(20_000), principalSatang: baht(15_500) }), { add: [], remove: [] }, meta())
    expect(await outstanding('home')).toBe(baht(984_500))
    const stored = await database.transactions.get('t1')
    expect(stored).toMatchObject({ id: 't1', scheduledPaymentId: first!.id, createdAt: meta().now })

    await expect(
      transactions.update('t1', loanPay({ amountSatang: baht(2_000_000), principalSatang: baht(1_995_500) }), { add: [], remove: [] }, meta()),
    ).rejects.toBeInstanceOf(ExpenseValidationError)
    expect(await database.transactions.get('t1')).toEqual(stored)
  })

  it('deleting a linked payment makes the installment unpaid again and restores principal and bank balance', async () => {
    const [first] = await occurrences('home')
    await scheduled.markPaid(first!.id, loanPay(), [], { transactionId: 't1', now: meta().now, newId })
    await transactions.delete('t1', meta())
    expect(await scheduled.get(first!.id)).toMatchObject({ status: 'pending' })
    expect(await scheduled.get(first!.id)).not.toHaveProperty('transactionId')
    expect(await outstanding('home')).toBe(baht(1_000_000))
    expect((await snapshot()).balances.get('bank')).toBe(baht(100_000))
  })

  it('a failed write rolls back the whole payment (atomic)', async () => {
    const [first] = await occurrences('home')
    vi.spyOn(database.scheduledPayments, 'put').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'))
    await expect(scheduled.markPaid(first!.id, loanPay(), [], { transactionId: 't1', now: meta().now, newId })).rejects.toBeInstanceOf(StorageError)
    expect(await database.transactions.count()).toBe(0)
    expect((await scheduled.get(first!.id))?.status).toBe('pending')
  })

  it('keeps receipts when paying and when the payment is edited', async () => {
    const [first] = await occurrences('home')
    const file = { blob: new Blob(['r']), fileName: 'receipt.jpg', mimeType: 'image/jpeg' }
    await scheduled.markPaid(first!.id, loanPay(), [file], { transactionId: 't1', now: meta().now, newId })
    await transactions.update('t1', loanPay({ note: 'งวดแรก' }), { add: [], remove: [] }, meta())
    expect(await database.attachments.where('transactionId').equals('t1').count()).toBe(1)
  })
})

describe('schedule changes, pause and archive', () => {
  beforeEach(async () => {
    await debts.create(mortgage(), { ...meta(), id: 'home' })
  })

  it('editing the installment updates future unpaid occurrences only', async () => {
    const [first] = await occurrences('home')
    await scheduled.markPaid(first!.id, loanPay(), [], { transactionId: 't1', now: meta().now, newId })
    await debts.update('home', mortgage({ installmentSatang: baht(20_000) }), meta())
    expect((await occurrences('home')).map((p) => [p.status, p.expectedAmountSatang])).toEqual([
      ['paid', baht(18_000)],
      ['pending', baht(20_000)],
      ['pending', baht(20_000)],
      ['pending', baht(20_000)],
    ])
  })

  it('an edit may not make recorded repayments exceed the opening balance', async () => {
    await transactions.create(loanPay(), [], { id: 'x1', ...meta() })
    await expect(debts.update('home', mortgage({ openingBalanceSatang: baht(10_000) }), meta())).rejects.toMatchObject({ issues: ['opening_below_repaid'] })
  })

  it('pause removes future unpaid installments; resume generates from today on', async () => {
    await debts.pauseSchedule('home', meta())
    expect((await occurrences('home')).map((p) => p.dueDate)).toEqual(['2026-09-05']) // overdue stays
    expect(await scheduled.generateMissing(TODAY, meta())).toBe(0)
    await debts.resumeSchedule('home', meta())
    expect((await occurrences('home')).map((p) => p.dueDate)).toEqual(['2026-09-05', '2026-10-05', '2026-11-05', '2026-12-05'])
  })

  it('archive hides the debt, removes unpaid installments and keeps payment history', async () => {
    const [first] = await occurrences('home')
    await scheduled.markPaid(first!.id, loanPay(), [], { transactionId: 't1', now: meta().now, newId })
    expect(await debts.archive('home', meta())).toEqual({ removedUnpaid: 3 })
    expect((await occurrences('home')).map((p) => p.status)).toEqual(['paid'])
    expect(await database.transactions.get('t1')).toBeDefined()
    const { debts: summary } = await snapshot()
    expect(summary.activeCount).toBe(0)
    expect(await scheduled.generateMissing('2026-12-25', meta('2026-12-25'))).toBe(0)
  })

  it('principal adjustments raise the outstanding amount from their date', async () => {
    await debts.addAdjustment('home', { date: '2026-09-20', amountSatang: baht(200_000), note: 'กู้เพิ่ม' }, { id: 'adj1', now: meta().now })
    await debts.addAdjustment('home', { date: '2026-09-20', amountSatang: baht(200_000) }, { id: 'adj1', now: meta().now })
    expect(await outstanding('home')).toBe(baht(1_200_000))
  })
})

describe('credit cards', () => {
  it('uses the card account balance; payments move money from the bank to the card and are not expenses', async () => {
    await debts.create({ name: 'KTC', kind: 'credit_card', openingBalanceSatang: null, openingDate: TODAY, interestMethod: 'unknown', linkedAccountId: 'card' }, { ...meta(), id: 'cc' })
    await transactions.createExpense({ amountSatang: baht(3_000), accountId: 'card', categoryId: 'food', date: TODAY }, [], { id: 'e1', ...meta() })
    expect(await outstanding('cc')).toBe(baht(3_000))

    await transactions.create({ type: 'debt_payment', debtId: 'cc', amountSatang: baht(1_000), accountId: 'bank', date: TODAY }, [], { id: 'p1', ...meta() })
    const { balances, totals } = await snapshot()
    expect(await outstanding('cc')).toBe(baht(2_000))
    expect(balances.get('bank')).toBe(baht(99_000))
    expect(totals.expense).toBe(baht(3_000)) // the purchase — not the payment
    await expect(
      transactions.create({ type: 'debt_payment', debtId: 'cc', amountSatang: baht(1_000), accountId: 'bank', date: TODAY, interestSatang: baht(100) }, [], { id: 'p2', ...meta() }),
    ).rejects.toMatchObject({ issues: ['breakdown_not_allowed'] })
  })

  it('creates the card account together with the debt (owing today → negative opening balance)', async () => {
    const debt = await debts.create(
      { name: 'SCB', kind: 'credit_card', openingBalanceSatang: null, openingDate: TODAY, interestMethod: 'unknown' },
      { ...meta(), id: 'cc2', newCard: { id: 'card2', name: 'บัตร SCB', owedSatang: baht(4_500) } },
    )
    expect(debt.linkedAccountId).toBe('card2')
    expect(await database.accounts.get('card2')).toMatchObject({ kind: 'credit_card', openingBalanceSatang: baht(-4_500) })
    expect(await outstanding('cc2')).toBe(baht(4_500))
  })

  it('a statement creates one dated occurrence (minimum due) and never changes the live balance', async () => {
    await debts.create({ name: 'KTC', kind: 'credit_card', openingBalanceSatang: null, openingDate: TODAY, interestMethod: 'unknown', linkedAccountId: 'card' }, { ...meta(), id: 'cc' })
    const statement = { statementDate: '2026-09-15', balanceSatang: baht(12_000), minimumDueSatang: baht(1_200), dueDate: '2026-10-05' }
    await debts.addStatement('cc', statement, { ...meta(), id: 's1' })
    await debts.addStatement('cc', statement, { ...meta(), id: 's1' })
    expect((await occurrences('cc')).map((p) => [p.dueDate, p.expectedAmountSatang])).toEqual([['2026-10-05', baht(1_200)]])
    expect(await outstanding('cc')).toBe(0)
    await expect(debts.addStatement('cc', statement, { ...meta(), id: 's2' })).rejects.toMatchObject({ issues: ['statement_exists'] })

    // Paying it creates a card payment (no split); a paid statement cannot be removed.
    const [occurrence] = await occurrences('cc')
    await scheduled.markPaid(occurrence!.id, { type: 'debt_payment', debtId: 'cc', amountSatang: baht(12_000), accountId: 'bank', date: TODAY }, [], { transactionId: 't1', now: meta().now, newId })
    expect(await database.transactions.get('t1')).toMatchObject({ toAccountId: 'card', amountSatang: baht(12_000) })
    await expect(debts.removeStatement('cc', 's1', meta())).rejects.toBeInstanceOf(DebtValidationError)
  })
})

describe('stored records from before this phase', () => {
  it('a v1-shaped debt (no new optional fields) still loads and computes', async () => {
    await database.debts.add(makeDebt({ id: 'old', kind: 'car_loan', openingBalanceSatang: baht(50_000) }))
    await database.transactions.add(makeTx({ type: 'debt_payment', debtId: 'old', amountSatang: baht(5_000), accountId: 'bank', interestSatang: baht(500) }))
    const { debts: summary } = await snapshot()
    // The old payment had no principal field: it is shown as unallocated, not guessed.
    expect(summary.items.find((i) => i.debt.id === 'old')?.outstanding).toBe(baht(50_000))
    expect(summary.unallocated).toBe(baht(5_000))
    expect(await scheduled.generateMissing(TODAY, meta())).toBe(0)
  })
})
