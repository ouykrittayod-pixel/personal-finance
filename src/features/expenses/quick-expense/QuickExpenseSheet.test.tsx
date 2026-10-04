// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/feedback/Toast'
import { db } from '@/db/dexie'
import { StorageError } from '@/db/errors'
import { Dashboard } from '@/features/dashboard/Dashboard'
import { t } from '@/lib/i18n'
import { baht, makeAccount, makeCategory, makeTx } from '@/test/factories'
import { QuickExpenseSheet, type QuickExpenseSheetProps } from './QuickExpenseSheet'
import type { SaveExpense } from './save-expense'

const TODAY = '2026-09-25'

function renderSheet(props: Partial<QuickExpenseSheetProps> = {}) {
  const onOpenChange = vi.fn<(open: boolean) => void>()
  const user = userEvent.setup()
  render(
    <ToastProvider>
      <QuickExpenseSheet open onOpenChange={onOpenChange} today={TODAY} {...props} />
    </ToastProvider>,
  )
  return { user, onOpenChange }
}

const amountInput = () => screen.findByLabelText(t('form.amount'))
const saveButton = () => screen.getByRole('button', { name: t('expense.save') })
const openDetails = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: new RegExp(t('expense.details')) }))

async function seedBasics() {
  await db.accounts.bulkAdd([
    makeAccount({ id: 'cash', name: 'เงินสด', kind: 'cash', sortOrder: 0 }),
    makeAccount({ id: 'bank', name: 'KBank', kind: 'bank', sortOrder: 1 }),
  ])
  await db.categories.bulkAdd([
    makeCategory({ id: 'food', name: 'อาหาร', icon: '🍚', sortOrder: 0 }),
    makeCategory({ id: 'drink', name: 'เครื่องดื่ม', icon: '☕', sortOrder: 1 }),
  ])
}

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()))
})

