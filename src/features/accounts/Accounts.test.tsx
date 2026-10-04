// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QuickEntryProvider } from '@/app/providers/QuickEntryProvider'
import { ToastProvider } from '@/components/feedback/Toast'
import { db } from '@/db/dexie'
import { accountsRepository } from '@/db/repositories'
import { calculateAvailableMoney } from '@/domain/accounts'
import { accountBalances } from '@/domain/reporting'
import { buildLedger, defaultFilters, type LedgerRawData } from '@/features/transactions/ledger-data'
import { t } from '@/lib/i18n'
import { baht, makeCategory, makeTx } from '@/test/factories'
import { Accounts } from './AccountsPage'

const TODAY = '2026-09-25'
const now = `${TODAY}T03:00:00.000Z`

function renderAccounts(path = '/accounts') {
  const router = createMemoryRouter([{ path: '/accounts', element: <Accounts today={TODAY} /> }], { initialEntries: [path] })
  const user = userEvent.setup()
  render(
    <ToastProvider>
      <QuickEntryProvider>
        <RouterProvider router={router} />
      </QuickEntryProvider>
    </ToastProvider>,
  )
  return { user, router }
}

async function seed() {
  await accountsRepository.create({ name: 'KBank', kind: 'bank', openingAmountSatang: baht(50_000), openingDate: '2026-09-01' }, { id: 'kbank', now })
  await accountsRepository.create({ name: 'เงินสด', kind: 'cash', openingAmountSatang: baht(0), openingDate: '2026-09-01' }, { id: 'cash', now })
  await accountsRepository.create({ name: 'SCB', kind: 'bank', openingAmountSatang: baht(20_000), openingDate: '2026-09-01' }, { id: 'scb', now })
  await accountsRepository.create({ name: 'KBank Credit Card', kind: 'credit_card', openingAmountSatang: baht(8_000), openingDate: '2026-09-01' }, { id: 'card', now })
  await accountsRepository.create({ name: 'Investment', kind: 'investment', openingAmountSatang: baht(100_000), openingDate: '2026-09-01' }, { id: 'invest', now })
}
const snapshot = async () => {
  const [accounts, txs] = await Promise.all([db.accounts.toArray(), db.transactions.toArray()])
  return { balances: accountBalances(accounts, txs), available: calculateAvailableMoney(accounts, txs).total, txs }
}
const list = () => screen.findByRole('list', { name: t('accounts.list') })
const summary = () => screen.findByRole('region', { name: t('accounts.summary') })

beforeEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(db.tables.map((table) => table.clear()))
})

describe('Accounts — empty and create', () => {
  it('shows an empty state and creates an account once, even on a double tap', async () => {
    const { user, router } = renderAccounts()
    expect(await screen.findByRole('heading', { level: 1, name: 'บัญชีของฉัน' })).toBeInTheDocument()
    expect(screen.getByText('จัดการบัญชี ยอดคงเหลือ และการโอนเงิน')).toBeInTheDocument()
    expect(await screen.findByText(t('accounts.empty'))).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: t('accounts.add') })[0]!)
    const form = await screen.findByRole('dialog', { name: t('accounts.form.createTitle') })
    await user.click(within(form).getByRole('button', { name: t('accounts.form.save') }))
    expect(await within(form).findByText(t('accounts.error.name_required'))).toBeInTheDocument()
    await user.type(within(form).getByLabelText(t('accounts.form.name')), 'KBank')
    await user.type(within(form).getByLabelText(t('accounts.form.opening')), '50000')
    await user.dblClick(within(form).getByRole('button', { name: t('accounts.form.save') }))
    await screen.findByText(t('accounts.toast.created', { name: 'KBank' }))
    expect(await db.accounts.count()).toBe(1)
    expect(await db.transactions.count()).toBe(0) // the opening balance is not a transaction
    expect(await db.accounts.toArray()).toEqual([expect.objectContaining({ name: 'KBank', kind: 'bank', openingBalanceSatang: baht(50_000), openingDate: TODAY })])
    await waitFor(() => expect(router.state.location.search).toMatch(/^\?id=/))
  })

  it('a credit card opening is entered as the amount owed', async () => {
    const { user } = renderAccounts()
    await screen.findByText(t('accounts.empty'))
    await user.click(screen.getAllByRole('button', { name: t('accounts.add') })[0]!)
    const form = await screen.findByRole('dialog', { name: t('accounts.form.createTitle') })
    await user.type(within(form).getByLabelText(t('accounts.form.name')), 'KBank Credit Card')
    await user.selectOptions(within(form).getByLabelText(t('accounts.form.kind')), 'credit_card')
    await user.type(within(form).getByLabelText(t('accounts.form.openingOwed')), '8000')
    await user.click(within(form).getByRole('button', { name: t('accounts.form.save') }))
    await screen.findByText(t('accounts.toast.created', { name: 'KBank Credit Card' }))
    expect((await db.accounts.toArray())[0]).toMatchObject({ kind: 'credit_card', openingBalanceSatang: baht(-8_000) })
  })
})

