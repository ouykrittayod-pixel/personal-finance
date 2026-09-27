// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/feedback/Toast'
import { db } from '@/db/dexie'
import { budgetsRepository } from '@/db/repositories'
import { OVERALL_BUDGET } from '@/domain/budget'
import { buildLedger, filtersFromParams, ledgerLinkFor } from '@/features/transactions/ledger-data'
import { t } from '@/lib/i18n'
import { baht, makeAccount, makeCategory, makeTx } from '@/test/factories'
import { BudgetView } from './BudgetPage'

const TODAY = '2026-09-25'
const now = `${TODAY}T03:00:00.000Z`

function renderBudget(path = '/budget') {
  const router = createMemoryRouter(
    [
      { path: '/budget', element: <BudgetView today={TODAY} /> },
      { path: '/transactions', element: <p>ledger</p> },
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

async function seedCategories() {
  await db.accounts.bulkAdd([makeAccount({ id: 'kbank', name: 'KBank' }), makeAccount({ id: 'cash', name: 'เงินสด', kind: 'cash' }), makeAccount({ id: 'card', name: 'บัตร', kind: 'credit_card' })])
  await db.categories.bulkAdd([
    makeCategory({ id: 'food', name: 'อาหาร', icon: '🍚', sortOrder: 0 }),
    makeCategory({ id: 'travel', name: 'เดินทาง', icon: '🚆', sortOrder: 1 }),
    makeCategory({ id: 'shopping', name: 'ช้อปปิ้ง', icon: '🛍️', sortOrder: 2 }),
    makeCategory({ id: 'health', name: 'สุขภาพ', sortOrder: 3 }),
    makeCategory({ id: 'salary', name: 'เงินเดือน', kind: 'income' }),
  ])
}

async function seedSeptember() {
  await seedCategories()
  for (const [id, categoryId, limit] of [
    ['b-food', 'food', 6_000],
    ['b-travel', 'travel', 3_000],
    ['b-shop', 'shopping', 2_000],
    ['b-health', 'health', 1_000],
  ] as const) {
    await budgetsRepository.create({ month: '2026-09', categoryId, limitSatang: baht(limit) }, { id, now })
  }
  await budgetsRepository.create({ month: '2026-08', categoryId: 'food', limitSatang: baht(5_000) }, { id: 'b-aug', now })
  await db.transactions.bulkAdd([
    makeTx({ id: 'f1', type: 'expense', amountSatang: baht(1_000), accountId: 'cash', categoryId: 'food', date: '2026-09-03' }),
    makeTx({ id: 'f2', type: 'expense', amountSatang: baht(1_500), accountId: 'kbank', categoryId: 'food', date: '2026-09-04' }),
    makeTx({ id: 't1', type: 'expense', amountSatang: baht(2_100), accountId: 'kbank', categoryId: 'travel', date: '2026-09-05' }),
    makeTx({ id: 's1', type: 'expense', amountSatang: baht(2_350), accountId: 'kbank', categoryId: 'shopping', date: '2026-09-06' }),
    makeTx({ id: 's2', type: 'expense', amountSatang: baht(1_200), accountId: 'card', categoryId: 'shopping', date: '2026-09-07' }),
    makeTx({ id: 'pay', type: 'debt_payment', amountSatang: baht(1_200), accountId: 'kbank', toAccountId: 'card', debtId: 'cc', date: '2026-09-20' }),
    makeTx({ id: 'loan', type: 'debt_payment', amountSatang: baht(7_800), accountId: 'kbank', debtId: 'home', date: '2026-09-05' }),
    makeTx({ id: 'inc', type: 'income', amountSatang: baht(27_500), accountId: 'kbank', categoryId: 'salary', date: '2026-09-25' }),
    makeTx({ id: 'move', type: 'transfer', amountSatang: baht(5_000), accountId: 'kbank', toAccountId: 'cash', date: '2026-09-10' }),
    makeTx({ id: 'aug', type: 'expense', amountSatang: baht(2_000), accountId: 'cash', categoryId: 'food', date: '2026-08-20' }),
  ])
}

const list = () => screen.findByRole('list', { name: t('budget.list') })
const card = async (name: RegExp) => (await within(await list()).findByRole('heading', { name })).closest('li')!

beforeEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(db.tables.map((table) => table.clear()))
})

describe('Budget — empty and create', () => {
  beforeEach(seedCategories)

  it('shows the header and an empty state; never creates budgets by itself', async () => {
    renderBudget()
    expect(await screen.findByRole('heading', { level: 1, name: 'งบประมาณ' })).toBeInTheDocument()
    expect(screen.getByText('วางแผนและติดตามค่าใช้จ่ายในแต่ละเดือน')).toBeInTheDocument()
    expect(await screen.findByText(t('budget.empty'))).toBeInTheDocument()
    expect(await db.budgets.count()).toBe(0)
  })

  it('creates a category budget once on a double tap; income categories are not offered; duplicates point to the existing one', async () => {
    const { user } = renderBudget()
    await screen.findByText(t('budget.empty'))
    await user.click(screen.getAllByRole('button', { name: t('budget.add') })[0]!)
    const form = await screen.findByRole('dialog', { name: t('budget.form.createTitle') })
    const category = within(form).getByLabelText(t('budget.form.category'))
    expect(within(category).queryByRole('option', { name: /เงินเดือน/ })).not.toBeInTheDocument()
    await user.click(within(form).getByRole('button', { name: t('budget.form.save') }))
    expect(await within(form).findByRole('alert')).toHaveTextContent(t('budget.error.category_required'))

    await user.selectOptions(category, 'food')
    await user.type(within(form).getByLabelText(t('budget.form.amount')), '6000')
    await user.dblClick(within(form).getByRole('button', { name: t('budget.form.save') }))
    await screen.findByText(t('budget.toast.created', { name: 'อาหาร' }))
    expect(await db.budgets.toArray()).toEqual([expect.objectContaining({ month: '2026-09', categoryId: 'food', limitSatang: baht(6_000) })])
    expect(Object.keys((await db.budgets.toArray())[0]!).sort()).toEqual(['categoryId', 'createdAt', 'id', 'limitSatang', 'month', 'updatedAt'])

    await user.click(screen.getAllByRole('button', { name: t('budget.add') })[0]!)
    const again = await screen.findByRole('dialog', { name: t('budget.form.createTitle') })
    await user.selectOptions(within(again).getByLabelText(t('budget.form.category')), 'food')
    await user.type(within(again).getByLabelText(t('budget.form.amount')), '1')
    await user.click(within(again).getByRole('button', { name: t('budget.form.save') }))
    expect(await within(again).findAllByText(t('budget.error.duplicate'))).not.toHaveLength(0)
    await user.click(within(again).getByRole('button', { name: t('budget.form.openExisting') }))
    expect(await screen.findByRole('dialog', { name: t('budget.form.editTitle') })).toBeInTheDocument()
    expect(await db.budgets.count()).toBe(1)
  })
})

describe('Budget — progress', () => {
  beforeEach(seedSeptember)

  it('shows spent from expenses only (card purchase once; payments, income, transfers ignored), with words, not colour alone', async () => {
    renderBudget()
    const food = await card(/อาหาร/)
    expect(food).toHaveTextContent(t('budget.line.spent', { amount: '฿2,500' }))
    expect(food).toHaveTextContent(t('budget.line.left', { amount: '฿3,500' }))
    expect(food).toHaveTextContent(t('budget.status.under_budget'))
    const shopping = await card(/ช้อปปิ้ง/)
    expect(shopping).toHaveTextContent(t('budget.line.spent', { amount: '฿3,550' }))
    expect(shopping).toHaveTextContent(t('budget.line.over', { amount: '฿1,550' }))
    expect(shopping).toHaveTextContent('177.5%')
    expect(shopping).toHaveTextContent(t('budget.status.over_budget'))
    expect(within(shopping).getByText(/เกินงบ 1,550 บาท/)).toHaveClass('sr-only')
    const travel = await card(/เดินทาง/)
    expect(travel).toHaveTextContent(t('budget.status.under_budget')) // ฿2,100 of ฿3,000 = 70%
    expect(travel).toHaveTextContent('70%')
    const health = await card(/สุขภาพ/)
    expect(health).toHaveTextContent(t('budget.line.unused', { amount: '฿1,000' }))
    const summary = screen.getByRole('region', { name: t('budget.summary') })
    expect(summary).toHaveTextContent(t('budget.summary.categoryLimit'))
    expect(summary).toHaveTextContent('฿12,000')
    expect(summary).toHaveTextContent('฿8,150')
  })

  it('navigates months without mixing them', async () => {
    const { user, router } = renderBudget()
    await card(/อาหาร/)
    await user.click(screen.getByRole('button', { name: t('month.previous') }))
    await waitFor(() => expect(router.state.location.search).toBe('?month=2026-08'))
    const food = await card(/อาหาร/)
    expect(food).toHaveTextContent(t('budget.line.spent', { amount: '฿2,000' }))
    expect(food).toHaveTextContent(t('budget.line.limit', { amount: '฿5,000' }))
    await user.click(screen.getByRole('button', { name: t('month.current') }))
    await waitFor(() => expect(router.state.location.search).toBe(''))
  })

  it('edit changes the plan only; delete removes the plan only', async () => {
    const { user } = renderBudget()
    const food = await card(/อาหาร/)
    await user.click(within(food).getByRole('button', { name: t('budget.action.editFor', { name: 'อาหาร' }) }))
    const form = await screen.findByRole('dialog', { name: t('budget.form.editTitle') })
    const amount = within(form).getByLabelText(t('budget.form.amount'))
    await user.clear(amount)
    await user.type(amount, '7000')
    await user.click(within(form).getByRole('button', { name: t('budget.form.save') }))
    await screen.findByText(t('budget.toast.updated'))
    await waitFor(async () => expect(await card(/อาหาร/)).toHaveTextContent(t('budget.line.left', { amount: '฿4,500' })))
    expect(await card(/อาหาร/)).toHaveTextContent(t('budget.line.spent', { amount: '฿2,500' }))

    const txs = await db.transactions.toArray()
    await user.click(within(await card(/อาหาร/)).getByRole('button', { name: t('budget.action.deleteFor', { name: 'อาหาร' }) }))
    const confirm = await screen.findByRole('dialog', { name: 'ลบงบประมาณนี้หรือไม่?' })
    await user.click(within(confirm).getByRole('button', { name: t('budget.action.delete') }))
    await screen.findByText(t('budget.toast.deleted', { name: 'อาหาร' }))
    expect(await db.budgets.get('b-food')).toBeUndefined()
    expect(await db.transactions.toArray()).toEqual(txs)
  })

  it('"ดูรายการ" opens Transactions filtered to the month, expenses and the category', async () => {
    const { user, router } = renderBudget()
    const food = await card(/อาหาร/)
    await user.click(within(food).getByRole('link', { name: t('budget.action.viewFor', { name: 'อาหาร' }) }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/transactions'))
    expect(router.state.location.search).toBe('?month=2026-09&type=expense&category=food')
  })

  it('an overall monthly limit is separate from category budgets', async () => {
    await budgetsRepository.create({ month: '2026-09', categoryId: OVERALL_BUDGET, limitSatang: baht(25_000) }, { id: 'all', now })
    renderBudget()
    const summary = await screen.findByRole('region', { name: t('budget.summary') })
    await waitFor(() => expect(summary).toHaveTextContent(t('budget.summary.overallLimit')))
    expect(summary).toHaveTextContent('฿25,000')
    expect(summary).toHaveTextContent('฿8,150')
    expect(await screen.findByRole('list', { name: t('budget.overall.name') })).toBeInTheDocument()
  })
})

describe('Transactions deep link', () => {
  it('filters the ledger to the month, type and category', async () => {
    await seedSeptember()
    const params = new URL(`http://x${ledgerLinkFor('2026-09', 'food')}`).searchParams
    const filters = filtersFromParams(params, TODAY)
    expect(filters).toMatchObject({ preset: 'custom', customStart: '2026-09-01', customEnd: '2026-09-30', type: 'expense', categoryId: 'food' })
    const ledger = buildLedger({ transactions: await db.transactions.toArray(), accounts: await db.accounts.toArray(), categories: await db.categories.toArray(), debts: [], transactionIdsWithAttachments: new Set() }, filters, TODAY, 50)
    expect(ledger.groups.flatMap((g) => g.rows.map((r) => r.id)).sort()).toEqual(['f1', 'f2'])
    expect(ledger.categoryName).toBe('อาหาร')
    expect(filtersFromParams(new URLSearchParams('month=bad&type=nope'), TODAY)).toMatchObject({ preset: 'month', type: 'all' })
  })
})
