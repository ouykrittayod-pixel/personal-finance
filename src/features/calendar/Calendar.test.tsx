// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/feedback/Toast'
import { db } from '@/db/dexie'
import { debtsRepository, recurringObligationsRepository, scheduledPaymentsRepository, transactionsRepository } from '@/db/repositories'
import { t } from '@/lib/i18n'
import { baht, makeAccount, makeCategory, makeTx } from '@/test/factories'
import { CalendarView } from './CalendarPage'

const TODAY = '2026-09-12'
const now = `${TODAY}T03:00:00.000Z`
let counter = 0
const newId = () => `gen-${++counter}`
const generate = () => scheduledPaymentsRepository.generateMissing(TODAY, { now, newId })

function renderCalendar(path = '/calendar') {
  const router = createMemoryRouter(
    [
      { path: '/calendar', element: <CalendarView today={TODAY} generate={generate} /> },
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

function wideScreen(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: matches && query.includes('48rem'), media: query, addEventListener: () => {}, removeEventListener: () => {} }))
}

async function seed() {
  await db.accounts.bulkAdd([
    makeAccount({ id: 'kbank', name: 'KBank', openingBalanceSatang: baht(50_000), openingDate: '2026-08-01' }),
    makeAccount({ id: 'cash', name: 'เงินสด', kind: 'cash', openingBalanceSatang: baht(5_000), openingDate: '2026-08-01' }),
    makeAccount({ id: 'card', name: 'บัตร KBank', kind: 'credit_card', openingDate: '2026-08-01' }),
  ])
  await db.categories.bulkAdd([
    makeCategory({ id: 'food', name: 'อาหาร' }),
    makeCategory({ id: 'shopping', name: 'ช้อปปิ้ง' }),
    makeCategory({ id: 'bills', name: 'ค่าบริการ' }),
    makeCategory({ id: 'home', name: 'บ้าน' }),
    makeCategory({ id: 'salary', name: 'เงินเดือน', kind: 'income' }),
  ])
  const stamp = { now, today: TODAY, newId }
  await recurringObligationsRepository.create({ name: 'อินเทอร์เน็ต', amountSatang: baht(899), categoryId: 'bills', defaultAccountId: 'kbank', recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-09-01', dayOfMonth: 10 } }, { ...stamp, id: 'net' })
  await recurringObligationsRepository.create({ name: 'ค่าเช่า', amountSatang: baht(7_800), categoryId: 'home', defaultAccountId: 'kbank', recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-09-01', dayOfMonth: 6 } }, { ...stamp, id: 'rent' })
  await recurringObligationsRepository.create({ name: 'เงินเดือน', kind: 'income', amountSatang: baht(27_500), categoryId: 'salary', defaultAccountId: 'kbank', recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-09-01', dayOfMonth: 30 } }, { ...stamp, id: 'sal' })
  await debtsRepository.create({ name: 'สินเชื่อบ้าน', kind: 'mortgage', openingBalanceSatang: baht(1_000_000), openingDate: '2026-09-01', interestMethod: 'unknown', installmentSatang: baht(7_800), dueDay: 25, scheduleEnabled: true }, { ...stamp, id: 'home' })
  await debtsRepository.create({ name: 'บัตร KBank', kind: 'credit_card', openingBalanceSatang: null, openingDate: TODAY, interestMethod: 'unknown', linkedAccountId: 'card' }, { ...stamp, id: 'cc' })
  const rent = (await scheduledPaymentsRepository.listForSource('obligation', 'rent')).find((p) => p.dueDate === '2026-09-06')!
  await scheduledPaymentsRepository.markPaid(rent.id, { type: 'expense', amountSatang: baht(7_800), accountId: 'kbank', categoryId: 'home', date: '2026-09-06', description: 'ค่าเช่า' }, [], { transactionId: 'rent-paid', now, newId })
  await db.transactions.bulkAdd([
    makeTx({ id: 'food', type: 'expense', amountSatang: baht(450), accountId: 'cash', categoryId: 'food', date: '2026-09-10', description: 'อาหาร' }),
    makeTx({ id: 'shoes', type: 'expense', amountSatang: baht(1_200), accountId: 'card', categoryId: 'shopping', date: '2026-09-11', description: 'รองเท้า' }),
    makeTx({ id: 'move', type: 'transfer', amountSatang: baht(5_000), accountId: 'kbank', toAccountId: 'cash', date: '2026-09-05', description: 'ถอนเงินสด' }),
    makeTx({ id: 'pay-card', type: 'debt_payment', amountSatang: baht(1_200), accountId: 'kbank', toAccountId: 'card', debtId: 'cc', date: '2026-09-11' }),
    makeTx({ id: 'aug', type: 'expense', amountSatang: baht(2_000), accountId: 'cash', categoryId: 'food', date: '2026-08-20', description: 'สิงหาคม' }),
    makeTx({ id: 'oct', type: 'expense', amountSatang: baht(3_000), accountId: 'cash', categoryId: 'food', date: '2026-10-02', description: 'ตุลาคม' }),
  ])
}

const agenda = () => screen.findByRole('region', { name: t('calendar.agenda') })
const link = (name: string) => screen.getByRole('link', { name: new RegExp(`^${name}`) })

beforeEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  await Promise.all(db.tables.map((table) => table.clear()))
})
afterEach(() => vi.unstubAllGlobals())

describe('Calendar — phone agenda', () => {
  beforeEach(seed)

  it('shows actual and scheduled events once each, labelled in words, opening the existing details', async () => {
    const before = await db.transactions.count()
    renderCalendar()
    expect(await screen.findByRole('heading', { level: 1, name: t('calendar.title') })).toBeInTheDocument()
    await agenda()
    expect(link('รายจ่าย อาหาร 450 บาท')).toHaveAttribute('href', '/transactions?tx=food')
    expect(link('รายรับที่คาดไว้ เงินเดือน 27,500 บาท คาดว่าจะได้รับ')).toHaveAttribute('href', '/income?rule=sal')
    expect(link('กำหนดจ่าย อินเทอร์เน็ต 899 บาท เลยกำหนด')).toHaveAttribute('href', '/recurring?id=net')
    expect(link('ค่างวดหนี้ สินเชื่อบ้าน 7,800 บาท กำหนดชำระ')).toHaveAttribute('href', '/debts?id=home')
    expect(link('โอนเงิน ถอนเงินสด 5,000 บาท')).toBeInTheDocument()
    expect(link('รายจ่าย รองเท้า 1,200 บาท')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^ชำระหนี้ .*1,200 บาท/ })).toHaveAttribute('href', '/transactions?tx=pay-card')
    // Rent was paid on its due date: one event, "จ่ายแล้ว" — not a second row for the payment.
    expect(screen.getAllByRole('link', { name: /ค่าเช่า/ })).toHaveLength(1)
    expect(link('กำหนดจ่าย ค่าเช่า 7,800 บาท จ่ายแล้ว')).toBeInTheDocument()
    // Other months never leak in; opening the calendar created no transaction.
    expect(screen.queryByRole('link', { name: /สิงหาคม|ตุลาคม/ })).not.toBeInTheDocument()
    expect(await db.transactions.count()).toBe(before)
  })

  it('summary: actual money only; debt payments apart; scheduled = unpaid only', async () => {
    renderCalendar()
    const summary = await screen.findByRole('region', { name: t('calendar.summary') })
    await agenda()
    expect(within(summary).getByText(t('calendar.summary.in')).closest('[data-slot="card"]') ?? summary).toHaveTextContent('฿0')
    expect(summary).toHaveTextContent(t('calendar.summary.expected', { amount: '฿27,500' }))
    expect(summary).toHaveTextContent('฿9,450') // 450 + 1,200 + 7,800 rent
    expect(summary).toHaveTextContent('฿1,200') // card payment
    expect(summary).toHaveTextContent('฿8,699') // internet 899 (overdue) + mortgage 7,800 — not the paid rent
  })

  it('day detail shows the day’s totals and events; back closes it', async () => {
    const { user, router } = renderCalendar()
    await agenda()
    await user.click(screen.getByRole('button', { name: new RegExp(`^${t('calendar.dayLabel', { date: '11 กันยายน 2026', count: 2 })}`) }))
    await waitFor(() => expect(router.state.location.search).toBe('?day=2026-09-11'))
    const sheet = await screen.findByRole('dialog', { name: '11 กันยายน 2026' })
    expect(within(sheet).getByText(t('calendar.day.out'), { selector: 'dt' }).parentElement).toHaveTextContent('฿1,200')
    expect(within(sheet).getByText(t('calendar.day.debt'), { selector: 'dt' }).parentElement).toHaveTextContent('฿1,200')
    expect(within(sheet).getAllByRole('link')).toHaveLength(2)
  })

  it('filters by type', async () => {
    const { user } = renderCalendar()
    await agenda()
    await user.click(screen.getByRole('radio', { name: t('calendar.filter.debt') }))
    const region = await agenda()
    const names = within(region).getAllByRole('link').map((a) => a.getAttribute('aria-label'))
    expect(names.every((name) => /^(ชำระหนี้|ค่างวดหนี้)/.test(name ?? ''))).toBe(true)
    expect(names).toHaveLength(2)
    await user.click(screen.getByRole('radio', { name: t('calendar.filter.transfer') }))
    expect(within(await agenda()).getAllByRole('link')).toHaveLength(1)
  })

  it('moves between months without mixing them; an empty month says so', async () => {
    const { user, router } = renderCalendar()
    await agenda()
    await user.click(screen.getByRole('button', { name: t('month.previous') }))
    await waitFor(() => expect(router.state.location.search).toBe('?month=2026-08'))
    expect(await screen.findByRole('link', { name: /^รายจ่าย สิงหาคม 2,000 บาท/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /อาหาร 450/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t('month.next') }))
    await user.click(screen.getByRole('button', { name: t('month.next') }))
    await waitFor(() => expect(router.state.location.search).toBe('?month=2026-10'))
    expect(await screen.findByRole('link', { name: /^รายจ่าย ตุลาคม 3,000 บาท/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t('month.next') }))
    await user.click(screen.getByRole('button', { name: t('month.next') }))
    await user.click(screen.getByRole('button', { name: t('month.next') }))
    expect(await screen.findByText(t('calendar.empty'))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t('calendar.today') }))
    await waitFor(() => expect(router.state.location.search).toBe(''))
  })

  it('updates live when an occurrence is paid through the existing flow', async () => {
    renderCalendar()
    await agenda()
    const overdue = (await scheduledPaymentsRepository.listForSource('obligation', 'net')).find((p) => p.dueDate === '2026-09-10')!
    await act(() => scheduledPaymentsRepository.markPaid(overdue.id, { type: 'expense', amountSatang: baht(899), accountId: 'kbank', categoryId: 'bills', date: TODAY, description: 'อินเทอร์เน็ต' }, [], { transactionId: 'net-paid', now, newId }))
    expect(await screen.findByRole('link', { name: /^กำหนดจ่าย อินเทอร์เน็ต 899 บาท จ่ายแล้ว จ่ายจริง/ })).toBeInTheDocument()
    // Paid on the 12th: the payment appears on its own date, marked as paying the 10th.
    expect(screen.getByRole('link', { name: /^รายจ่าย อินเทอร์เน็ต 899 บาท ชำระรายการที่ครบกำหนด/ })).toHaveAttribute('href', '/transactions?tx=net-paid')
  })
})

