// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MINUS_SIGN } from '@/components/finance/money-format'
import { db } from '@/db/dexie'
import { t } from '@/lib/i18n'
import { baht, makeAccount, makeCategory, makeDebt, makeObligation, makeScheduled, makeTx } from '@/test/factories'
import { Dashboard } from './Dashboard'
import type { DashboardPeriod, DashboardRawData } from './dashboard-data'

const TODAY = '2026-09-25'

function renderDashboard(props: { load?: (period: DashboardPeriod) => Promise<DashboardRawData> } = {}, path = '/') {
  const router = createMemoryRouter([{ path: '/', element: <Dashboard today={TODAY} {...props} /> }], { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}

/** Summary card by its label. */
function statCard(label: string) {
  const summary = screen.getByRole('region', { name: t('dashboard.summary') })
  return within(summary).getByText(label).closest('[data-slot="card"]') as HTMLElement
}

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()))
})

describe('Dashboard — empty database', () => {
  it('shows designed empty states and zero totals, with no charts', async () => {
    renderDashboard()
    expect(await screen.findByRole('region', { name: t('dashboard.summary') })).toBeInTheDocument()

    expect(within(statCard(t('dashboard.available.label'))).getByText('฿0')).toBeInTheDocument()
    expect(screen.getByText(t('dashboard.available.none'))).toBeInTheDocument()
    expect(screen.getByText(t('dashboard.spending.empty'))).toBeInTheDocument()
    expect(screen.getByText(t('dashboard.cashflow.empty'))).toBeInTheDocument()
    expect(screen.getByText(t('dashboard.recent.empty'))).toBeInTheDocument()
    expect(screen.getByText(t('dashboard.upcomingList.empty'))).toBeInTheDocument()
    expect(screen.getByText(t('dashboard.debt.empty'))).toBeInTheDocument()
    expect(screen.queryByRole('figure')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('dashboard.upcomingList.manage') })).toHaveAttribute('href', '/recurring')
  })
})

