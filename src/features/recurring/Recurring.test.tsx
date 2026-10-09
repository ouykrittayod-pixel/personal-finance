// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/feedback/Toast'
import { db } from '@/db/dexie'
import { recurringObligationsRepository, scheduledPaymentsRepository } from '@/db/repositories'
import { accountBalances } from '@/domain/reporting'
import type { ObligationDraft } from '@/domain/scheduling'
import { Dashboard } from '@/features/dashboard/Dashboard'
import { t } from '@/lib/i18n'
import { baht, makeAccount, makeCategory } from '@/test/factories'
import { Recurring } from './RecurringPage'
import type { RecurringOps } from './recurring-ops'

const TODAY = '2026-09-25'
let counter = 0
const newId = () => `gen-${++counter}`
const stamp = { now: `${TODAY}T03:00:00.000Z`, today: TODAY, newId }

/** The real repositories with a fixed "today", so dates are deterministic. */
function testOps(overrides: Partial<RecurringOps> = {}): RecurringOps {
  return {
    generate: () => scheduledPaymentsRepository.generateMissing(TODAY, stamp),
    create: (draft, id) => recurringObligationsRepository.create(draft, { ...stamp, id }),
    update: (id, draft) => recurringObligationsRepository.update(id, draft, stamp),
    pause: (id) => recurringObligationsRepository.pause(id, stamp),
    resume: (id) => recurringObligationsRepository.resume(id, stamp),
    archive: (id) => recurringObligationsRepository.archive(id, stamp),
    markPaid: (paymentId, draft, attachments, transactionId) => scheduledPaymentsRepository.markPaid(paymentId, draft, attachments, { transactionId, now: stamp.now, newId }),
    skip: (paymentId) => scheduledPaymentsRepository.markSkipped(paymentId, stamp),
    unskip: (paymentId) => scheduledPaymentsRepository.markUnskipped(paymentId, stamp),
    setAmount: (ref, amountSatang) => scheduledPaymentsRepository.setExpectedAmount(ref, amountSatang, stamp),
    ...overrides,
  }
}