describe('Quick Expense — form', () => {
  beforeEach(seedBasics)

  it('opens with an empty amount, no category, today and the default account; requires amount and category', async () => {
    const { user, onOpenChange } = renderSheet()
    const amount = await amountInput()
    expect(amount).toHaveValue('')
    // Focus lands right after the sheet opens (auto-focus); wait for it rather than racing it.
    await waitFor(() => expect(amount).toHaveFocus())
    expect(screen.getByRole('radio', { name: /อาหาร/ })).not.toBeChecked()
    expect(screen.getByText(/จ่ายจาก เงินสด · 25\/09\/2026/)).toBeInTheDocument()

    await user.click(saveButton())
    expect(await screen.findByText(t('expense.error.amount_required'))).toBeInTheDocument()
    expect(screen.getByText(t('expense.error.category_required'))).toBeInTheDocument()
    expect(await db.transactions.count()).toBe(0)
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('saves a valid expense as integer satang, closes, and confirms with the amount', async () => {
    const { user, onOpenChange } = renderSheet()
    await user.type(await amountInput(), '185.50')
    await user.click(screen.getByRole('radio', { name: /อาหาร/ }))
    await user.click(saveButton())

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    const [tx] = await db.transactions.toArray()
    expect(tx).toMatchObject({ type: 'expense', amountSatang: 18550, categoryId: 'food', accountId: 'cash', date: TODAY })
    expect(Number.isInteger(tx?.amountSatang)).toBe(true)
    expect(tx).not.toHaveProperty('description')
    expect(screen.getByRole('status')).toHaveTextContent('บันทึกรายจ่ายแล้ว ฿185.50')
  })

  it('creates only an expense — no debt payment or recurring obligation', async () => {
    const { user, onOpenChange } = renderSheet()
    await user.type(await amountInput(), '85')
    await user.click(screen.getByRole('radio', { name: /อาหาร/ }))
    await user.click(saveButton())
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect((await db.transactions.toArray()).map((tx) => tx.type)).toEqual(['expense'])
    expect(await db.recurringObligations.count()).toBe(0)
    expect(await db.scheduledPayments.count()).toBe(0)
    expect(await db.debts.count()).toBe(0)
  })

  it('rejects zero', async () => {
    const { user } = renderSheet()
    await user.type(await amountInput(), '0')
    await user.click(screen.getByRole('radio', { name: /อาหาร/ }))
    await user.click(saveButton())
    expect(await screen.findByText(t('expense.error.amount_must_be_positive'))).toBeInTheDocument()
    expect(await db.transactions.count()).toBe(0)
  })

  it('rejects an amount that is not a valid number of satang', async () => {
    const { user } = renderSheet()
    const amount = await amountInput()
    await user.type(amount, 'abc')
    expect(amount).toHaveValue('') // non-digits never enter the field
    await user.type(amount, '99999999999999999')
    await user.click(screen.getByRole('radio', { name: /อาหาร/ }))
    await user.click(saveButton())
    expect(await screen.findAllByText(/ทศนิยมไม่เกิน 2 ตำแหน่ง/)).not.toHaveLength(0)
    expect(await db.transactions.count()).toBe(0)
  })

  it('requires a category', async () => {
    const { user } = renderSheet()
    await user.type(await amountInput(), '60')
    await user.click(saveButton())
    expect(await screen.findByText(t('expense.error.category_required'))).toBeInTheDocument()
    expect(screen.queryByText(t('expense.error.amount_required'))).not.toBeInTheDocument()
    expect(await db.transactions.count()).toBe(0)
  })

  it('stores an optional description, account choice, date and note from the details section', async () => {
    const { user, onOpenChange } = renderSheet()
    await user.type(await amountInput(), '45')
    await user.click(screen.getByRole('radio', { name: /อาหาร/ }))
    await openDetails(user)
    await user.type(screen.getByLabelText(new RegExp(t('expense.description'))), '  ข้าวมันไก่  ')
    await user.click(screen.getByRole('radio', { name: /KBank/ }))
    await user.click(screen.getByRole('button', { name: t('form.yesterday') }))
    await user.type(screen.getByLabelText(new RegExp(t('expense.note'))), 'กับเพื่อน')
    await user.click(saveButton())

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect((await db.transactions.toArray())[0]).toMatchObject({
      description: 'ข้าวมันไก่',
      accountId: 'bank',
      date: '2026-09-24',
      note: 'กับเพื่อน',
    })
  })

  it('preselects the account of the most recent expense', async () => {
    await db.transactions.add(makeTx({ type: 'expense', amountSatang: baht(10), accountId: 'bank', categoryId: 'food', date: '2026-09-20' }))
    renderSheet()
    expect(await screen.findByText(/จ่ายจาก KBank/)).toBeInTheDocument()
  })

  it('shows a Thai message on database failure, keeps the form open and never shows raw errors', async () => {
    const save = vi.fn<SaveExpense>().mockRejectedValue(new StorageError('database', new Error('AbortError: Transaction aborted at line 42')))
    const { user, onOpenChange } = renderSheet({ save })
    await user.type(await amountInput(), '85')
    await user.click(screen.getByRole('radio', { name: /อาหาร/ }))
    await user.click(saveButton())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(t('expense.error.database'))
    expect(screen.queryByText(/AbortError|line 42/)).not.toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(saveButton()).toBeEnabled()
    expect(await amountInput()).toHaveValue('85')
  })

  it('explains attachment failures', async () => {
    const save = vi.fn<SaveExpense>().mockRejectedValue(new StorageError('attachment', new Error('x')))
    const { user } = renderSheet({ save })
    await user.type(await amountInput(), '85')
    await user.click(screen.getByRole('radio', { name: /อาหาร/ }))
    await user.click(saveButton())
    expect(await screen.findByRole('alert')).toHaveTextContent(t('expense.error.attachment'))
  })

  it('protects against double submission', async () => {
    let finish: () => void = () => {}
    const save = vi.fn<SaveExpense>().mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)))
    const { user } = renderSheet({ save })
    await user.type(await amountInput(), '85')
    await user.click(screen.getByRole('radio', { name: /อาหาร/ }))
    const button = saveButton()
    await user.click(button)
    await user.click(button)
    await user.keyboard('{Enter}')
    expect(save).toHaveBeenCalledOnce()
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    finish()
  })

  it('never creates two records even if the same session saves twice (idempotent id)', async () => {
    const { user } = renderSheet()
    await user.type(await amountInput(), '85')
    await user.click(screen.getByRole('radio', { name: /อาหาร/ }))
    await Promise.all([user.click(saveButton()), user.click(saveButton())])
    await waitFor(async () => expect(await db.transactions.count()).toBe(1))
  })

  it('stores attachment metadata linked to the expense', async () => {
    const { user, onOpenChange } = renderSheet()
    await user.type(await amountInput(), '120')
    await user.click(screen.getByRole('radio', { name: /อาหาร/ }))
    await openDetails(user)
    const receipt = new File([new Uint8Array(3000)], 'ใบเสร็จ.png', { type: 'image/png' })
    await user.upload(screen.getByTestId('attachment-gallery'), receipt)
    expect(await screen.findByText('ใบเสร็จ.png')).toBeInTheDocument()
    await user.click(saveButton())

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    const [tx] = await db.transactions.toArray()
    const [row] = await db.attachments.toArray()
    expect(row).toMatchObject({ transactionId: tx?.id, fileName: 'ใบเสร็จ.png', mimeType: 'image/png', sizeBytes: 3000 })
    expect(await db.attachmentBlobs.count()).toBe(1)
  })

  it('rejects unsupported attachment types with a Thai message', async () => {
    const { user } = renderSheet()
    await amountInput()
    await openDetails(user)
    const bad = new File(['x'], 'virus.exe', { type: 'application/x-msdownload' })
    // Bypass the picker's accept filter, as a browser that ignores it would.
    fireEvent.change(screen.getByTestId('attachment-file'), { target: { files: [bad] } })
    expect(await screen.findByText(t('attachment.error.type', { name: 'virus.exe' }))).toBeInTheDocument()
  })
})

