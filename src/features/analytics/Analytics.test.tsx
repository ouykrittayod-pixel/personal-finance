// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/feedback/Toast'
import { db } from '@/db/dexie'
import { budgetsRepository, debtsRepository, recurringObligationsRepository, scheduledPaymentsRepository } from '@/db/repositories'
import { t } from '@/lib/i18n'
import { baht, makeAccount, makeCategory, makeTx } from '@/test/factories'
import { AnalyticsView } from './AnalyticsPage'

const TODAY = '2026-09-30'
const now = `${TODAY}T03:00:00.000Z`
let counter = 0
const newId = () => `gen-${++counter}`

function renderAnalytics(path = '/analytics') {
  const router = createMemoryRouter(
    [
      { path: '/analytics', element: <AnalyticsView today={TODAY} /> },
      { path: '*', element: <p>elsewhere</p> },
    ],
    { initialEntries: [path] },
  )
  const user = userEvent.setup()
  render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>,
  )
  return { user, router }
}

async function seed() {
  await db.accounts.bulkAdd([
    makeAccount({
      id: 'kbank',
      name: 'KBank',
      openingBalanceSatang: baht(50_000),
      openingDate: '2026-08-01',
      sortOrder: 0,
    }),
    makeAccount({
      id: 'cash',
      name: 'Cash',
      kind: 'cash',
      openingBalanceSatang: baht(5_000),
      openingDate: '2026-08-01',
      sortOrder: 1,
    }),
    makeAccount({
      id: 'card',
      name: 'บัตร KBank',
      kind: 'credit_card',
      openingDate: '2026-08-01',
      sortOrder: 2,
    }),
  ])
  await db.categories.bulkAdd([
    makeCategory({ id: 'food', name: 'อาหาร', sortOrder: 0 }),
    makeCategory({ id: 'transport', name: 'เดินทาง', sortOrder: 1 }),
    makeCategory({ id: 'shopping', name: 'ช้อปปิ้ง', sortOrder: 2 }),
    makeCategory({ id: 'rent', name: 'ค่าเช่า', sortOrder: 3 }),
    makeCategory({ id: 'salary', name: 'เงินเดือน', kind: 'income' }),
  ])
  const stamp = { now, today: TODAY, newId }
  await debtsRepository.create(
    {
      name: 'สินเชื่อบ้าน',
      kind: 'mortgage',
      openingBalanceSatang: baht(1_200_000),
      openingDate: '2026-08-01',
      interestMethod: 'unknown',
    },
    { ...stamp, id: 'home' },
  )
  await debtsRepository.create(
    {
      name: 'บัตร KBank',
      kind: 'credit_card',
      openingBalanceSatang: null,
      openingDate: '2026-08-01',
      interestMethod: 'unknown',
      linkedAccountId: 'card',
    },
    { ...stamp, id: 'cc' },
  )
  await recurringObligationsRepository.create(
    {
      name: 'ค่าเช่าห้อง',
      amountSatang: baht(7_800),
      categoryId: 'rent',
      defaultAccountId: 'kbank',
      recurrence: {
        frequency: 'monthly',
        interval: 1,
        startDate: '2026-09-01',
        dayOfMonth: 6,
      },
    },
    { ...stamp, id: 'rent-rule' },
  )
  const occurrence = (await scheduledPaymentsRepository.listForSource('obligation', 'rent-rule')).find((p) => p.dueDate === '2026-09-06')!
  await scheduledPaymentsRepository.markPaid(
    occurrence.id,
    {
      type: 'expense',
      amountSatang: baht(7_800),
      accountId: 'kbank',
      categoryId: 'rent',
      date: '2026-09-06',
    },
    [],
    { transactionId: 'rent', now, newId },
  )
  for (const [categoryId, limit] of [
    ['food', 6_000],
    ['transport', 3_000],
    ['shopping', 2_000],
    ['rent', 8_000],
  ] as const) {
    await budgetsRepository.create({ month: '2026-09', categoryId, limitSatang: baht(limit) }, { id: `b-${categoryId}`, now })
  }
  await db.transactions.bulkAdd([
    makeTx({
      id: 'wage',
      type: 'income',
      amountSatang: baht(27_500),
      accountId: 'kbank',
      categoryId: 'salary',
      date: '2026-09-30',
    }),
    makeTx({
      id: 'f1',
      type: 'expense',
      amountSatang: baht(1_000),
      accountId: 'cash',
      categoryId: 'food',
      date: '2026-09-03',
    }),
    makeTx({
      id: 'f2',
      type: 'expense',
      amountSatang: baht(1_500),
      accountId: 'kbank',
      categoryId: 'food',
      date: '2026-09-04',
    }),
    makeTx({
      id: 't1',
      type: 'expense',
      amountSatang: baht(2_100),
      accountId: 'kbank',
      categoryId: 'transport',
      date: '2026-09-05',
    }),
    makeTx({
      id: 's1',
      type: 'expense',
      amountSatang: baht(2_350),
      accountId: 'kbank',
      categoryId: 'shopping',
      date: '2026-09-06',
    }),
    makeTx({
      id: 's2',
      type: 'expense',
      amountSatang: baht(1_200),
      accountId: 'card',
      categoryId: 'shopping',
      date: '2026-09-07',
    }),
    makeTx({
      id: 'cardpay',
      type: 'debt_payment',
      amountSatang: baht(3_000),
      accountId: 'kbank',
      toAccountId: 'card',
      debtId: 'cc',
      date: '2026-09-20',
    }),
    makeTx({
      id: 'loan',
      type: 'debt_payment',
      amountSatang: baht(7_800),
      accountId: 'kbank',
      debtId: 'home',
      principalSatang: baht(6_000),
      interestSatang: baht(1_800),
      feeSatang: baht(0),
      date: '2026-09-25',
    }),
    makeTx({
      id: 'move',
      type: 'transfer',
      amountSatang: baht(5_000),
      accountId: 'kbank',
      toAccountId: 'cash',
      date: '2026-09-05',
    }),
    makeTx({
      id: 'aug-wage',
      type: 'income',
      amountSatang: baht(25_000),
      accountId: 'kbank',
      categoryId: 'salary',
      date: '2026-08-25',
    }),
    makeTx({
      id: 'aug-food',
      type: 'expense',
      amountSatang: baht(10_000),
      accountId: 'cash',
      categoryId: 'food',
      date: '2026-08-20',
    }),
    makeTx({
      id: 'oct-food',
      type: 'expense',
      amountSatang: baht(3_000),
      accountId: 'cash',
      categoryId: 'food',
      date: '2026-10-02',
    }),
  ])
}