function renderRecurring(ops = testOps(), path = '/recurring') {
  const router = createMemoryRouter(
    [
      { path: '/recurring', element: <Recurring today={TODAY} ops={ops} /> },
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

const draft = (overrides: Partial<ObligationDraft> = {}): ObligationDraft => ({
  name: 'ค่าเช่า',
  amountSatang: baht(7_800),
  categoryId: 'home',
  defaultAccountId: 'bank',
  recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-01-01', dayOfMonth: 6 },
  ...overrides,
})

async function seedBasics() {
  await db.accounts.bulkAdd([
    makeAccount({ id: 'bank', name: 'KBank', kind: 'bank', openingBalanceSatang: baht(50_000), sortOrder: 0 }),
    makeAccount({ id: 'cash', name: 'เงินสด', kind: 'cash', openingBalanceSatang: baht(1_000), sortOrder: 1 }),
  ])
  await db.categories.bulkAdd([
    makeCategory({ id: 'home', name: 'บ้าน', icon: '🏠', sortOrder: 0 }),
    makeCategory({ id: 'net', name: 'อินเทอร์เน็ต', icon: '🌐', sortOrder: 1 }),
  ])
}

const seedRent = () => recurringObligationsRepository.create(draft(), { ...stamp, id: 'rent' })
const list = () => screen.findByRole('list', { name: t('recurring.list') })
const openDetail = async (user: ReturnType<typeof userEvent.setup>, name: RegExp) => {
  await user.click(within(await list()).getByRole('button', { name }))
  const dialog = await screen.findByRole('dialog', { name: t('recurring.detail.title') })
  // Wait until the detail has loaded (not just the sheet).
  await within(dialog).findByRole('list', { name: t('recurring.detail.schedule') })
  return dialog
}

beforeEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(db.tables.map((table) => table.clear()))
})

describe('Recurring — empty and setup', () => {
  it('asks for categories and an account before anything else', async () => {
    renderRecurring()
    expect(await screen.findByText(t('setup.title'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('recurring.add') })).toBeDisabled()
  })

  it('shows an empty state with a create action once set up', async () => {
    await seedBasics()
    renderRecurring()
    expect(await screen.findByText(t('recurring.empty'))).toBeInTheDocument()
    expect(await db.scheduledPayments.count()).toBe(0)
  })
})

describe('Recurring — create', () => {
  beforeEach(seedBasics)

  it('validates through the domain and shows Thai messages', async () => {
    const { user } = renderRecurring()
    await screen.findByText(t('recurring.empty'))
    await user.click(screen.getAllByRole('button', { name: t('recurring.add') })[0]!)
    await user.click(await screen.findByRole('button', { name: t('recurring.form.save') }))
    expect(await screen.findByText(t('recurring.error.name_required'))).toBeInTheDocument()
    expect(screen.getByText(t('expense.error.amount_required'))).toBeInTheDocument()
    expect(screen.getByText(t('expense.error.category_required'))).toBeInTheDocument()
    expect(await db.recurringObligations.count()).toBe(0)
  })

  it('creates a monthly bill and its scheduled payments — no transaction', async () => {
    const { user } = renderRecurring()
    await screen.findByText(t('recurring.empty'))
    await user.click(screen.getAllByRole('button', { name: t('recurring.add') })[0]!)
    await user.type(await screen.findByLabelText(t('recurring.form.name')), 'Internet')
    await user.type(screen.getByLabelText(t('form.amount')), '899')
    await user.click(screen.getByRole('radio', { name: /อินเทอร์เน็ต/ }))
    await user.selectOptions(screen.getByLabelText(t('recurring.form.day')), '15')
    // Start date defaults to today (25 Sep), so the first due date is next month's 15th.
    expect(screen.getByText(/ครบกำหนดครั้งแรก: 15\/10\/2026/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t('recurring.form.save') }))

    const row = await within(await list()).findByRole('button', { name: /Internet/ })
    expect(within(row).getByText('฿899')).toBeInTheDocument()
    expect(within(row).getByText('/ เดือน')).toBeInTheDocument()
    const [rule] = await db.recurringObligations.toArray()
    expect(rule).toMatchObject({ name: 'Internet', expectedAmountSatang: baht(899), categoryId: 'net', defaultAccountId: 'bank', recurrence: { frequency: 'monthly', dayOfMonth: 15 } })
    expect((await db.scheduledPayments.toArray()).map((p) => p.dueDate).sort()).toEqual(['2026-10-15', '2026-11-15', '2026-12-15'])
    expect(await db.transactions.count()).toBe(0)
  })

  it('double-tapping save creates one rule', async () => {
    const { user } = renderRecurring()
    await screen.findByText(t('recurring.empty'))
    await user.click(screen.getAllByRole('button', { name: t('recurring.add') })[0]!)
    await user.type(await screen.findByLabelText(t('recurring.form.name')), 'Internet')
    await user.type(screen.getByLabelText(t('form.amount')), '899')
    await user.click(screen.getByRole('radio', { name: /อินเทอร์เน็ต/ }))
    const save = screen.getByRole('button', { name: t('recurring.form.save') })
    await Promise.all([user.click(save), user.click(save)])
    await waitFor(async () => expect(await db.recurringObligations.count()).toBe(1))
    // New bills are due on the month's last day: 30 Sep, 31 Oct, 30 Nov (the window ends 25 Dec).
    expect((await db.scheduledPayments.toArray()).map((p) => p.dueDate).sort()).toEqual(['2026-09-30', '2026-10-31', '2026-11-30'])
  })
})

