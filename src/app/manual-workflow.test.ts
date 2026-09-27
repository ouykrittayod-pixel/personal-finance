/**
 * Phase 15: a real user starting from an empty database and entering
 * everything by hand, through the same repositories the forms use, then
 * reading every page's own loader. Synthetic data only.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/dexie'
import { loadIntegritySnapshot } from '@/db/integrity-snapshot'
import {
  accountsRepository,
  budgetsRepository,
  categoriesRepository,
  CategoryValidationError,
  DebtValidationError,
  debtsRepository,
  recurringObligationsRepository,
  scheduledPaymentsRepository,
  transactionsRepository,
} from '@/db/repositories'
import { loadSetupCounts } from '@/db/setup-counts'
import { auditIntegrity } from '@/domain/integrity'
import { getSetupStatus } from '@/domain/setup'
import { buildAccountsModel, loadAccountsData } from '@/features/accounts/accounts-data'
import { buildAnalyticsModel, loadAnalyticsData } from '@/features/analytics/analytics-data'
import { buildBudgetModel, formatUsage, loadBudgetData } from '@/features/budget/budget-data'
import { buildCalendarModel, loadCalendarData } from '@/features/calendar/calendar-data'
import { buildDashboardModel, loadDashboardData } from '@/features/dashboard/dashboard-data'
import { buildLedger, defaultFilters, loadLedgerData } from '@/features/transactions/ledger-data'
import { baht } from '@/test/factories'

const TODAY = '2026-09-26'
const NOW = `${TODAY}T03:00:00.000Z`
let counter = 0
const newId = () => `m-${++counter}`
const meta = { now: NOW, today: TODAY, newId }
const setup = async () => getSetupStatus(await loadSetupCounts(db, '2026-09'))
const done = async () => Object.fromEntries((await setup()).items.map((i) => [i.key, i.done]))

async function views() {
  const period = { month: '2026-09', today: TODAY }
  return {
    dashboard: buildDashboardModel(await loadDashboardData(period), period),
    analytics: buildAnalyticsModel(await loadAnalyticsData('2026-09'), TODAY),
    calendar: buildCalendarModel(await loadCalendarData('2026-09'), 'all', TODAY),
    budget: buildBudgetModel(await loadBudgetData(), '2026-09'),
    ledger: buildLedger(
      await loadLedgerData(),
      { ...defaultFilters(TODAY), preset: 'custom', customStart: '2026-09-01', customEnd: '2026-09-30' },
      TODAY,
      1_000,
    ),
  }
}

/** Accounts with opening balances, categories, a card debt — the first setup steps. */
async function setUpAccounts() {
  await accountsRepository.create({ name: 'KBank', kind: 'bank', openingAmountSatang: baht(20_000), openingDate: '2026-09-01' }, { id: 'kbank', now: NOW })
  await accountsRepository.create({ name: 'เงินสด', kind: 'cash', openingAmountSatang: baht(500), openingDate: '2026-09-01' }, { id: 'cash', now: NOW })
  // Credit card: the owed amount before using the app (stored as the card's negative opening balance).
  await accountsRepository.create(
    { name: 'บัตร KBank', kind: 'credit_card', openingAmountSatang: baht(8_000), openingDate: '2026-09-01' },
    { id: 'card', now: NOW },
  )
  await categoriesRepository.create({ kind: 'expense', name: 'อาหาร', icon: '🍚' }, { id: 'food', now: NOW })
  await categoriesRepository.create({ kind: 'expense', name: 'เดินทาง' }, { id: 'transport', now: NOW })
  await categoriesRepository.create({ kind: 'expense', name: 'ช้อปปิ้ง' }, { id: 'shopping', now: NOW })
  await categoriesRepository.create({ kind: 'expense', name: 'บ้าน' }, { id: 'home-cat', now: NOW })
  await categoriesRepository.create({ kind: 'expense', name: 'ค่าน้ำค่าไฟ' }, { id: 'utilities', now: NOW })
  await categoriesRepository.create({ kind: 'income', name: 'เงินเดือน' }, { id: 'salary', now: NOW })
  await debtsRepository.create(
    { name: 'บัตร KBank', kind: 'credit_card', openingBalanceSatang: baht(0), openingDate: '2026-09-01', interestMethod: 'unknown', linkedAccountId: 'card' },
    { ...meta, id: 'cc' },
  )
}

/** Salary as recurring income (expected), received once (actual). */
async function salary() {
  await recurringObligationsRepository.create(
    {
      name: 'เงินเดือน',
      kind: 'income',
      amountSatang: baht(27_500),
      categoryId: 'salary',
      defaultAccountId: 'kbank',
      recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-09-01', dayOfMonth: 25 },
    },
    { ...meta, id: 'salary-rule' },
  )
  const occurrence = (await scheduledPaymentsRepository.listForSource('obligation', 'salary-rule')).find((p) => p.dueDate === '2026-09-25')!
  await scheduledPaymentsRepository.markPaid(
    occurrence.id,
    { type: 'income', amountSatang: baht(27_500), accountId: 'kbank', categoryId: 'salary', date: '2026-09-25' },
    [],
    {
      transactionId: 'wage',
      now: NOW,
      newId,
    },
  )
}

