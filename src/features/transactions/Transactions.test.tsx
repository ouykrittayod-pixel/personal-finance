// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QuickEntryProvider } from '@/app/providers/QuickEntryProvider'
import { ToastProvider } from '@/components/feedback/Toast'
import { MINUS_SIGN } from '@/components/finance/money-format'
import { db } from '@/db/dexie'
import { attachmentsRepository } from '@/db/repositories'
import { accountBalances } from '@/domain/reporting'
import { t } from '@/lib/i18n'
import { baht, makeAccount, makeCategory, makeDebt, makeTx } from '@/test/factories'
import type { DeleteTransaction, UpdateTransaction } from './detail/TransactionDetailSheet'
import { Transactions, type TransactionsProps } from './TransactionsPage'

const TODAY = '2026-09-25'

function renderLedger(props: Partial<TransactionsProps> = {}, path = '/transactions') {
  const router = createMemoryRouter([{ path: '/transactions', element: <Transactions today={TODAY} {...props} /> }], { initialEntries: [path] })
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

const list = () => screen.findByRole('region', { name: t('ledger.list') })
const rowButton = (name: RegExp) => screen.getByRole('button', { name })
async function seed() {
  await db.accounts.bulkAdd([
    makeAccount({ id: 'cash', name: 'เงินสด', kind: 'cash', openingBalanceSatang: baht(1_000), sortOrder: 0 }),
    makeAccount({ id: 'bank', name: 'KBank', kind: 'bank', openingBalanceSatang: baht(10_000), sortOrder: 1 }),
    makeAccount({ id: 'card', name: 'บัตรเครดิต', kind: 'credit_card', sortOrder: 2 }),
  ])
  await db.categories.bulkAdd([
    makeCategory({ id: 'food', name: 'อาหาร', icon: '🍚', sortOrder: 0 }),
    makeCategory({ id: 'drink', name: 'เครื่องดื่ม', icon: '☕', sortOrder: 1 }),
  ])
  await db.debts.bulkAdd([
    makeDebt({ id: 'cc', name: 'บัตรเครดิต KBank', kind: 'credit_card', linkedAccountId: 'card' }),
    makeDebt({ id: 'home', name: 'สินเชื่อบ้าน', kind: 'mortgage', openingBalanceSatang: baht(100_000) }),
  ])
  await db.transactions.bulkAdd([
    makeTx({ id: 'lunch', type: 'expense', amountSatang: baht(85), accountId: 'cash', categoryId: 'food', description: 'ข้าวกลางวัน', date: '2026-09-25', createdAt: '2026-09-25T05:00:00Z' }),
    makeTx({ id: 'coffee', type: 'expense', amountSatang: baht(60), accountId: 'cash', categoryId: 'drink', description: 'กาแฟ', date: '2026-09-25', createdAt: '2026-09-25T08:00:00Z' }),
    makeTx({ id: 'salary', type: 'income', amountSatang: baht(27_500), accountId: 'bank', description: 'เงินเดือน', date: '2026-09-24' }),
    makeTx({ id: 'ccpay', type: 'debt_payment', amountSatang: baht(2_500), accountId: 'bank', toAccountId: 'card', debtId: 'cc', date: '2026-09-24' }),
    makeTx({ id: 'mortgage', type: 'debt_payment', amountSatang: baht(9_000), principalSatang: baht(7_400), interestSatang: baht(1_500), feeSatang: baht(100), accountId: 'bank', debtId: 'home', date: '2026-09-20' }),
    makeTx({ id: 'move', type: 'transfer', amountSatang: baht(1_000), accountId: 'bank', toAccountId: 'cash', date: '2026-09-18' }),
    makeTx({ id: 'aug', type: 'expense', amountSatang: baht(400), accountId: 'cash', categoryId: 'food', description: 'มื้อเย็นเดือนก่อน', date: '2026-08-15' }),
  ])
  await db.attachments.add({ id: 'att1', transactionId: 'lunch', fileName: 'ใบเสร็จ.jpg', mimeType: 'image/jpeg', sizeBytes: 2048, createdAt: '2026-09-25T05:00:00Z' })
  await db.attachmentBlobs.add({ id: 'att1', blob: new Blob([new Uint8Array(2048)], { type: 'image/jpeg' }) })
}

beforeEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(db.tables.map((table) => table.clear()))
})