const overview = () => screen.findByRole('region', { name: t('analytics.overview') })
const section = (title: string) => screen.getByRole('heading', { name: title }).closest('[data-slot="card"]') as HTMLElement

beforeEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(db.tables.map((table) => table.clear()))
})

describe('Analytics', () => {
  it('shows an empty state without data', async () => {
    renderAnalytics()
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: t('analytics.title'),
      }),
    ).toBeInTheDocument()
    expect(await screen.findByText(t('analytics.empty'))).toBeInTheDocument()
  })

  describe('with a month of data', () => {
    beforeEach(seed)

    it('overview: income, expense (no debt payments, no transfers), debt payments and income − expense, compared with August', async () => {
      renderAnalytics()
      const region = await overview()
      expect(region).toHaveTextContent('+฿27,500')
      expect(region).toHaveTextContent('฿15,950')
      expect(region).toHaveTextContent('฿10,800')
      expect(region).toHaveTextContent('฿11,550')
      expect(region).toHaveTextContent('+฿2,500 (+10%)')
      expect(region).toHaveTextContent('+฿5,950 (+59.5%)')
      expect(region).toHaveTextContent(
        t('analytics.outflow', {
          total: '฿26,750',
          expense: '฿15,950',
          debt: '฿10,800',
        }),
      )
    })

    it('insights are factual sentences only', async () => {
      renderAnalytics()
      await overview()
      const list = screen.getByRole('list', { name: t('analytics.insights') })
      expect(list).toHaveTextContent('รายจ่ายเดือนนี้ ฿15,950 เพิ่มขึ้น ฿5,950 (59.5%) จากสิงหาคม 2026')
      expect(list).toHaveTextContent('ค่าเช่า เป็นหมวดที่มีรายจ่ายสูงสุดในเดือนนี้ ฿7,800 (48.9% ของรายจ่าย)')
      expect(list).toHaveTextContent('ใช้งบช้อปปิ้งไป 177.5% (เกินงบ ฿1,550)')
      expect(list).toHaveTextContent('ชำระหนี้เดือนนี้ ฿10,800 (เงินต้น ฿6,000 · ดอกเบี้ย/ค่าธรรมเนียม ฿1,800)')
      expect(list).toHaveTextContent('รายจ่ายประจำที่จ่ายแล้ว ฿7,800')
    })

    it('categories: card purchase counted once, table with shares, drill-down into the ledger, chart text equivalent', async () => {
      renderAnalytics()
      await overview()
      const table = screen.getByRole('table', {
        name: t('analytics.categories.table'),
      })
      const shopping = within(table).getByRole('row', { name: /ช้อปปิ้ง/ })
      expect(shopping).toHaveTextContent('฿3,550')
      expect(shopping).toHaveTextContent('22.3%')
      expect(
        within(table).getByRole('link', {
          name: t('analytics.categories.open', { name: 'อาหาร' }),
        }),
      ).toHaveAttribute('href', '/transactions?month=2026-09&type=expense&category=food')
      expect(screen.getByText(/อาหาร ฿2,500, 15.7%/)).toBeInTheDocument()
    })

    it('budget: the Budget page numbers, planned vs actual, with links', async () => {
      renderAnalytics()
      await overview()
      const budget = section(t('analytics.budget.title'))
      expect(budget).toHaveTextContent('41.7%')
      expect(budget).toHaveTextContent('70%')
      expect(budget).toHaveTextContent('177.5%')
      expect(budget).toHaveTextContent('97.5%')
      expect(budget).toHaveTextContent(t('analytics.budget.note'))
      expect(
        within(budget).getByRole('link', {
          name: new RegExp(t('dashboard.viewAll')),
        }),
      ).toHaveAttribute('href', '/budget?month=2026-09')
    })

    it('debts, cash position and paid recurring bills', async () => {
      renderAnalytics()
      await overview()
      const debts = section(t('analytics.debt.title'))
      expect(
        within(debts).getByRole('link', {
          name: t('analytics.debt.open', { name: 'สินเชื่อบ้าน' }),
        }),
      ).toHaveAttribute('href', '/debts?id=home')
      expect(debts).toHaveTextContent('฿1,194,000')
      expect(debts).toHaveTextContent(
        t('analytics.debt.split', {
          principal: '฿6,000',
          interest: '฿1,800',
          fees: '฿0',
        }),
      )
      const cash = section(t('analytics.cash.title'))
      // KBank 50,000 + 25,000 + 27,500 − 1,500 − 2,100 − 2,350 − 7,800 − 3,000 − 7,800 − 5,000 ; Cash 5,000 − 10,000 − 1,000 + 5,000
      expect(cash).toHaveTextContent('฿72,950')
      // The card was paid ฿3,000 against a ฿1,200 purchase: a ฿1,800 credit, never shown as card debt.
      expect(cash).toHaveTextContent(t('analytics.cash.cardCredit'))
      expect(cash).not.toHaveTextContent(t('analytics.cash.card') + '฿')
      expect(debts).toHaveTextContent(t('debts.row.cardCredit', { amount: '฿1,800' }))
      const recurring = section(t('analytics.recurring.title'))
      expect(recurring).toHaveTextContent('ค่าเช่าห้อง')
      expect(recurring).toHaveTextContent(t('analytics.recurring.total', { amount: '฿7,800', other: '฿8,150' }))
    })

    it('month navigation keeps each month to its own data', async () => {
      const { user, router } = renderAnalytics()
      await overview()
      await user.click(screen.getByRole('button', { name: t('month.previous') }))
      await waitFor(() => expect(router.state.location.search).toBe('?month=2026-08'))
      await waitFor(async () => expect(await overview()).toHaveTextContent('฿10,000'))
      expect(await overview()).toHaveTextContent(t('analytics.noPrevious'))
      await user.click(screen.getByRole('button', { name: t('month.next') }))
      await user.click(screen.getByRole('button', { name: t('month.next') }))
      await waitFor(() => expect(router.state.location.search).toBe('?month=2026-10'))
      await waitFor(async () => expect(await overview()).toHaveTextContent('฿3,000'))
      // October has not started on 30 September: balances are today's, with no comparison against a future month end.
      expect(section(t('analytics.cash.title'))).toHaveTextContent(t('analytics.cash.future'))
      expect(screen.getByRole('list', { name: t('analytics.insights') })).not.toHaveTextContent('เงินที่ใช้ได้')
    })
  })
})
