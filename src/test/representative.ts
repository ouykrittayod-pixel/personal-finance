/**
 * Test-only: the hardening dataset, created through the real repositories
 * (same validation and multi-table writes as the app). Synthetic data only.
 *
 * September 2026:
 * - income ฿27,500 (salary)
 * - expenses: Food ฿2,500 (cash, with receipt), Shopping ฿3,550 (credit card), Rent ฿7,800 (recurring bill, paid)  = ฿13,850
 * - debt payments: mortgage ฿7,800 (principal ฿6,000 + interest ฿1,800), card payment ฿3,000                    = ฿10,800
 * - transfer KBank → Cash ฿5,000
 * - Internet ฿899 recurring bill, unpaid (due 2026-09-28)
 * - Food budget ฿6,000
 */
import type { FinanceDatabase } from '@/db/dexie'
import {
  createAccountsRepository,
  createBudgetsRepository,
  createDebtsRepository,
  createRecurringObligationsRepository,
  createScheduledPaymentsRepository,
  createTransactionsRepository,
} from '@/db/repositories'
import { baht, makeCategory } from './factories'

export const REP_TODAY = '2026-09-26'
export const REP_NOW = `${REP_TODAY}T03:00:00.000Z`
/** receipt.jpg: JPEG markers around every byte value. */
export const RECEIPT_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 256 }, (_, i) => i), 0xff, 0xd9])

export async function seedRepresentative(database: FinanceDatabase) {
  let counter = 0
  const newId = () => `rep-${++counter}`
  const meta = { now: REP_NOW, today: REP_TODAY, newId }
  const accounts = createAccountsRepository(database)
  const transactions = createTransactionsRepository(database)
  const debts = createDebtsRepository(database)
  const obligations = createRecurringObligationsRepository(database)
  const scheduled = createScheduledPaymentsRepository(database)
  const budgets = createBudgetsRepository(database)

  await accounts.create({ name: 'KBank', kind: 'bank', openingAmountSatang: baht(50_000), openingDate: '2026-08-01' }, { id: 'kbank', now: REP_NOW })
  await accounts.create({ name: 'Cash', kind: 'cash', openingAmountSatang: baht(5_000), openingDate: '2026-08-01' }, { id: 'cash', now: REP_NOW })
  await accounts.create({ name: 'Credit Card', kind: 'credit_card', openingAmountSatang: baht(0), openingDate: '2026-08-01' }, { id: 'card', now: REP_NOW })
  await database.categories.bulkAdd([
    makeCategory({ id: 'food', name: 'Food', sortOrder: 0 }),
    makeCategory({ id: 'transport', name: 'Transport', sortOrder: 1 }),
    makeCategory({ id: 'shopping', name: 'Shopping', sortOrder: 2 }),
    makeCategory({ id: 'rent', name: 'Rent', sortOrder: 3 }),
    makeCategory({ id: 'internet', name: 'Internet', sortOrder: 4 }),
    makeCategory({ id: 'salary', name: 'Salary', kind: 'income' }),
  ])
  await debts.create(
    { name: 'Mortgage', kind: 'mortgage', openingBalanceSatang: baht(1_200_000), openingDate: '2026-08-01', interestMethod: 'unknown' },
    { ...meta, id: 'home' },
  )
  await debts.create(
    { name: 'Credit Card', kind: 'credit_card', openingBalanceSatang: baht(0), openingDate: '2026-08-01', interestMethod: 'unknown', linkedAccountId: 'card' },
    { ...meta, id: 'cc' },
  )
  const monthly = (dayOfMonth: number) => ({ frequency: 'monthly' as const, interval: 1, startDate: '2026-09-01', dayOfMonth })
  await obligations.create(
    { name: 'Rent', amountSatang: baht(7_800), categoryId: 'rent', defaultAccountId: 'kbank', recurrence: monthly(6) },
    { ...meta, id: 'rent-rule' },
  )
  await obligations.create(
    { name: 'Internet', amountSatang: baht(899), categoryId: 'internet', defaultAccountId: 'kbank', recurrence: monthly(28) },
    { ...meta, id: 'net-rule' },
  )
  const rentSeptember = (await scheduled.listForSource('obligation', 'rent-rule')).find((p) => p.dueDate === '2026-09-06')!
  await scheduled.markPaid(rentSeptember.id, { type: 'expense', amountSatang: baht(7_800), accountId: 'kbank', categoryId: 'rent', date: '2026-09-06' }, [], {
    transactionId: 'rent-paid',
    now: REP_NOW,
    newId,
  })

  const tx = (id: string) => ({ id, now: REP_NOW, newId })
  await transactions.create({ type: 'income', amountSatang: baht(27_500), accountId: 'kbank', categoryId: 'salary', date: '2026-09-25' }, [], tx('wage'))
  await transactions.create(
    { type: 'expense', amountSatang: baht(2_500), accountId: 'cash', categoryId: 'food', date: '2026-09-03', description: 'ข้าวกลางวัน' },
    [{ blob: new Blob([RECEIPT_BYTES], { type: 'image/jpeg' }), fileName: 'receipt.jpg', mimeType: 'image/jpeg', width: 640, height: 480 }],
    tx('food'),
  )
  await transactions.create({ type: 'expense', amountSatang: baht(3_550), accountId: 'card', categoryId: 'shopping', date: '2026-09-07' }, [], tx('shop'))
  await transactions.create({ type: 'transfer', amountSatang: baht(5_000), accountId: 'kbank', toAccountId: 'cash', date: '2026-09-05' }, [], tx('move'))
  await transactions.create(
    {
      type: 'debt_payment',
      debtId: 'home',
      amountSatang: baht(7_800),
      allocation: 'split',
      principalSatang: baht(6_000),
      interestSatang: baht(1_800),
      feeSatang: baht(0),
      accountId: 'kbank',
      date: '2026-09-25',
    },
    [],
    tx('loan'),
  )
  await transactions.create({ type: 'debt_payment', debtId: 'cc', amountSatang: baht(3_000), accountId: 'kbank', date: '2026-09-20' }, [], tx('cardpay'))
  await budgets.create({ month: '2026-09', categoryId: 'food', limitSatang: baht(6_000) }, { id: 'b-food', now: REP_NOW })
  return { newId }
}