describe('Transactions — empty', () => {
  it('shows the empty state and opens the existing quick-entry flow', async () => {
    const { user } = renderLedger()
    expect(await screen.findByText(t('ledger.empty'))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t('ledger.addFirst') }))
    expect(await screen.findByRole('dialog', { name: t('quickAdd.title') })).toBeInTheDocument()
  })
})

describe('Transactions — list', () => {
  beforeEach(seed)

  it('renders this month newest first, grouped by date', async () => {
    renderLedger()
    const region = await list()
    const headings = within(region).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings).toEqual(['25/09/2026', '24/09/2026', '20/09/2026', '18/09/2026'])
    const titles = within(region).getAllByRole('button').map((b) => b.textContent)
    expect(titles[0]).toContain('กาแฟ')
    expect(titles[1]).toContain('ข้าวกลางวัน')
    expect(within(region).queryByText('มื้อเย็นเดือนก่อน')).not.toBeInTheDocument()
    expect(screen.getByText(t('ledger.count', { shown: 6, total: 6 }))).toBeInTheDocument()
  })

  it('names debt payments by their debt and never styles them as expenses', async () => {
    renderLedger()
    await list()
    const cc = rowButton(/ชำระบัตรเครดิต KBank/)
    expect(cc.closest('li')).toHaveAttribute('data-type', 'debt_payment')
    expect(within(cc).getByText(`${MINUS_SIGN}฿2,500`)).toHaveAttribute('data-tone', 'debt')
    expect(within(cc).getByText(/ชำระหนี้ · KBank → บัตรเครดิต/)).toBeInTheDocument()
    expect(within(cc).getByText('ชำระหนี้:', { exact: false })).toHaveClass('sr-only')
    expect(rowButton(/ชำระสินเชื่อบ้าน/)).toBeInTheDocument()
  })

  it('summarises the period with debt payments separate from expenses', async () => {
    renderLedger()
    const summary = within(await screen.findByLabelText(t('ledger.summary')))
    expect(summary.getByText('+฿27,500')).toBeInTheDocument()
    expect(summary.getByText(`${MINUS_SIGN}฿145`)).toBeInTheDocument() // 85 + 60 only
    expect(summary.getByText(`${MINUS_SIGN}฿11,500`)).toBeInTheDocument() // 2,500 + 9,000
  })

  it('shows an attachment indicator without loading any blob', async () => {
    const getBlob = vi.spyOn(attachmentsRepository, 'getBlob')
    renderLedger()
    await list()
    expect(within(rowButton(/ข้าวกลางวัน/)).getByText(t('attachment.present'))).toBeInTheDocument()
    expect(within(rowButton(/กาแฟ/)).queryByText(t('attachment.present'))).not.toBeInTheDocument()
    expect(getBlob).not.toHaveBeenCalled()
  })

  it('searches by description, category and account (debounced, no reload)', async () => {
    const { user } = renderLedger()
    await list()
    const search = screen.getByRole('searchbox', { name: t('ledger.searchLabel') })

    await user.type(search, 'ข้าว')
    await waitFor(() => expect(screen.queryByRole('button', { name: /กาแฟ/ })).not.toBeInTheDocument())
    expect(rowButton(/ข้าวกลางวัน/)).toBeInTheDocument()

    await user.clear(search)
    await user.type(search, 'เครื่องดื่ม')
    await waitFor(() => expect(screen.queryByRole('button', { name: /ข้าวกลางวัน/ })).not.toBeInTheDocument())
    expect(rowButton(/กาแฟ/)).toBeInTheDocument()

    await user.clear(search)
    await user.type(search, 'kbank')
    await waitFor(() => expect(screen.queryByRole('button', { name: /กาแฟ/ })).not.toBeInTheDocument())
    expect(rowButton(/เงินเดือน/)).toBeInTheDocument()

    await user.clear(search)
    await user.type(search, 'ไม่มีรายการนี้')
    expect(await screen.findByText(t('ledger.noSearch'))).toBeInTheDocument()
  })

  it('filters by type', async () => {
    const { user } = renderLedger()
    await list()
    await user.click(screen.getByRole('radio', { name: t('txType.debt_payment') }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /กาแฟ/ })).not.toBeInTheDocument())
    expect(rowButton(/ชำระบัตรเครดิต KBank/)).toBeInTheDocument()
    expect(rowButton(/ชำระสินเชื่อบ้าน/)).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: t('ledger.type.transfer') }))
    expect(await screen.findByRole('button', { name: /โอนไป เงินสด/ })).toBeInTheDocument()
  })

  it('filters by date preset and custom range', async () => {
    const { user } = renderLedger()
    await list()
    await user.click(screen.getByRole('radio', { name: t('ledger.range.today') }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /เงินเดือน/ })).not.toBeInTheDocument())
    expect(rowButton(/กาแฟ/)).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: t('ledger.range.custom') }))
    fireEvent.change(screen.getByLabelText(t('ledger.from')), { target: { value: '2026-08-01' } })
    fireEvent.change(screen.getByLabelText(t('ledger.to')), { target: { value: '2026-08-31' } })
    expect(await screen.findByRole('button', { name: /มื้อเย็นเดือนก่อน/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /กาแฟ/ })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(t('ledger.from')), { target: { value: '2025-01-01' } })
    fireEvent.change(screen.getByLabelText(t('ledger.to')), { target: { value: '2025-01-31' } })
    expect(await screen.findByText(t('ledger.noPeriod'))).toBeInTheDocument()
  })

  it('updates live when a transaction is created elsewhere', async () => {
    renderLedger()
    await list()
    await db.transactions.add(makeTx({ id: 'new', type: 'expense', amountSatang: baht(45), accountId: 'cash', categoryId: 'food', description: 'BTS', date: TODAY }))
    expect(await screen.findByRole('button', { name: /BTS/ })).toBeInTheDocument()
  })
})

