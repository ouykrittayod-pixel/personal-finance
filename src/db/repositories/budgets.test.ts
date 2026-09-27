import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getBudgetSpent, getMonthlyBudgetSummary, OVERALL_BUDGET, type BudgetDraft } from '@/domain/budget'
import { accountBalances, monthTotals } from '@/domain/reporting'
import { baht, makeAccount, makeCategory } from '@/test/factories'
import { FinanceDatabase } from '../dexie'
import { StorageError } from '../errors'
import { BudgetNotFoundError, BudgetValidationError, createBudgetsRepository } from './budgets'
import { createDebtsRepository } from './debts'
import { createRecurringObligationsRepository } from './recurring-obligations'
import { createScheduledPaymentsRepository } from './scheduled-payments'
import { createTransactionsRepository } from './transactions'

const TODAY = '2026-09-25'
const now = `${TODAY}T03:00:00.000Z`
let database: FinanceDatabase
let budgets: ReturnType<typeof createBudgetsRepository>
let transactions: ReturnType<typeof createTransactionsRepository>
let counter = 0
const newId = () => `id-${++counter}`
const meta = { now, newId }

const draft = (overrides: Partial<BudgetDraft> = {}): BudgetDraft => ({ month: '2026-09', categoryId: 'food', limitSatang: baht(6_000), ...overrides })
const spend = (id: string, amount: number, categoryId = 'food', accountId = 'cash', date = TODAY) =>
  transactions.createExpense({ amountSatang: baht(amount), accountId, categoryId, date }, [], { id, ...meta })
const spentFor = async (categoryId: string, month = '2026-09') => getBudgetSpent({ month, categoryId }, await database.transactions.toArray())

beforeEach(async () => {
  database = new FinanceDatabase(`budgets-${crypto.randomUUID()}`)
  budgets = createBudgetsRepository(database)
  transactions = createTransactionsRepository(database)
  await database.accounts.bulkAdd([
    makeAccount({ id: 'kbank', name: 'KBank', kind: 'bank', openingBalanceSatang: baht(50_000) }),
    makeAccount({ id: 'cash', name: 'เงินสด', kind: 'cash', openingBalanceSatang: baht(5_000) }),
    makeAccount({ id: 'card', name: 'บัตร', kind: 'credit_card' }),
  ])
  await database.categories.bulkAdd([
    makeCategory({ id: 'food', name: 'อาหาร' }),
    makeCategory({ id: 'shopping', name: 'ช้อปปิ้ง' }),
    makeCategory({ id: 'net', name: 'อินเทอร์เน็ต' }),
    makeCategory({ id: 'salary', name: 'เงินเดือน', kind: 'income' }),
  ])
})

afterEach(async () => {
  vi.restoreAllMocks()
  await database.delete()
})

describe('budgets repository', () => {
  it('create / get / list / listForMonth — historical months kept apart', async () => {
    const food = await budgets.create(draft(), { id: 'b1', now })
    await budgets.create(draft({ month: '2026-08', limitSatang: baht(5_000) }), { id: 'b0', now })
    expect(food).toEqual({ id: 'b1', month: '2026-09', categoryId: 'food', limitSatang: baht(6_000), createdAt: now, updatedAt: now })
    expect(await budgets.get('b1')).toEqual(food)
    expect((await budgets.listAll()).map((b) => b.id).sort()).toEqual(['b0', 'b1'])
    expect((await budgets.listForMonth('2026-08')).map((b) => b.limitSatang)).toEqual([baht(5_000)])
  })

  it('is idempotent on its id and never stores a duplicate month/category', async () => {
    await Promise.all([budgets.create(draft(), { id: 'b1', now }), budgets.create(draft(), { id: 'b1', now })])
    await expect(budgets.create(draft({ limitSatang: baht(1) }), { id: 'b2', now })).rejects.toMatchObject({ issues: ['duplicate'] })
    await budgets.create(draft({ categoryId: OVERALL_BUDGET, limitSatang: baht(25_000) }), { id: 'all', now })
    await expect(budgets.create(draft({ categoryId: OVERALL_BUDGET }), { id: 'all2', now })).rejects.toBeInstanceOf(BudgetValidationError)
    expect(await database.budgets.count()).toBe(2)
  })

  it('rejects income categories and non-positive amounts', async () => {
    await expect(budgets.create(draft({ categoryId: 'salary' }), { id: 'x', now })).rejects.toMatchObject({ issues: ['category_not_expense'] })
    await expect(budgets.create(draft({ limitSatang: baht(0) }), { id: 'x', now })).rejects.toMatchObject({ issues: ['amount_invalid'] })
    expect(await database.budgets.count()).toBe(0)
  })

  it('an edit changes the plan only: spent stays, remaining and percentage follow', async () => {
    await spend('e1', 4_250)
    await budgets.create(draft(), { id: 'b1', now })
    const txsBefore = await database.transactions.toArray()
    const edited = await budgets.update('b1', draft({ limitSatang: baht(7_000) }), { now: 'later' })
    expect(edited).toMatchObject({ id: 'b1', createdAt: now, updatedAt: 'later', limitSatang: baht(7_000) })
    const line = getMonthlyBudgetSummary(await budgets.listAll(), await database.transactions.toArray(), '2026-09').categories[0]!
    expect(line).toMatchObject({ spent: baht(4_250), remaining: baht(2_750), usageBps: 6_071 })
    expect(await database.transactions.toArray()).toEqual(txsBefore)
    await budgets.create(draft({ categoryId: 'shopping' }), { id: 'b2', now })
    await expect(budgets.update('b2', draft({ categoryId: 'food' }), { now })).rejects.toMatchObject({ issues: ['duplicate'] })
  })

  it('delete removes the plan only — transactions, balances and totals unchanged', async () => {
    await spend('e1', 1_000)
    await budgets.create(draft(), { id: 'b1', now })
    const [accounts, txs] = await Promise.all([database.accounts.toArray(), database.transactions.toArray()])
    const before = { balances: accountBalances(accounts, txs), totals: monthTotals(txs, '2026-09') }
    await budgets.delete('b1')
    const after = await database.transactions.toArray()
    expect(await database.budgets.count()).toBe(0)
    expect(after).toEqual(txs)
    expect(accountBalances(accounts, after)).toEqual(before.balances)
    expect(monthTotals(after, '2026-09')).toEqual(before.totals)
    await expect(budgets.delete('b1')).rejects.toBeInstanceOf(BudgetNotFoundError)
  })

  it('failed writes leave the previous state (atomic update and delete)', async () => {
    await budgets.create(draft(), { id: 'b1', now })
    vi.spyOn(database.budgets, 'put').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'))
    await expect(budgets.update('b1', draft({ limitSatang: baht(9) }), { now })).rejects.toBeInstanceOf(StorageError)
    expect((await budgets.get('b1'))?.limitSatang).toBe(baht(6_000))
    vi.spyOn(database.budgets, 'delete').mockRejectedValueOnce(new DOMException('boom', 'UnknownError'))
    await expect(budgets.delete('b1')).rejects.toBeInstanceOf(StorageError)
    expect(await budgets.get('b1')).toBeDefined()
  })
})

