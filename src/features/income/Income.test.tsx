// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { QuickEntryProvider } from '@/app/providers/QuickEntryProvider'
import { ToastProvider } from '@/components/feedback/Toast'
import { db } from '@/db/dexie'
import { recurringObligationsRepository, scheduledPaymentsRepository } from '@/db/repositories'
import { accountBalances } from '@/domain/reporting'
import type { RecurringOps } from '@/features/recurring/recurring-ops'
import { t } from '@/lib/i18n'
import { baht, makeAccount, makeCategory, makeTx } from '@/test/factories'
import { Income } from './IncomePage'

const TODAY = '2026-09-26'
let counter = 0
const newId = () => `gen-${++counter}`
const stamp = { now: `${TODAY}T03:00:00.000Z`, today: TODAY, newId }

function testOps(): RecurringOps {
  return {
    generate: () => scheduledPaymentsRepository.generateMissing(TODAY, stamp),
    create: (draft, id) => recurringObligationsRepository.create(draft, { ...stamp, id }),
    update: (id, draft) => recurringObligationsRepository.update(id, draft, stamp),
    pause: (id) => recurringObligationsRepository.pause(id, stamp),
    resume: (id) => recurringObligationsRepository.resume(id, stamp),
    archive: (id) => recurringObligationsRepository.archive(id, stamp),
    markPaid: (paymentId, draft, attachments, transactionId) =>
      scheduledPaymentsRepository.markPaid(paymentId, draft, attachments, { transactionId, now: stamp.now, newId }),
    skip: (paymentId) => scheduledPaymentsRepository.markSkipped(paymentId, stamp),
    unskip: (paymentId) => scheduledPaymentsRepository.markUnskipped(paymentId, stamp),
  }
}

function renderIncome(path = '/income') {
  const router = createMemoryRouter([{ path: '/income', element: <Income today={TODAY} ops={testOps()} /> }], { initialEntries: [path] })
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

const balance = async (id: string) => accountBalances(await db.accounts.toArray(), await db.transactions.toArray()).get(id)
const list = () => screen.findByRole('region', { name: t('income.list') })

async function seedAccounts() {
  await db.accounts.bulkAdd([
    makeAccount({ id: 'kbank', name: 'KBank', kind: 'bank', openingBalanceSatang: baht(1_000), sortOrder: 0 }),
    makeAccount({ id: 'cash', name: 'เงินสด', kind: 'cash', openingBalanceSatang: baht(0), sortOrder: 1 }),
  ])
}
async function seedIncome() {
  await seedAccounts()
  await db.categories.bulkAdd([
    makeCategory({ id: 'salary', name: 'เงินเดือน', kind: 'income', icon: '💼', sortOrder: 0 }),
    makeCategory({ id: 'side', name: 'รายได้เสริม', kind: 'income', icon: '🧩', sortOrder: 1 }),
  ])
  await db.transactions.bulkAdd([
    makeTx({
      id: 'sal',
      type: 'income',
      amountSatang: baht(27_500),
      accountId: 'kbank',
      categoryId: 'salary',
      date: '2026-09-25',
      description: 'เงินเดือน กันยายน',
      createdAt: '2026-09-25T03:00:00Z',
    }),
    makeTx({ id: 'move', type: 'transfer', amountSatang: baht(5_000), accountId: 'kbank', toAccountId: 'cash', date: '2026-09-26', description: 'ถอนเงินสด' }),
  ])
}

beforeEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(db.tables.map((table) => table.clear()))
})

describe('Income — empty and first income', () => {
  beforeEach(seedAccounts)

  it('shows the header, a useful empty state and an explicit category setup before the shared form', async () => {
    // The form's date defaults to the real clock; pin it to the page's TODAY so the new income lands in "this month".
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(`${TODAY}T03:00:00.000Z`) })
    onTestFinished(() => {
      vi.useRealTimers()
    })
    const { user } = renderIncome()
    expect(await screen.findByRole('heading', { level: 1, name: 'รายรับ' })).toBeInTheDocument()
    expect(screen.getByText('ดูและจัดการรายรับทั้งหมด')).toBeInTheDocument()
    expect(await screen.findByText(t('income.empty'))).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: t('income.add') })[0]!)
    const sheet = await screen.findByRole('dialog', { name: t('income.sheetTitle') }, { timeout: 5000 })
    // No income categories yet: nothing is created until the user asks.
    expect(await within(sheet).findByText(t('setup.incomeCategories.title'))).toBeInTheDocument()
    expect(await db.categories.count()).toBe(0)
    await user.click(within(sheet).getByRole('button', { name: t('setup.categories.create') }))

    await user.type(await within(sheet).findByLabelText(t('form.amount')), '27500')
    await user.click(within(sheet).getByRole('radio', { name: /เงินเดือน/ }))
    await user.click(within(sheet).getByRole('button', { name: new RegExp(t('expense.details')) }))
    await user.type(within(sheet).getByLabelText(new RegExp(t('expense.description'))), 'เงินเดือน กันยายน')
    await user.dblClick(screen.getByRole('button', { name: t('income.save') }))
    await screen.findByText(t('income.saved', { amount: '฿27,500' }))

    const stored = await db.transactions.toArray()
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ type: 'income', amountSatang: baht(27_500), accountId: 'kbank', description: 'เงินเดือน กันยายน' })
    expect(await balance('kbank')).toBe(baht(28_500))
    const row = await within(await list()).findByRole('button', { name: /เงินเดือน กันยายน/ })
    expect(row).toHaveAccessibleName(expect.stringContaining('รายรับ'))
    expect(within(row).getByText('+฿27,500')).toBeInTheDocument()
  })
})