const tx = (id: string) => ({ id, now: NOW, newId })

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()))
})

describe('first run and setup status', () => {
  it('empty database: first run; setup status follows what the user adds', async () => {
    expect(await setup()).toMatchObject({ isFirstRun: true, doneCount: 0 })
    await setUpAccounts()
    expect(await done()).toMatchObject({ accounts: true, categories: true, income: false, debts: true, recurring: false, budget: false, firstEntry: false })
    expect((await setup()).isFirstRun).toBe(false)
    await salary()
    expect(await done()).toMatchObject({ income: true, firstEntry: true })
    const s = await setup()
    expect(s.items.find((i) => i.key === 'accounts')?.count).toBe(3)
  })

  it('opening balances are account settings — no transaction is created (asset and card)', async () => {
    await setUpAccounts()
    expect(await db.transactions.count()).toBe(0)
    expect(await db.accounts.get('kbank')).toMatchObject({ openingBalanceSatang: baht(20_000), openingDate: '2026-09-01' })
    expect(await db.accounts.get('card')).toMatchObject({ openingBalanceSatang: baht(-8_000) })
    const { dashboard, analytics } = await views()
    expect(dashboard.totals).toMatchObject({ income: 0, expense: 0, debtPayment: 0 })
    expect(dashboard.available.total).toBe(baht(20_500))
    expect(analytics.debts.lines.find((l) => l.debt.id === 'cc')?.outstanding).toBe(baht(8_000))
  })

  it('no duplicate setup records: repeating a setup step creates nothing new', async () => {
    await setUpAccounts()
    await expect(categoriesRepository.create({ kind: 'expense', name: 'อาหาร' }, { id: 'food-2', now: NOW })).rejects.toBeInstanceOf(CategoryValidationError)
    await expect(
      debtsRepository.create(
        { name: 'บัตรซ้ำ', kind: 'credit_card', openingBalanceSatang: baht(0), openingDate: '2026-09-01', interestMethod: 'unknown', linkedAccountId: 'card' },
        { ...meta, id: 'cc-2' },
      ),
    ).rejects.toBeInstanceOf(DebtValidationError)
    expect(await db.categories.count()).toBe(6)
    expect(await db.debts.count()).toBe(1)
  })
})

describe('daily workflow', () => {
  it('salary, lunch, groceries on the card, transfer, card payment — every page agrees', async () => {
    await setUpAccounts()
    await salary()
    await transactionsRepository.create(
      { type: 'expense', amountSatang: baht(60), accountId: 'cash', categoryId: 'food', date: TODAY, description: 'ข้าวกลางวัน' },
      [],
      tx('lunch'),
    )
    await transactionsRepository.create(
      { type: 'expense', amountSatang: baht(450), accountId: 'card', categoryId: 'food', date: TODAY, description: 'ของใช้ในบ้าน' },
      [],
      tx('groceries'),
    )
    await transactionsRepository.create({ type: 'transfer', amountSatang: baht(1_000), accountId: 'kbank', toAccountId: 'cash', date: TODAY }, [], tx('move'))
    await transactionsRepository.create({ type: 'debt_payment', debtId: 'cc', amountSatang: baht(3_000), accountId: 'kbank', date: TODAY }, [], tx('cardpay'))

    const { dashboard, analytics, calendar, ledger } = await views()
    const totals = { income: baht(27_500), expense: baht(510), debtPayment: baht(3_000) }
    expect(dashboard.totals).toMatchObject(totals)
    expect(analytics.totals).toMatchObject(totals)
    expect(ledger.summary).toMatchObject(totals)
    expect(calendar.totals).toMatchObject({ moneyIn: totals.income, expenses: totals.expense, debtPayments: totals.debtPayment, transfers: baht(1_000) })
    // KBank 20,000 + 27,500 − 1,000 − 3,000 = 43,500 ; Cash 500 − 60 + 1,000 = 1,440 (the transfer only moves money)
    const accounts = buildAccountsModel(await loadAccountsData(), { filter: 'all', search: '' })
    const balance = (id: string) => accounts.rows.find((r) => r.id === id)?.balance
    expect([balance('kbank'), balance('cash')]).toEqual([baht(43_500), baht(1_440)])
    expect(dashboard.available.total).toBe(baht(44_940))
    // Card: 8,000 owed + 450 purchase − 3,000 payment; the payment is not a second expense.
    expect(analytics.debts.lines.find((l) => l.debt.id === 'cc')?.outstanding).toBe(baht(5_450))
    expect(auditIntegrity(await loadIntegritySnapshot(db)).ok).toBe(true)
  })
})