describe('Recurring — list, filters, detail', () => {
  beforeEach(async () => {
    await seedBasics()
    await seedRent() // Sep 6 overdue
    await recurringObligationsRepository.create(draft({ name: 'Internet', categoryId: 'net', amountSatang: baht(899), recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-01-01', dayOfMonth: 28 } }), { ...stamp, id: 'net' })
    await recurringObligationsRepository.create(draft({ name: 'ประกัน', amountSatang: baht(12_000), recurrence: { frequency: 'yearly', interval: 1, startDate: '2026-01-01', monthOfYear: 11, dayOfMonth: 1 } }), { ...stamp, id: 'ins' })
  })

  it('shows next due dates with overdue first and a derived overdue label', async () => {
    renderRecurring()
    const rows = within(await list()).getAllByRole('button')
    expect(rows.map((r) => r.textContent?.match(/ค่าเช่า|Internet|ประกัน/)?.[0])).toEqual(['ค่าเช่า', 'Internet', 'ประกัน'])
    expect(within(rows[0]!).getByText('ค้างชำระ 19 วัน')).toBeInTheDocument()
    expect(within(rows[1]!).getByText(/ครบกำหนด 28\/09\/2026/)).toBeInTheDocument()
    expect(within(rows[2]!).getByText(/ครบกำหนด 01\/11\/2026/)).toBeInTheDocument()
    expect(within(rows[2]!).getByText('/ ปี')).toBeInTheDocument()
  })

  it('summarises this month as obligations, not spending', async () => {
    renderRecurring()
    const summary = within(await screen.findByRole('region', { name: t('recurring.summary') }))
    // 7,800 + 899 due in September, all still unpaid: shown as due and as outstanding.
    expect(summary.getAllByText('฿8,699')).toHaveLength(2)
    expect(summary.getByText(t('recurring.summary.activeCount', { count: 3 }))).toBeInTheDocument()
  })

  it('filters and searches', async () => {
    const { user } = renderRecurring()
    await list()
    await user.click(screen.getByRole('radio', { name: t('recurring.filter.overdue') }))
    await waitFor(() => expect(within(screen.getByRole('list', { name: t('recurring.list') })).getAllByRole('button')).toHaveLength(1))
    await user.click(screen.getByRole('radio', { name: t('recurring.filter.all') }))
    await user.type(screen.getByLabelText(t('recurring.searchLabel')), 'ประกัน')
    await waitFor(() => expect(within(screen.getByRole('list', { name: t('recurring.list') })).getAllByRole('button')).toHaveLength(1))
  })

  it('opens a full-screen detail (phone) with rule details and schedule', async () => {
    const { user, router } = renderRecurring()
    const dialog = await openDetail(user, /ค่าเช่า/)
    expect(router.state.location.search).toBe('?id=rent')
    expect(dialog.className).toContain('h-dvh') // full-screen on phones
    expect(within(dialog).getByText('ทุกเดือน วันที่ 6')).toBeInTheDocument()
    const schedule = within(dialog).getByRole('list', { name: t('recurring.detail.schedule') })
    expect(within(schedule).getAllByRole('listitem')).toHaveLength(4)
    expect(within(schedule).getByText('ค้างชำระ 19 วัน')).toBeInTheDocument()
  })
})

describe('Recurring — pay', () => {
  beforeEach(async () => {
    await seedBasics()
    await seedRent()
  })

  async function openPay(user: ReturnType<typeof userEvent.setup>) {
    const dialog = await openDetail(user, /ค่าเช่า/)
    await user.click(within(dialog).getByRole('button', { name: /ชำระแล้ว: 06\/09\/2026/ }))
    return screen.findByRole('dialog', { name: t('recurring.pay.title', { name: 'ค่าเช่า' }) })
  }

  it('records the real payment: actual date and amount, one linked expense, balance updated', async () => {
    const { user } = renderRecurring()
    const pay = await openPay(user)
    expect(within(pay).getByText('06/09/2026')).toBeInTheDocument()
    expect(within(pay).getByText('฿7,800')).toBeInTheDocument()

    const amount = within(pay).getByLabelText(t('form.amount'))
    expect(amount).toHaveValue('7800') // focused: grouping removed for editing
    await user.clear(amount)
    await user.type(amount, '7932')
    await user.click(within(pay).getByRole('button', { name: t('form.yesterday') }))
    await user.click(screen.getByRole('button', { name: t('recurring.pay.confirm') }))

    await waitFor(async () => expect(await db.transactions.count()).toBe(1))
    const [tx] = await db.transactions.toArray()
    expect(tx).toMatchObject({ type: 'expense', amountSatang: baht(7_932), date: '2026-09-24', categoryId: 'home', accountId: 'bank', description: 'ค่าเช่า' })
    const sep = (await db.scheduledPayments.toArray()).find((p) => p.dueDate === '2026-09-06')
    expect(sep).toMatchObject({ status: 'paid', transactionId: tx!.id, paidDate: '2026-09-24', expectedAmountSatang: baht(7_800) })
    expect(accountBalances(await db.accounts.toArray(), await db.transactions.toArray()).get('bank')).toBe(baht(50_000 - 7_932))
    expect(await screen.findByText(/บันทึกการชำระค่าเช่า ฿7,932 แล้ว/)).toBeInTheDocument()
  })

  it('double-clicking confirm creates one transaction', async () => {
    const { user } = renderRecurring()
    await openPay(user)
    const confirm = screen.getByRole('button', { name: t('recurring.pay.confirm') })
    await Promise.all([user.click(confirm), user.click(confirm), user.click(confirm)])
    await waitFor(async () => expect((await db.scheduledPayments.toArray()).some((p) => p.status === 'paid')).toBe(true))
    expect(await db.transactions.count()).toBe(1)
  })

  it('a failed payment changes nothing and explains in Thai', async () => {
    const markPaid = vi.fn<RecurringOps['markPaid']>().mockRejectedValue(new Error('AbortError: boom'))
    const { user } = renderRecurring(testOps({ markPaid }))
    await openPay(user)
    await user.click(screen.getByRole('button', { name: t('recurring.pay.confirm') }))
    expect(await screen.findByText(t('expense.error.database'))).toBeInTheDocument()
    expect(screen.queryByText(/AbortError/)).not.toBeInTheDocument()
    expect(await db.transactions.count()).toBe(0)
    expect((await db.scheduledPayments.toArray()).every((p) => p.status === 'pending')).toBe(true)
  })

  it('skip marks the occurrence skipped without a transaction', async () => {
    const { user } = renderRecurring()
    const dialog = await openDetail(user, /ค่าเช่า/)
    await user.click(within(dialog).getByRole('button', { name: /ข้ามรายการ 06\/09\/2026/ }))
    await waitFor(async () => expect((await db.scheduledPayments.toArray()).find((p) => p.dueDate === '2026-09-06')?.status).toBe('skipped'))
    expect(await db.transactions.count()).toBe(0)
    expect(await within(dialog).findByRole('button', { name: /ยกเลิกการข้าม 06\/09\/2026/ })).toBeInTheDocument()
  })
})

describe('Recurring — pause, resume, delete', () => {
  beforeEach(async () => {
    await seedBasics()
    await seedRent()
  })

  it('pause removes future unpaid occurrences, keeps the overdue one; resume brings them back', async () => {
    const { user } = renderRecurring()
    const dialog = await openDetail(user, /ค่าเช่า/)
    await user.click(screen.getByRole('button', { name: t('recurring.action.pause') }))
    await waitFor(async () => expect(await db.scheduledPayments.count()).toBe(1))
    expect((await db.recurringObligations.get('rent'))?.pausedAt).toBeDefined()
    expect(await within(dialog).findAllByText(t('status.paused'))).not.toHaveLength(0)

    await user.click(screen.getByRole('button', { name: t('recurring.action.resume') }))
    await waitFor(async () => expect(await db.scheduledPayments.count()).toBe(4))
    const dates = (await db.scheduledPayments.toArray()).map((p) => p.dueDate).sort()
    expect(dates).toEqual(['2026-09-06', '2026-10-06', '2026-11-06', '2026-12-06'])
  })

  it('delete asks first, explains history is kept, and keeps paid transactions', async () => {
    const [sep] = (await db.scheduledPayments.toArray()).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    await scheduledPaymentsRepository.markPaid(sep!.id, { type: 'expense', amountSatang: baht(7_800), accountId: 'bank', categoryId: 'home', date: TODAY, description: 'ค่าเช่า' }, [], { transactionId: 'paid-tx', now: stamp.now, newId })

    const { user } = renderRecurring()
    await openDetail(user, /ค่าเช่า/)
    await user.click(screen.getByRole('button', { name: t('recurring.action.delete') }))
    const confirm = await screen.findByRole('dialog', { name: t('recurring.delete.title') })
    expect(within(confirm).getByText(t('recurring.delete.hint'))).toBeInTheDocument()
    expect(within(confirm).getByText(t('recurring.delete.unpaid', { count: 3 }))).toBeInTheDocument()
    await user.click(within(confirm).getByRole('button', { name: t('recurring.action.delete') }))

    expect(await screen.findByText(t('recurring.empty'))).toBeInTheDocument()
    expect(await db.transactions.get('paid-tx')).toBeDefined()
    expect((await db.scheduledPayments.toArray()).map((p) => p.status)).toEqual(['paid'])
  })
})

describe('Dashboard integration', () => {
  beforeEach(async () => {
    await seedBasics()
    await seedRent() // Sep 6 overdue, Oct 6 upcoming
    await recurringObligationsRepository.create(draft({ name: 'Internet', categoryId: 'net', amountSatang: baht(899), recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-01-01', dayOfMonth: 28 } }), { ...stamp, id: 'net' })
  })

  function renderDashboard() {
    const router = createMemoryRouter([{ path: '/', element: <Dashboard today={TODAY} /> }])
    render(
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>,
    )
  }

  it('lists overdue first, then upcoming, linked to the rule; paid and skipped disappear', async () => {
    renderDashboard()
    const upcoming = await screen.findByRole('list', { name: t('dashboard.upcomingList.title') })
    const items = within(upcoming).getAllByRole('link')
    // Window: end of the selected month or 7 days ahead (2 Oct), so rent's 6 Oct is not listed yet.
    expect(items.map((a) => a.textContent?.match(/ค่าเช่า|Internet/)?.[0])).toEqual(['ค่าเช่า', 'Internet'])
    expect(within(items[0]!).getByText('ค้างชำระ 19 วัน')).toBeInTheDocument()
    expect(items[0]).toHaveAttribute('href', '/recurring?id=rent')

    const payments = (await db.scheduledPayments.toArray()).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    await scheduledPaymentsRepository.markPaid(payments[0]!.id, { type: 'expense', amountSatang: baht(7_800), accountId: 'bank', categoryId: 'home', date: TODAY }, [], { transactionId: 'p1', now: stamp.now, newId })
    await scheduledPaymentsRepository.markSkipped(payments.find((p) => p.dueDate === '2026-09-28')!.id, stamp)
    expect(await screen.findByText(t('dashboard.upcomingList.empty'))).toBeInTheDocument()
  })
})