describe('Calendar — desktop grid', () => {
  beforeEach(async () => {
    wideScreen(true)
    await seed()
  })

  it('renders a 7-column month with limited items per day and opens the day detail', async () => {
    for (let n = 0; n < 5; n++) {
      await transactionsRepository.createExpense({ amountSatang: baht(10 + n), accountId: 'cash', categoryId: 'food', date: '2026-09-14', description: `กาแฟ ${n}` }, [], { id: `c${n}`, now, newId })
    }
    const { user, router } = renderCalendar()
    const grid = await screen.findByRole('grid', { name: t('calendar.grid', { month: 'กันยายน 2026' }) })
    expect(within(grid).getAllByRole('columnheader')).toHaveLength(7)
    const busy = within(grid).getByRole('button', { name: new RegExp(t('calendar.dayLabel', { date: '14 กันยายน 2026', count: 5 })) })
    expect(busy).toHaveTextContent(t('calendar.more', { count: 2 }))
    const today = within(grid).getByRole('button', { name: new RegExp(t('calendar.todayMark')) })
    expect(today).toHaveAttribute('aria-current', 'date')
    await user.click(busy)
    await waitFor(() => expect(router.state.location.search).toBe('?day=2026-09-14'))
    expect(within(await screen.findByRole('dialog', { name: '14 กันยายน 2026' })).getAllByRole('link')).toHaveLength(5)
  })
})