describe('monthly workflow', () => {
  it('rent is expected until paid (then an expense, once); mortgage, card, budgets — all modules reconcile', async () => {
    await setUpAccounts()
    await salary()
    await debtsRepository.create(
      { name: 'สินเชื่อบ้าน', kind: 'mortgage', openingBalanceSatang: baht(1_200_000), openingDate: '2026-09-01', interestMethod: 'unknown' },
      { ...meta, id: 'home' },
    )
    const monthly = (day: number) => ({ frequency: 'monthly' as const, interval: 1, startDate: '2026-09-01', dayOfMonth: day })
    await recurringObligationsRepository.create(
      { name: 'ค่าเช่า', amountSatang: baht(7_800), categoryId: 'home-cat', defaultAccountId: 'kbank', recurrence: monthly(6) },
      { ...meta, id: 'rent' },
    )
    await recurringObligationsRepository.create(
      { name: 'อินเทอร์เน็ต', amountSatang: baht(899), categoryId: 'utilities', defaultAccountId: 'kbank', recurrence: monthly(15) },
      { ...meta, id: 'net' },
    )
    for (const [categoryId, limit] of [
      ['food', 6_000],
      ['transport', 3_000],
      ['shopping', 2_000],
    ] as const)
      await budgetsRepository.create({ month: '2026-09', categoryId, limitSatang: baht(limit) }, { id: `b-${categoryId}`, now: NOW })
    await transactionsRepository.create(
      { type: 'expense', amountSatang: baht(2_500), accountId: 'cash', categoryId: 'food', date: '2026-09-10' },
      [],
      tx('food'),
    )
    await transactionsRepository.create(
      { type: 'expense', amountSatang: baht(1_200), accountId: 'kbank', categoryId: 'transport', date: '2026-09-11' },
      [],
      tx('bts'),
    )
    await transactionsRepository.create(
      { type: 'expense', amountSatang: baht(1_500), accountId: 'card', categoryId: 'shopping', date: '2026-09-12' },
      [],
      tx('shirt'),
    )
    await transactionsRepository.create(
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
    await transactionsRepository.create(
      { type: 'debt_payment', debtId: 'cc', amountSatang: baht(3_000), accountId: 'kbank', date: '2026-09-20' },
      [],
      tx('cardpay'),
    )

    // Before paying rent / internet: expected, not spent.
    const before = await views()
    expect(before.dashboard.totals.expense).toBe(baht(5_200))
    expect(before.dashboard.upcoming.total).toBe(baht(7_800 + 899))
    expect(before.calendar.totals).toMatchObject({ expenses: baht(5_200), scheduledOut: baht(8_699) })
    expect(await done()).toMatchObject({ recurring: true, budget: true, debts: true })

    // Pay rent ("ชำระแล้ว"); a repeated confirmation creates nothing.
    const rent = (await scheduledPaymentsRepository.listForSource('obligation', 'rent')).find((p) => p.dueDate === '2026-09-06')!
    const pay = () =>
      scheduledPaymentsRepository.markPaid(
        rent.id,
        { type: 'expense', amountSatang: baht(7_800), accountId: 'kbank', categoryId: 'home-cat', date: '2026-09-06' },
        [],
        {
          transactionId: 'rent-paid',
          now: NOW,
          newId,
        },
      )
    await pay()
    await pay()
    expect(await db.transactions.where('scheduledPaymentId').equals(rent.id).count()).toBe(1)

    const after = await views()
    const totals = { income: baht(27_500), expense: baht(5_200 + 7_800), debtPayment: baht(10_800) }
    expect(after.dashboard.totals).toMatchObject(totals)
    expect(after.analytics.totals).toMatchObject(totals)
    expect(after.ledger.summary).toMatchObject(totals)
    expect(after.calendar.totals).toMatchObject({ expenses: totals.expense, scheduledOut: baht(899) })
    expect(after.dashboard.upcoming.total).toBe(baht(899))
    const usage = Object.fromEntries(after.budget.rows.map((r) => [r.budget.categoryId, formatUsage(r.usageBps!)]))
    expect(usage).toEqual({ food: '41.7%', transport: '40%', shopping: '75%' })
    expect(after.analytics.debts.lines.find((l) => l.debt.id === 'home')?.outstanding).toBe(baht(1_194_000))
    expect(after.analytics.debts.lines.find((l) => l.debt.id === 'cc')?.outstanding).toBe(baht(8_000 + 1_500 - 3_000))
    expect(auditIntegrity(await loadIntegritySnapshot(db)).ok).toBe(true)
  })
})