describe('Transactions — detail', () => {
  beforeEach(seed)

  it('opens details and loads attachments only then', async () => {
    const getBlob = vi.spyOn(attachmentsRepository, 'getBlob')
    const { user, router } = renderLedger()
    await list()
    expect(getBlob).not.toHaveBeenCalled()

    await user.click(rowButton(/ข้าวกลางวัน/))
    const dialog = await screen.findByRole('dialog', { name: t('detail.title') })
    expect(router.state.location.search).toBe('?tx=lunch')
    expect(await within(dialog).findByText('ใบเสร็จ.jpg')).toBeInTheDocument()
    expect(getBlob).toHaveBeenCalledWith('att1')
    expect(within(dialog).getByText('🍚 อาหาร')).toBeInTheDocument()
    expect(within(dialog).getByText('25/09/2026')).toBeInTheDocument()
    expect(within(dialog).getByText(t('detail.createdAt'))).toBeInTheDocument()
  })

  it('shows debt, principal, interest and fees for a debt payment', async () => {
    renderLedger({}, '/transactions?tx=mortgage')
    const dialog = await screen.findByRole('dialog', { name: t('detail.title') })
    expect(await within(dialog).findByText('ชำระสินเชื่อบ้าน', { selector: 'dd' })).toBeInTheDocument()
    expect(within(dialog).getByText('฿7,400')).toBeInTheDocument()
    expect(within(dialog).getByText('฿1,500')).toBeInTheDocument()
    expect(within(dialog).getByText('฿100')).toBeInTheDocument()
  })

  it('shows source and destination accounts for a transfer', async () => {
    renderLedger({}, '/transactions?tx=move')
    const dialog = await screen.findByRole('dialog', { name: t('detail.title') })
    expect(await within(dialog).findByText(t('detail.fromAccount'))).toBeInTheDocument()
    expect(within(dialog).getByText('KBank')).toBeInTheDocument()
    expect(within(dialog).getByText('เงินสด')).toBeInTheDocument()
  })
})