describe('Income — list, detail, edit, delete', () => {
  beforeEach(seedIncome)

  it('lists income only (the transfer is not income) with summary, filters and search', async () => {
    const { user } = renderIncome()
    const region = await list()
    expect(await within(region).findByRole('button', { name: /เงินเดือน กันยายน/ })).toBeInTheDocument()
    expect(within(region).queryByText('ถอนเงินสด')).not.toBeInTheDocument()
    const summary = screen.getByRole('region', { name: t('income.summary') })
    expect(within(summary).getByText(t('income.summary.totalMonth'))).toBeInTheDocument()
    expect(within(summary).getByText(t('income.summary.countValue', { count: 1 }))).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText(t('income.filter.category')), 'side')
    expect(await within(region).findByText(t('income.noMatch'))).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText(t('income.filter.category')), 'all')
    await user.type(screen.getByLabelText(t('income.searchLabel')), 'kbank')
    expect(await within(region).findByRole('button', { name: /เงินเดือน กันยายน/ })).toBeInTheDocument()
  })

  it('opens the shared detail (id in the URL), edits in place and deletes', async () => {
    const { user, router } = renderIncome()
    await user.click(await within(await list()).findByRole('button', { name: /เงินเดือน กันยายน/ }))
    const dialog = await screen.findByRole('dialog', { name: t('detail.title') })
    expect(router.state.location.search).toBe('?tx=sal')
    expect(await within(dialog).findByText('💼 เงินเดือน')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: t('detail.edit') }))
    const amount = await screen.findByLabelText(t('form.amount'))
    await user.clear(amount)
    await user.type(amount, '30000')
    await user.click(screen.getByRole('button', { name: t('detail.save') }))
    await screen.findByText(t('detail.saved'))
    expect(await db.transactions.where('type').equals('income').count()).toBe(1)
    expect(await db.transactions.get('sal')).toMatchObject({ amountSatang: baht(30_000), createdAt: '2026-09-25T03:00:00Z' })
    expect(await balance('kbank')).toBe(baht(1_000 + 30_000 - 5_000))

    const detail = await screen.findByRole('dialog', { name: t('detail.title') })
    await user.click(within(detail).getByRole('button', { name: t('detail.delete') }))
    const confirm = await screen.findByRole('dialog', { name: t('detail.deleteConfirm') })
    await user.click(within(confirm).getByRole('button', { name: t('detail.delete') }))
    await waitFor(async () => expect(await db.transactions.get('sal')).toBeUndefined())
    expect(await balance('kbank')).toBe(baht(1_000 - 5_000))
    expect(await screen.findByText(t('income.empty'))).toBeInTheDocument()
  })
})

describe('Income — recurring', () => {
  beforeEach(seedIncome)

  it('creates a recurring income rule and receives it once, with the actual amount', async () => {
    const { user } = renderIncome()
    await screen.findByText(t('income.recurring.empty'))
    await user.click(screen.getByRole('button', { name: t('income.recurring.add') }))
    const form = await screen.findByRole('dialog', { name: t('income.form.createTitle') })
    await user.type(within(form).getByLabelText(t('recurring.form.name')), 'เงินเดือน')
    await user.type(within(form).getByLabelText(t('form.amount')), '27500')
    await user.click(within(form).getByRole('radio', { name: /เงินเดือน/ }))
    await user.selectOptions(within(form).getByLabelText(t('recurring.form.day')), '25')
    await user.click(within(form).getByRole('button', { name: t('recurring.form.save') }))
    await screen.findByText(t('recurring.toast.created', { name: 'เงินเดือน' }))

    const [rule] = await db.recurringObligations.toArray()
    expect(rule).toMatchObject({ kind: 'income', categoryId: 'salary', defaultAccountId: 'kbank' })
    // The rule starts today (26 Sep), so the first expected salary is 25 Oct; horizon = 3 months.
    expect((await db.scheduledPayments.toArray()).map((p) => p.dueDate).sort()).toEqual(['2026-10-25', '2026-11-25', '2026-12-25'])
    expect(await db.transactions.where('type').equals('income').count()).toBe(1) // generation creates no income

    const rules = await screen.findByRole('list', { name: t('income.recurring.list') })
    await user.click(within(rules).getByRole('button', { name: t('income.recurring.receiveFor', { date: '25 ต.ค. 2026' }) }))
    const receive = await screen.findByRole('dialog', { name: t('income.receive.title', { name: 'เงินเดือน' }) })
    expect(within(receive).getByText(t('income.receive.expected'))).toBeInTheDocument()
    const amount = within(receive).getByLabelText(t('form.amount'))
    await user.clear(amount)
    await user.type(amount, '28200')
    await user.dblClick(within(receive).getByRole('button', { name: t('income.receive.confirm') }))
    await screen.findByText(t('income.receive.done', { name: 'เงินเดือน', amount: '฿28,200' }))

    const received = (await db.transactions.toArray()).filter((tx) => tx.scheduledPaymentId)
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ type: 'income', amountSatang: baht(28_200), categoryId: 'salary', accountId: 'kbank' })
    expect((await db.recurringObligations.get(rule!.id))?.expectedAmountSatang).toBe(baht(27_500))
    expect((await db.scheduledPayments.get(received[0]!.scheduledPaymentId!))?.status).toBe('paid')
  })
})