describe('Accounts — overview, detail, archive', () => {
  beforeEach(seed)

  it('summarises available money (no investment, no card), card owed and investments; lists balances with the card as owed', async () => {
    renderAccounts()
    const region = await summary()
    expect(within(region).getByText(t('accounts.metric.available')).closest('div')?.parentElement).toHaveTextContent('฿70,000')
    expect(region).toHaveTextContent('฿8,000')
    expect(region).toHaveTextContent('฿100,000')
    const card = within(await list()).getByRole('button', { name: /KBank Credit Card/ })
    expect(card).toHaveTextContent(t('accounts.owed', { amount: '฿8,000' }))
    expect(card).toHaveAccessibleName(expect.stringContaining(t('accounts.balanceLabel')))
  })

  it('detail shows opening state, totals and history; a transaction opens the shared detail', async () => {
    await db.categories.add(makeCategory({ id: 'salary', name: 'เงินเดือน', kind: 'income' }))
    await db.transactions.bulkAdd([
      makeTx({ id: 'i1', type: 'income', amountSatang: baht(27_500), accountId: 'kbank', categoryId: 'salary', date: '2026-09-25', description: 'เงินเดือน' }),
      makeTx({ id: 't1', type: 'transfer', amountSatang: baht(5_000), accountId: 'kbank', toAccountId: 'cash', date: '2026-09-24', description: 'ถอนเงินสด' }),
    ])
    const { user, router } = renderAccounts('/accounts?id=kbank')
    const dialog = await screen.findByRole('dialog', { name: t('accounts.detail.title') })
    expect(await within(dialog).findByText('01/09/2026')).toBeInTheDocument()
    expect(within(dialog).getByText(t('accounts.detail.transfersOut')).parentElement).toHaveTextContent('฿5,000')
    expect(within(dialog).getByText(t('accounts.detail.incomeIn')).parentElement).toHaveTextContent('฿27,500')
    const recent = within(dialog).getByRole('list', { name: t('accounts.detail.recent') })
    const transferRow = within(recent).getByRole('button', { name: /ถอนเงินสด/ })
    expect(transferRow).toHaveAccessibleName(expect.stringContaining(t('transfer.a11y', { from: 'KBank', to: 'เงินสด' })))
    await user.click(transferRow)
    await waitFor(() => expect(router.state.location.search).toBe('?id=kbank&tx=t1'))
    const tx = await screen.findByRole('dialog', { name: t('detail.title') })
    expect(await within(tx).findByText(t('detail.fromAccount'))).toBeInTheDocument()
  })

  it('archive: confirmation says history is kept; the account leaves active lists and available money', async () => {
    await db.transactions.add(makeTx({ id: 'old', type: 'transfer', amountSatang: baht(1_000), accountId: 'kbank', toAccountId: 'scb', date: '2026-09-10' }))
    const { user } = renderAccounts('/accounts?id=scb')
    const dialog = await screen.findByRole('dialog', { name: t('accounts.detail.title') })
    await user.click(await within(dialog).findByRole('button', { name: t('accounts.action.archive') }))
    const confirm = await screen.findByRole('dialog', { name: t('accounts.archive.title') })
    expect(within(confirm).getByText('การเก็บบัญชีจะไม่ลบประวัติธุรกรรม')).toBeInTheDocument()
    await user.click(within(confirm).getByRole('button', { name: t('accounts.action.archive') }))
    await screen.findByText(t('accounts.toast.archived', { name: 'SCB' }))
    expect(await db.transactions.get('old')).toBeDefined()
    expect((await snapshot()).available).toBe(baht(49_000))
    expect((await accountsRepository.listActive()).map((a) => a.id)).not.toContain('scb')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(within(screen.getByRole('list', { name: t('accounts.list') })).queryByRole('button', { name: /SCB/ })).not.toBeInTheDocument())
    await user.click(screen.getByRole('radio', { name: t('accounts.filter.archived') }))
    expect(within(await list()).getByRole('button', { name: /SCB/ })).toHaveTextContent(t('accounts.status.archived'))
  })
})