describe('Transactions — edit', () => {
  beforeEach(seed)

  it('edits in place: same id, no second record, list and balance update live', async () => {
    const { user } = renderLedger({}, '/transactions?tx=lunch')
    const dialog = await screen.findByRole('dialog', { name: t('detail.title') })
    await user.click(await within(dialog).findByRole('button', { name: t('detail.edit') }))

    const amount = await screen.findByLabelText(t('form.amount'))
    expect(amount).toHaveValue('85')
    await user.clear(amount)
    await user.type(amount, '120')
    await user.click(screen.getByRole('radio', { name: /เครื่องดื่ม/ }))
    await user.click(screen.getByRole('button', { name: t('detail.save') }))

    expect(await screen.findByText(t('detail.saved'))).toBeInTheDocument()
    const stored = await db.transactions.get('lunch')
    expect(stored).toMatchObject({ id: 'lunch', type: 'expense', amountSatang: baht(120), categoryId: 'drink', createdAt: '2026-09-25T05:00:00Z' })
    expect(await db.transactions.count()).toBe(7)
    expect(await db.attachments.where('transactionId').equals('lunch').count()).toBe(1)
    const balances = accountBalances(await db.accounts.toArray(), await db.transactions.toArray())
    expect(balances.get('cash')).toBe(baht(1_000 - 120 - 60 + 1_000 - 400))
    expect(await screen.findByRole('dialog', { name: t('detail.title') })).toBeInTheDocument()
  })

  it('edits a debt payment’s split without turning it into an expense', async () => {
    const { user } = renderLedger({}, '/transactions?tx=mortgage')
    const dialog = await screen.findByRole('dialog', { name: t('detail.title') })
    await user.click(await within(dialog).findByRole('button', { name: t('detail.edit') }))
    expect(screen.queryByRole('group', { name: t('form.category') })).not.toBeInTheDocument()
    const interest = screen.getByLabelText(t('txForm.interest'))
    await user.clear(interest)
    await user.type(interest, '2000')
    // Parts no longer add up: rejected in Thai, nothing saved.
    await user.click(screen.getByRole('button', { name: t('detail.save') }))
    expect(await screen.findByText(t('txForm.error.allocation_mismatch'))).toBeInTheDocument()
    expect((await db.transactions.get('mortgage'))?.interestSatang).toBe(baht(1_500))

    const principal = screen.getByLabelText(t('txForm.principal'))
    await user.clear(principal)
    await user.type(principal, '6900')
    await user.click(screen.getByRole('button', { name: t('detail.save') }))
    await screen.findByText(t('detail.saved'))
    expect(await db.transactions.get('mortgage')).toMatchObject({ type: 'debt_payment', debtId: 'home', principalSatang: baht(6_900), interestSatang: baht(2_000), feeSatang: baht(100) })
  })

  it('shows domain validation in Thai and keeps the old version', async () => {
    const { user } = renderLedger({}, '/transactions?tx=lunch')
    const dialog = await screen.findByRole('dialog', { name: t('detail.title') })
    await user.click(await within(dialog).findByRole('button', { name: t('detail.edit') }))
    const amount = await screen.findByLabelText(t('form.amount'))
    await user.clear(amount)
    await user.type(amount, '0')
    await user.click(screen.getByRole('button', { name: t('detail.save') }))
    expect(await screen.findByText(t('expense.error.amount_must_be_positive'))).toBeInTheDocument()
    expect((await db.transactions.get('lunch'))?.amountSatang).toBe(baht(85))
  })

  it('protects against double submission', async () => {
    let finish: () => void = () => {}
    const update = vi.fn<UpdateTransaction>().mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)))
    const { user } = renderLedger({ detail: { update } }, '/transactions?tx=lunch')
    const dialog = await screen.findByRole('dialog', { name: t('detail.title') })
    await user.click(await within(dialog).findByRole('button', { name: t('detail.edit') }))
    await screen.findByLabelText(t('form.amount'))
    const save = screen.getByRole('button', { name: t('detail.save') })
    await user.click(save)
    await user.click(save)
    expect(update).toHaveBeenCalledOnce()
    expect(save).toBeDisabled()
    finish()
  })

  it('reports a failed save without changing anything', async () => {
    const update = vi.fn<UpdateTransaction>().mockRejectedValue(new Error('AbortError: boom'))
    const { user } = renderLedger({ detail: { update } }, '/transactions?tx=lunch')
    const dialog = await screen.findByRole('dialog', { name: t('detail.title') })
    await user.click(await within(dialog).findByRole('button', { name: t('detail.edit') }))
    await screen.findByLabelText(t('form.amount'))
    await user.click(screen.getByRole('button', { name: t('detail.save') }))
    expect(await screen.findByText(t('expense.error.database'))).toBeInTheDocument()
    expect(screen.queryByText(/AbortError/)).not.toBeInTheDocument()
    expect((await db.transactions.get('lunch'))?.amountSatang).toBe(baht(85))
  })
})