describe('Dashboard — with data', () => {
  beforeEach(async () => {
    await db.accounts.bulkAdd([
      makeAccount({ id: 'bank', name: 'KBank', kind: 'bank', openingBalanceSatang: baht(10_000) }),
      makeAccount({ id: 'card', name: 'บัตรเครดิต', kind: 'credit_card' }),
    ])
    await db.categories.add(makeCategory({ id: 'food', name: 'อาหาร', icon: '🍚' }))
    await db.debts.add(makeDebt({ id: 'car', name: 'ผ่อนรถ', openingBalanceSatang: baht(100_000) }))
    await db.recurringObligations.add(makeObligation({ id: 'rent', name: 'ค่าบ้าน' }))
    await db.scheduledPayments.add(makeScheduled({ sourceId: 'rent', dueDate: '2026-09-28', expectedAmountSatang: baht(7_700) }))
    await db.transactions.bulkAdd([
      makeTx({ type: 'income', amountSatang: baht(27_500), accountId: 'bank', date: '2026-09-01', payee: 'เงินเดือน' }),
      makeTx({ type: 'expense', amountSatang: baht(85), accountId: 'card', categoryId: 'food', date: '2026-09-24', description: 'ข้าวกลางวัน' }),
      makeTx({ type: 'debt_payment', amountSatang: baht(85), accountId: 'bank', toAccountId: 'card', debtId: 'cc', date: '2026-09-25' }),
      makeTx({ type: 'expense', amountSatang: baht(400), accountId: 'bank', categoryId: 'food', date: '2026-08-10' }),
    ])
  })

  it('shows available money, month income and expenses (debt payment excluded)', async () => {
    renderDashboard()
    await screen.findByRole('region', { name: t('dashboard.summary') })

    expect(within(statCard(t('dashboard.available.label'))).getByText('฿37,015')).toBeInTheDocument()
    expect(within(statCard(t('dashboard.income.label'))).getByText('฿27,500')).toBeInTheDocument()
    const expense = statCard(t('dashboard.expense.label'))
    expect(within(expense).getByText('฿85')).toBeInTheDocument()
    expect(within(expense).getByText(/ไม่รวมชำระหนี้ ฿85/)).toBeInTheDocument()
    expect(within(statCard(t('dashboard.upcoming.label'))).getByText('฿7,700')).toBeInTheDocument()
  })

  it('lists recent transactions, upcoming payments and debt summary', async () => {
    renderDashboard()
    const recent = await screen.findByRole('list', { name: t('dashboard.recent.title') })
    expect(within(recent).getByText('ข้าวกลางวัน')).toBeInTheDocument()
    // The card purchase and the card payment are both −฿85, but look different.
    const tones = within(recent)
      .getAllByText(`${MINUS_SIGN}฿85`)
      .map((el) => el.getAttribute('data-tone'))
    expect(tones.sort()).toEqual(['debt', 'expense'])
    expect(screen.getByRole('link', { name: new RegExp(`${t('dashboard.viewAll')}\\s*${t('dashboard.recent.title')}`) })).toHaveAttribute('href', '/transactions')

    const upcoming = screen.getByRole('list', { name: t('dashboard.upcomingList.title') })
    expect(within(upcoming).getByText('ค่าบ้าน')).toBeInTheDocument()
    expect(within(upcoming).getByText(t('status.due_soon'))).toBeInTheDocument()

    expect(screen.getByText('ผ่อนรถ')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: t('dashboard.debt.progress') })).toBeInTheDocument()
  })

  it('gives every chart a text summary', async () => {
    renderDashboard()
    await screen.findByRole('region', { name: t('dashboard.summary') })
    expect(screen.getAllByRole('figure')).toHaveLength(2)
    expect(screen.getByText(/รายจ่ายรวม ฿85 แบ่งเป็น อาหาร ฿85 \(100%\)/)).toBeInTheDocument()
    expect(screen.getByText(/กันยายน 2026: รายรับ ฿27,500, รายจ่าย ฿85, ชำระหนี้ ฿85/)).toBeInTheDocument()
  })

  it('switches month with the selector and keeps it in the URL', async () => {
    const user = userEvent.setup()
    const router = renderDashboard()
    await screen.findByRole('region', { name: t('dashboard.summary') })

    await user.click(screen.getByRole('button', { name: t('month.previous') }))
    const label = await screen.findByText('รายจ่าย ส.ค. 2026')
    expect(within(label.closest('[data-slot="card"]') as HTMLElement).getByText('฿400')).toBeInTheDocument()
    expect(router.state.location.search).toBe('?month=2026-08')
    expect(screen.getByText(t('dashboard.subtitleMonth', { month: 'สิงหาคม 2026' }))).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: t('month.current') }))
    expect(await screen.findByText(t('dashboard.expense.label'))).toBeInTheDocument()
    expect(router.state.location.search).toBe('')
  })

  it('opens directly on a month from the URL and ignores invalid values', async () => {
    renderDashboard({}, '/?month=2026-08')
    expect(await screen.findByText('รายรับ ส.ค. 2026')).toBeInTheDocument()
  })

  it('updates live when a transaction is added', async () => {
    renderDashboard()
    await screen.findByRole('region', { name: t('dashboard.summary') })
    await db.transactions.add(makeTx({ type: 'income', amountSatang: baht(500), accountId: 'bank', date: '2026-09-26' }))
    expect(await within(statCard(t('dashboard.income.label'))).findByText('฿28,000')).toBeInTheDocument()
  })
})

describe('Dashboard — loading and error states', () => {
  it('shows a loading state while data loads', () => {
    renderDashboard({ load: () => new Promise<never>(() => {}) })
    expect(screen.getByRole('status')).toHaveTextContent(t('state.loading'))
  })

  it('shows an error with retry when loading fails', async () => {
    const user = userEvent.setup()
    const load = vi.fn<(period: DashboardPeriod) => Promise<DashboardRawData>>().mockRejectedValue(new Error('QuotaExceededError'))
    renderDashboard({ load })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('QuotaExceededError')
    const callsBefore = load.mock.calls.length
    await user.click(within(alert).getByRole('button', { name: t('common.retry') }))
    await vi.waitFor(() => expect(load.mock.calls.length).toBeGreaterThan(callsBefore))
  })
})