describe('Transfers', () => {
  beforeEach(seed)

  it('"โอนเงิน" uses the shared form: asset accounts only, one transfer on a double tap, available unchanged', async () => {
    const { user } = renderAccounts()
    await summary()
    await user.click(screen.getByRole('button', { name: t('accounts.transfer') }))
    const sheet = await screen.findByRole('dialog', { name: t('transfer.title') }, { timeout: 5000 })
    const to = await within(sheet).findByRole('group', { name: t('txForm.toAccount') }, { timeout: 5000 })
    expect(within(to).queryByRole('radio', { name: /Credit Card/ })).not.toBeInTheDocument()
    await user.type(within(sheet).getByLabelText(t('form.amount')), '5000')
    await user.click(within(to).getByRole('radio', { name: /เงินสด/ }))
    await user.dblClick(screen.getByRole('button', { name: t('transfer.save') }))
    await screen.findByText(t('transfer.saved', { amount: '฿5,000' }))

    const { txs, balances, available } = await snapshot()
    expect(txs).toHaveLength(1)
    expect(txs[0]).toMatchObject({ type: 'transfer', accountId: 'kbank', toAccountId: 'cash', amountSatang: baht(5_000) })
    expect(balances.get('kbank')).toBe(baht(45_000))
    expect(balances.get('cash')).toBe(baht(5_000))
    expect(available).toBe(baht(70_000))
  })

  it('"โอนจากบัญชีนี้" preselects the source account', async () => {
    const { user } = renderAccounts('/accounts?id=scb')
    const dialog = await screen.findByRole('dialog', { name: t('accounts.detail.title') })
    await user.click(await within(dialog).findByRole('button', { name: t('accounts.action.transferFrom') }))
    const sheet = await screen.findByRole('dialog', { name: t('transfer.title') }, { timeout: 5000 })
    const from = await within(sheet).findByRole('group', { name: t('txForm.fromAccount') }, { timeout: 5000 })
    expect(within(from).getByRole('radio', { name: /SCB/ })).toBeChecked()
  })

  it('starts from an asset account even when the last expense was on a credit card', async () => {
    await db.categories.add(makeCategory({ id: 'food', name: 'อาหาร' }))
    await db.transactions.add(makeTx({ id: 'buy', type: 'expense', amountSatang: baht(1_200), accountId: 'card', categoryId: 'food', date: TODAY }))
    const { user } = renderAccounts()
    await summary()
    await user.click(screen.getByRole('button', { name: t('accounts.transfer') }))
    const sheet = await screen.findByRole('dialog', { name: t('transfer.title') }, { timeout: 5000 })
    const from = await within(sheet).findByRole('group', { name: t('txForm.fromAccount') }, { timeout: 5000 })
    expect(within(from).getByRole('radio', { name: /^KBank$/ })).toBeChecked()
    expect(within(sheet).queryByText(/Credit Card →/)).not.toBeInTheDocument()
  })

  it('appear in Transactions under โอน (never income or expense)', async () => {
    await db.transactions.add(makeTx({ id: 't1', type: 'transfer', amountSatang: baht(5_000), accountId: 'kbank', toAccountId: 'cash', date: TODAY }))
    const raw: LedgerRawData = { transactions: await db.transactions.toArray(), accounts: await db.accounts.toArray(), categories: [], debts: [], transactionIdsWithAttachments: new Set() }
    const ledger = buildLedger(raw, { ...defaultFilters(TODAY), type: 'transfer' }, TODAY, 50)
    expect(ledger.groups.flatMap((g) => g.rows)).toEqual([expect.objectContaining({ id: 't1', type: 'transfer', accountLabel: 'KBank', toAccountLabel: 'เงินสด' })])
    expect(ledger.summary).toMatchObject({ income: 0, expense: 0, debtPayment: 0 })
    expect(buildLedger(raw, { ...defaultFilters(TODAY), type: 'income' }, TODAY, 50).matchCount).toBe(0)
  })
})