describe('Transactions — delete', () => {
  beforeEach(seed)

  it('asks for confirmation showing description and amount, then deletes and updates everything', async () => {
    const { user, router } = renderLedger({}, '/transactions?tx=lunch')
    const dialog = await screen.findByRole('dialog', { name: t('detail.title') })
    await user.click(await within(dialog).findByRole('button', { name: t('detail.delete') }))

    const confirm = await screen.findByRole('dialog', { name: t('detail.deleteConfirm') })
    expect(within(confirm).getByText('ข้าวกลางวัน')).toBeInTheDocument()
    expect(within(confirm).getByText(`${MINUS_SIGN}฿85`)).toBeInTheDocument()
    await user.click(within(confirm).getByRole('button', { name: t('detail.delete') }))

    // The confirmation hides the sheet from the accessibility tree, so wait on the URL instead.
    await waitFor(() => expect(router.state.location.search).toBe(''))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText(/ลบรายการแล้ว ข้าวกลางวัน/)).toBeInTheDocument()
    expect(await db.transactions.get('lunch')).toBeUndefined()
    expect(await db.attachments.count()).toBe(0)
    await waitFor(() => expect(screen.queryByRole('button', { name: /ข้าวกลางวัน/ })).not.toBeInTheDocument())
    const balances = accountBalances(await db.accounts.toArray(), await db.transactions.toArray())
    expect(balances.get('cash')).toBe(baht(1_000 - 60 + 1_000 - 400))
  })

  it('cancelling keeps the transaction', async () => {
    const { user } = renderLedger({}, '/transactions?tx=lunch')
    const dialog = await screen.findByRole('dialog', { name: t('detail.title') })
    await user.click(await within(dialog).findByRole('button', { name: t('detail.delete') }))
    const confirm = await screen.findByRole('dialog', { name: t('detail.deleteConfirm') })
    await user.click(within(confirm).getByRole('button', { name: t('detail.cancel') }))
    expect(await db.transactions.get('lunch')).toBeDefined()
  })

  it('shows a Thai message when deletion fails and keeps the record', async () => {
    const remove = vi.fn<DeleteTransaction>().mockRejectedValue(new Error('disk'))
    const { user } = renderLedger({ detail: { remove } }, '/transactions?tx=lunch')
    const dialog = await screen.findByRole('dialog', { name: t('detail.title') })
    await user.click(await within(dialog).findByRole('button', { name: t('detail.delete') }))
    const confirm = await screen.findByRole('dialog', { name: t('detail.deleteConfirm') })
    await user.click(within(confirm).getByRole('button', { name: t('detail.delete') }))
    expect(await within(confirm).findByText(t('detail.deleteFailed'))).toBeInTheDocument()
    expect(await db.transactions.get('lunch')).toBeDefined()
  })
})
