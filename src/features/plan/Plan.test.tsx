import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { ToastProvider } from '@/components/feedback/Toast'
import { formatSignedMoney } from '@/components/finance/money-format'
import { db } from '@/db/dexie'
import { recurringObligationsRepository, scheduledPaymentsRepository } from '@/db/repositories'
import type { Satang } from '@/domain/money'
import type { RecurringOps } from '@/features/recurring/recurring-ops'
import { t } from '@/lib/i18n'
import { baht, makeAccount, makeCategory } from '@/test/factories'
import { Plan } from './PlanPage'

const TODAY = '2026-09-25'
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
    markPaid: (paymentId, draft, attachments, transactionId) => scheduledPaymentsRepository.markPaid(paymentId, draft, attachments, { transactionId, now: stamp.now, newId }),
    skip: (paymentId) => scheduledPaymentsRepository.markSkipped(paymentId, stamp),
    unskip: (paymentId) => scheduledPaymentsRepository.markUnskipped(paymentId, stamp),
    setAmount: (ref, amountSatang) => scheduledPaymentsRepository.setExpectedAmount(ref, amountSatang, stamp),
  }
}

function renderPlan(path = '/plan') {
  const router = createMemoryRouter([{ path: '/plan', element: <Plan today={TODAY} ops={testOps()} /> }], { initialEntries: [path] })
  const user = userEvent.setup()
  render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>,
  )
  return { user, router }
}

const money = (amount: Satang, tone: 'income' | 'expense' | 'neutral' = 'neutral') => formatSignedMoney(amount, { tone })

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()))
  await db.accounts.bulkAdd([
    makeAccount({ id: 'bank', name: 'KBank', kind: 'bank', openingBalanceSatang: baht(50_000), sortOrder: 0 }),
    makeAccount({ id: 'invest', name: 'ลงทุน', kind: 'investment', sortOrder: 1 }),
  ])
  await db.categories.bulkAdd([
    makeCategory({ id: 'home', name: 'บ้าน', icon: '🏠', kind: 'expense', sortOrder: 0 }),
    makeCategory({ id: 'salary', name: 'เงินเดือน', icon: '💼', kind: 'income', sortOrder: 0 }),
  ])
  const monthly = (startDate: string, dayOfMonth: number) => ({ frequency: 'monthly' as const, interval: 1, startDate, dayOfMonth })
  await recurringObligationsRepository.create(
    { name: 'ค่าเช่า', amountSatang: baht(7_800), categoryId: 'home', defaultAccountId: 'bank', recurrence: monthly('2026-01-01', 6) },
    { ...stamp, id: 'rent' },
  )
  await recurringObligationsRepository.create(
    { name: 'เงินเดือน', kind: 'income', amountSatang: baht(28_000), categoryId: 'salary', defaultAccountId: 'bank', recurrence: monthly('2026-01-01', 25) },
    { ...stamp, id: 'pay' },
  )
  await recurringObligationsRepository.create(
    { name: 'DCA', kind: 'transfer', toAccountId: 'invest', amountSatang: baht(700), defaultAccountId: 'bank', recurrence: monthly('2026-10-01', 1) },
    { ...stamp, id: 'dca' },
  )
})

describe('Plan', () => {
  it('shows income − what has to be paid = what is left for the month', async () => {
    renderPlan()
    expect(await screen.findByRole('heading', { level: 1, name: t('plan.title') })).toBeInTheDocument()
    // September: salary 28,000 expected; rent 7,800 (overdue, due the 6th).
    expect((await screen.findAllByText(money(baht(20_200), 'income'))).length).toBeGreaterThan(0)
    const outgoing = screen.getByRole('list', { name: t('plan.outgoing.title') })
    expect(within(outgoing).getByText('ค่าเช่า')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: t('plan.income.title') })).getByText('เงินเดือน')).toBeInTheDocument()
  })

  it('next month includes the planned transfer', async () => {
    renderPlan('/plan?month=2026-10')
    const outgoing = await screen.findByRole('list', { name: t('plan.outgoing.title') })
    expect(within(outgoing).getByText('DCA')).toBeInTheDocument()
    // 28,000 − 7,800 − 700
    expect((await screen.findAllByText(money(baht(19_500), 'income'))).length).toBeGreaterThan(0)
  })

  it('sets the amount of one month only', async () => {
    const { user } = renderPlan()
    const outgoing = await screen.findByRole('list', { name: t('plan.outgoing.title') })
    await user.click(within(outgoing).getByRole('button', { name: new RegExp(`^${t('plan.action.editAmount')} ค่าเช่า`) }))
    const dialog = await screen.findByRole('dialog')
    const input = within(dialog).getByRole('textbox')
    await user.clear(input)
    await user.type(input, '8000')
    await user.click(within(dialog).getByRole('button', { name: t('plan.editAmount.save') }))
    await waitFor(async () => expect((await db.scheduledPayments.filter((p) => p.sourceId === 'rent' && p.dueDate === '2026-09-06').first())?.expectedAmountSatang).toBe(baht(8_000)))
    expect((await screen.findAllByText(money(baht(20_000), 'income'))).length).toBeGreaterThan(0)
    // Other months keep the usual amount.
    expect((await db.scheduledPayments.filter((p) => p.sourceId === 'rent' && p.dueDate === '2026-10-06').first())?.expectedAmountSatang).toBe(baht(7_800))
  })

  it('a month further ahead is projected, and planning its amount stores that month', async () => {
    const { user } = renderPlan('/plan?month=2027-03')
    const outgoing = await screen.findByRole('list', { name: t('plan.outgoing.title') })
    expect(within(outgoing).getAllByText(t('plan.status.projected')).length).toBeGreaterThan(0)
    expect(await db.scheduledPayments.filter((p) => p.sourceId === 'rent' && p.dueDate === '2027-03-06').count()).toBe(0)
    await user.click(within(outgoing).getByRole('button', { name: new RegExp(`^${t('plan.action.editAmount')} ค่าเช่า`) }))
    const dialog = await screen.findByRole('dialog')
    const input = within(dialog).getByRole('textbox')
    await user.clear(input)
    await user.type(input, '8200')
    await user.click(within(dialog).getByRole('button', { name: t('plan.editAmount.save') }))
    await waitFor(async () => expect((await db.scheduledPayments.filter((p) => p.sourceId === 'rent' && p.dueDate === '2027-03-06').first())?.expectedAmountSatang).toBe(baht(8_200)))
  })
})
