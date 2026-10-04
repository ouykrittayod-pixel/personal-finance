// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { ToastProvider } from '@/components/feedback/Toast'
import { formatSignedMoney } from '@/components/finance/money-format'
import { db } from '@/db/dexie'
import { t } from '@/lib/i18n'
import { baht, makeAccount, makeCategory, makeTx } from '@/test/factories'
import { DailyExpenses } from './ExpensesPage'

const TODAY = '2026-10-08'

function renderPage() {
  const router = createMemoryRouter([{ path: '/expenses', element: <DailyExpenses today={TODAY} /> }], { initialEntries: ['/expenses'] })
  const user = userEvent.setup()
  render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>,
  )
  return { user, router }
}

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()))
  await db.accounts.bulkAdd([makeAccount({ id: 'kbank', name: 'KBank', kind: 'bank', sortOrder: 0 })])
  await db.categories.bulkAdd([makeCategory({ id: 'food', name: 'อาหาร', icon: '🍜', sortOrder: 0 }), makeCategory({ id: 'travel', name: 'เดินทาง', icon: '🚆', sortOrder: 1 })])
  await db.transactions.bulkAdd([
    makeTx({ id: 'lunch', type: 'expense', amountSatang: baht(65), accountId: 'kbank', categoryId: 'food', date: '2026-10-08', description: 'ข้าวกะเพราไก่' }),
    makeTx({ id: 'bts', type: 'expense', amountSatang: baht(80), accountId: 'kbank', categoryId: 'travel', date: '2026-10-07', description: 'BTS' }),
    makeTx({ id: 'card', type: 'debt_payment', amountSatang: baht(2_500), accountId: 'kbank', debtId: 'd', date: '2026-10-08', description: 'จ่ายบัตร' }),
  ])
})

describe('Daily expenses page', () => {
  it('shows this month, today and this week, and the expenses by day — never debt payments', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: t('nav.expenses') })).toBeInTheDocument()
    expect(await screen.findByText('ข้าวกะเพราไก่')).toBeInTheDocument()
    expect(screen.getByText('BTS')).toBeInTheDocument()
    expect(screen.queryByText('จ่ายบัตร')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: new RegExp(`^${t('expenses.day.today')}`) })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: new RegExp(`^${t('expenses.day.yesterday')}`) })).toBeInTheDocument()
    // Month total: 65 + 80 (the debt payment is not an expense).
    expect(screen.getAllByText(formatSignedMoney(baht(145))).length).toBeGreaterThan(0)
  })

  it('filters by category from "more filters"', async () => {
    const { user } = renderPage()
    await screen.findByText('ข้าวกะเพราไก่')
    await user.click(screen.getByRole('button', { name: t('expenses.filter.more') }))
    await user.selectOptions(screen.getByLabelText(t('expenses.filter.category')), 'travel')
    expect(await screen.findByText('BTS')).toBeInTheDocument()
    expect(screen.queryByText('ข้าวกะเพราไก่')).not.toBeInTheDocument()
  })

  it('opens the shared transaction detail to edit or delete', async () => {
    const { user, router } = renderPage()
    const row = await screen.findByText('ข้าวกะเพราไก่')
    await user.click(row)
    expect(router.state.location.search).toBe('?tx=lunch')
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})