describe('spending from real flows', () => {
  it('multiple accounts in one category add up; income and transfers do not count', async () => {
    await spend('e1', 1_000, 'food', 'cash')
    await spend('e2', 1_500, 'food', 'kbank')
    await spend('e3', 500, 'food', 'card')
    await transactions.create({ type: 'income', amountSatang: baht(27_500), accountId: 'kbank', categoryId: 'salary', date: TODAY }, [], { id: 'i1', ...meta })
    await transactions.create({ type: 'transfer', amountSatang: baht(5_000), accountId: 'kbank', toAccountId: 'cash', date: TODAY }, [], { id: 't1', ...meta })
    expect(await spentFor('food')).toBe(baht(3_000))
    expect(getBudgetSpent({ month: '2026-09', categoryId: OVERALL_BUDGET }, await database.transactions.toArray())).toBe(baht(3_000))
  })

  it('a card purchase counts once; paying the card (debt payment) adds nothing', async () => {
    await createDebtsRepository(database).create({ name: 'KTC', kind: 'credit_card', openingBalanceSatang: null, openingDate: TODAY, interestMethod: 'unknown', linkedAccountId: 'card' }, { ...meta, today: TODAY, id: 'cc' })
    await spend('buy', 1_200, 'shopping', 'card')
    expect(await spentFor('shopping')).toBe(baht(1_200))
    await transactions.create({ type: 'debt_payment', amountSatang: baht(1_200), accountId: 'kbank', debtId: 'cc', date: TODAY }, [], { id: 'pay', ...meta })
    expect(await spentFor('shopping')).toBe(baht(1_200))
    expect(getBudgetSpent({ month: '2026-09', categoryId: OVERALL_BUDGET }, await database.transactions.toArray())).toBe(baht(1_200))
  })

  it('a recurring bill is not spending until it is actually paid', async () => {
    const obligations = createRecurringObligationsRepository(database)
    const scheduled = createScheduledPaymentsRepository(database)
    await obligations.create(
      { name: 'อินเทอร์เน็ต', amountSatang: baht(899), categoryId: 'net', defaultAccountId: 'kbank', recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-09-01', dayOfMonth: 15 } },
      { ...meta, today: TODAY, id: 'net-rule' },
    )
    expect(await spentFor('net')).toBe(0)
    const [occurrence] = await scheduled.listForSource('obligation', 'net-rule')
    await scheduled.markPaid(occurrence!.id, { type: 'expense', amountSatang: baht(899), accountId: 'kbank', categoryId: 'net', date: '2026-09-15' }, [], { transactionId: 'paid', now, newId })
    expect(await spentFor('net')).toBe(baht(899))
  })

  it('a paid debt installment (with interest inside it) is never budget spending', async () => {
    await createDebtsRepository(database).create(
      { name: 'บ้าน', kind: 'mortgage', openingBalanceSatang: baht(1_000_000), openingDate: '2026-09-01', interestMethod: 'unknown', installmentSatang: baht(7_800), dueDay: 5, scheduleEnabled: true },
      { ...meta, today: TODAY, id: 'home' },
    )
    const [installment] = await createScheduledPaymentsRepository(database).listForSource('debt', 'home')
    await createScheduledPaymentsRepository(database).markPaid(
      installment!.id,
      { type: 'debt_payment', amountSatang: baht(7_800), accountId: 'kbank', allocation: 'split', principalSatang: baht(5_000), interestSatang: baht(2_800), feeSatang: baht(0), date: TODAY },
      [],
      { transactionId: 'inst', now, newId },
    )
    const txs = await database.transactions.toArray()
    expect(getBudgetSpent({ month: '2026-09', categoryId: OVERALL_BUDGET }, txs)).toBe(0)
  })
})