describe('Quick Expense — frequent items', () => {
  beforeEach(seedBasics)

  it('hides the section without enough history', async () => {
    await db.transactions.add(makeTx({ type: 'expense', amountSatang: baht(60), accountId: 'cash', categoryId: 'drink', description: 'กาแฟ', date: '2026-09-20' }))
    renderSheet()
    await amountInput()
    expect(screen.queryByText(t('expense.frequent'))).not.toBeInTheDocument()
  })

  it('prefills from a frequent item without saving', async () => {
    await db.transactions.bulkAdd([
      makeTx({ type: 'expense', amountSatang: baht(60), accountId: 'bank', categoryId: 'drink', description: 'กาแฟ', date: '2026-09-20' }),
      makeTx({ type: 'expense', amountSatang: baht(60), accountId: 'bank', categoryId: 'drink', description: 'กาแฟ', date: '2026-09-22' }),
    ])
    const { user, onOpenChange } = renderSheet()
    await amountInput()
    const section = screen.getByRole('region', { name: t('expense.frequent') })
    await user.click(within(section).getByRole('button', { name: /กาแฟ/ }))

    expect(await amountInput()).toHaveValue('60')
    expect(screen.getByRole('radio', { name: /เครื่องดื่ม/ })).toBeChecked()
    expect(await db.transactions.count()).toBe(2) // nothing saved yet
    expect(onOpenChange).not.toHaveBeenCalled()

    await user.click(saveButton())
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    const saved = (await db.transactions.toArray()).find((tx) => tx.date === TODAY)
    expect(saved).toMatchObject({ description: 'กาแฟ', amountSatang: 6000, categoryId: 'drink', accountId: 'bank' })
  })
})

describe('Quick Expense — setup', () => {
  it('asks to create categories and an account instead of inventing them', async () => {
    const user = userEvent.setup()
    render(
      <ToastProvider>
        <QuickExpenseSheet open onOpenChange={() => {}} today={TODAY} />
      </ToastProvider>,
    )
    expect(await screen.findByText(t('setup.title'))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('expense.save') })).not.toBeInTheDocument()
    expect(await db.categories.count()).toBe(0)

    await user.click(screen.getByRole('button', { name: t('setup.categories.create') }))
    await waitFor(async () => expect(await db.categories.count()).toBe(9))

    await user.type(screen.getByLabelText(t('setup.account.balance')), '1500')
    await user.click(screen.getByRole('button', { name: t('setup.account.create') }))
    expect(await amountInput()).toBeInTheDocument()
    expect((await db.accounts.toArray()).map((a) => [a.name, a.kind, a.openingBalanceSatang])).toEqual([['เงินสด', 'cash', 150000]])
    expect(await db.transactions.count()).toBe(0)
  })
})

describe('Quick Expense — live update', () => {
  beforeEach(seedBasics)

  it('shows the new expense on the Dashboard immediately after saving', async () => {
    const user = userEvent.setup()
    const router = createMemoryRouter([{ path: '/', element: <Dashboard today={TODAY} /> }])
    render(
      <ToastProvider>
        <RouterProvider router={router} />
        <QuickExpenseSheet open onOpenChange={() => {}} today={TODAY} />
      </ToastProvider>,
    )
    expect(await screen.findByText(t('dashboard.recent.empty'))).toBeInTheDocument()

    await user.type(await amountInput(), '85')
    await user.click(screen.getByRole('radio', { name: /อาหาร/ }))
    await openDetails(user)
    await user.type(screen.getByLabelText(new RegExp(t('expense.description'))), 'ข้าวกลางวัน')
    await user.click(saveButton())

    const recent = await screen.findByRole('list', { name: t('dashboard.recent.title') })
    expect(within(recent).getByText('ข้าวกลางวัน')).toBeInTheDocument()
  })
})
