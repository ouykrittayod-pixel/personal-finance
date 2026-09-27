// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/feedback/Toast'
import { db } from '@/db/dexie'
import { debtsRepository, scheduledPaymentsRepository, transactionsRepository } from '@/db/repositories'
import type { DebtDraft } from '@/domain/debts'
import { accountBalances, debtSummary } from '@/domain/reporting'
import { formatPercentBps } from '@/lib/formatting'
import { t } from '@/lib/i18n'
import { baht, makeAccount, makeCategory } from '@/test/factories'
import { Debts } from './DebtsPage'
import type { DebtsOps } from './debts-ops'

const TODAY = '2026-09-25'
let counter = 0
const newId = () => `gen-${++counter}`
const stamp = { now: `${TODAY}T03:00:00.000Z`, today: TODAY, newId }

/** The real repositories with a fixed "today", so dates are deterministic. */
function testOps(overrides: Partial<DebtsOps> = {}): DebtsOps {
  return {
    generate: () => scheduledPaymentsRepository.generateMissing(TODAY, stamp),
    create: (draft, id, newCard) => debtsRepository.create(draft, { ...stamp, id, newCard }),
    update: (id, draft) => debtsRepository.update(id, draft, stamp),
    pauseSchedule: (id) => debtsRepository.pauseSchedule(id, stamp),
    resumeSchedule: (id) => debtsRepository.resumeSchedule(id, stamp),
    archive: (id) => debtsRepository.archive(id, stamp),
    markPaid: (paymentId, draft, attachments, transactionId) => scheduledPaymentsRepository.markPaid(paymentId, draft, attachments, { transactionId, now: stamp.now, newId }),
    pay: (draft, attachments, transactionId) => transactionsRepository.create(draft, attachments, { id: transactionId, now: stamp.now, newId }),
    skip: (paymentId) => scheduledPaymentsRepository.markSkipped(paymentId, stamp),
    addAdjustment: (id, adjustment, adjustmentId) => debtsRepository.addAdjustment(id, adjustment, { id: adjustmentId, now: stamp.now }),
    addStatement: (id, statement, statementId) => debtsRepository.addStatement(id, statement, { ...stamp, id: statementId }),
    removeStatement: (id, statementId) => debtsRepository.removeStatement(id, statementId, stamp),
    ...overrides,
  }
}

function renderDebts(ops = testOps(), path = '/debts') {
  const router = createMemoryRouter(
    [
      { path: '/debts', element: <Debts today={TODAY} ops={ops} /> },
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

const mortgage = (overrides: Partial<DebtDraft> = {}): DebtDraft => ({
  name: 'สินเชื่อบ้าน',
  kind: 'mortgage',
  lender: 'ธนาคารออมสิน',
  principalSatang: baht(3_000_000),
  openingBalanceSatang: baht(1_000_000),
  openingDate: '2026-09-01',
  interestMethod: 'reducing_balance',
  annualInterestRateBps: 550,
  installmentSatang: baht(18_000),
  dueDay: 5,
  scheduleEnabled: true,
  ...overrides,
})

async function seedBasics() {
  await db.accounts.bulkAdd([
    makeAccount({ id: 'bank', name: 'KBank', kind: 'bank', openingBalanceSatang: baht(100_000), sortOrder: 0 }),
    makeAccount({ id: 'cash', name: 'เงินสด', kind: 'cash', openingBalanceSatang: baht(1_000), sortOrder: 1 }),
  ])
  await db.categories.add(makeCategory({ id: 'food', name: 'อาหาร', icon: '🍚' }))
}

const list = () => screen.findByRole('list', { name: t('debts.list') })
async function openDetail(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(within(await list()).getByRole('button', { name }))
  const dialog = await screen.findByRole('dialog', { name: t('debts.detail.title') })
  await within(dialog).findByText(t('debts.detail.history'))
  return dialog
}
const snapshot = async () => {
  const [accounts, transactions, debts] = await Promise.all([db.accounts.toArray(), db.transactions.toArray(), db.debts.toArray()])
  return { balances: accountBalances(accounts, transactions), debts: debtSummary(debts, transactions, accounts, TODAY), transactions }
}

beforeEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(db.tables.map((table) => table.clear()))
})

describe('Debts — overview', () => {
  beforeEach(seedBasics)

  it('shows the Thai header, four metrics and an empty state', async () => {
    renderDebts()
    expect(await screen.findByRole('heading', { level: 1, name: 'หนี้สินของฉัน' })).toBeInTheDocument()
    expect(await screen.findByText(t('debts.empty'))).toBeInTheDocument()
    for (const key of ['debts.metric.outstanding', 'debts.metric.paidThisMonth', 'debts.metric.upcoming', 'debts.metric.active'] as const) {
      expect(screen.getByText(t(key))).toBeInTheDocument()
    }
  })

  it('lists debts with outstanding, installment, next due and progress; unknown rate is labelled, not zero', async () => {
    await debtsRepository.create(mortgage({ annualInterestRateBps: null, interestMethod: 'unknown' }), { ...stamp, id: 'home' })
    await transactionsRepository.create(
      { type: 'debt_payment', debtId: 'home', amountSatang: baht(100_000), allocation: 'split', principalSatang: baht(100_000), interestSatang: baht(0), feeSatang: baht(0), accountId: 'bank', date: TODAY },
      [],
      { id: 'x1', ...stamp },
    )
    const { user } = renderDebts()
    const card = within(await list()).getByRole('button', { name: /สินเชื่อบ้าน/ })
    expect(within(card).getByText('฿900,000')).toBeInTheDocument()
    expect(within(card).getByText(t('debts.row.installment', { amount: '฿18,000' }))).toBeInTheDocument()
    expect(within(card).getByText(t('debts.row.progress', { percent: formatPercentBps(1_000) }))).toBeInTheDocument()
    expect(within(card).getByText(t('recurring.overdueDays', { days: 20 }))).toBeInTheDocument() // 5 Sep installment is unpaid

    const dialog = await openDetail(user, /สินเชื่อบ้าน/)
    expect(within(dialog).getByText(t('debts.detail.openingValue', { amount: '฿1,000,000', date: '1 กันยายน 2026' }))).toBeInTheDocument()
    const rate = within(dialog).getByText(t('debts.detail.rate')).closest('div')!
    expect(within(rate).getByText(t('debts.unknown'))).toBeInTheDocument()
    expect(within(dialog).getByText(t('debts.detail.estimateUnavailable'))).toBeInTheDocument()
  })
})

describe('Debts — create', () => {
  beforeEach(seedBasics)

  it('validates in Thai, then creates a mortgage with its installments (no transactions)', async () => {
    const { user, router } = renderDebts()
    await screen.findByText(t('debts.empty'))
    await user.click(screen.getAllByRole('button', { name: t('debts.add') })[0]!)
    await user.type(await screen.findByLabelText(t('debts.form.name')), 'บ้าน ธอส.')
    await user.click(screen.getByRole('button', { name: t('debts.form.save') }))
    expect(await screen.findByText(t('debts.error.opening_required'))).toBeInTheDocument()

    await user.type(screen.getByLabelText(t('debts.form.opening')), '850000')
    await user.type(screen.getByLabelText(t('debts.form.rate')), '5.x')
    await user.type(screen.getByLabelText(t('debts.form.installment')), '12000')
    await user.click(screen.getByRole('button', { name: t('debts.form.save') }))
    expect(await screen.findByText(t('debts.error.rate_invalid'))).toBeInTheDocument()

    await user.clear(screen.getByLabelText(t('debts.form.rate')))
    await user.type(screen.getByLabelText(t('debts.form.rate')), '5.25')
    await user.click(screen.getByRole('button', { name: t('debts.form.save') }))
    expect(await screen.findByText(t('debts.error.schedule_incomplete'))).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText(t('debts.form.dueDay')), '28')
    await user.click(screen.getByRole('button', { name: t('debts.form.save') }))
    await screen.findByText(t('debts.toast.created', { name: 'บ้าน ธอส.' }))

    const [stored] = await db.debts.toArray()
    expect(stored).toMatchObject({ name: 'บ้าน ธอส.', kind: 'mortgage', openingBalanceSatang: baht(850_000), openingDate: TODAY, annualInterestRateBps: 525, dueDay: 28, scheduleEnabled: true })
    expect(stored).not.toHaveProperty('principalSatang')
    expect((await db.scheduledPayments.toArray()).map((p) => p.dueDate).sort()).toEqual(['2026-09-28', '2026-10-28', '2026-11-28'])
    expect(await db.transactions.count()).toBe(0)
    // The new debt opens straight away.
    await waitFor(() => expect(router.state.location.search).toBe(`?id=${stored!.id}`))
  })

  it('a double-tap on save creates one debt', async () => {
    const { user } = renderDebts()
    await screen.findByText(t('debts.empty'))
    await user.click(screen.getAllByRole('button', { name: t('debts.add') })[0]!)
    await user.type(await screen.findByLabelText(t('debts.form.name')), 'กยศ.')
    await user.selectOptions(screen.getByLabelText(t('debts.form.kind')), 'student_loan')
    await user.type(screen.getByLabelText(t('debts.form.opening')), '60000')
    await user.click(screen.getByRole('checkbox', { name: t('debts.form.schedule') }))
    const save = screen.getByRole('button', { name: t('debts.form.save') })
    await user.dblClick(save)
    await screen.findByText(t('debts.toast.created', { name: 'กยศ.' }))
    expect(await db.debts.count()).toBe(1)
  })

  it('creates a credit card together with its card account; the balance comes from that account', async () => {
    const { user } = renderDebts()
    await screen.findByText(t('debts.empty'))
    await user.click(screen.getAllByRole('button', { name: t('debts.add') })[0]!)
    await user.selectOptions(await screen.findByLabelText(t('debts.form.kind')), 'credit_card')
    await user.type(screen.getByLabelText(t('debts.form.name')), 'KTC')
    expect(screen.queryByLabelText(t('debts.form.opening'))).not.toBeInTheDocument()
    await user.type(screen.getByLabelText(t('debts.form.cardOwed')), '4500')
    await user.click(screen.getByRole('button', { name: t('debts.form.save') }))
    await screen.findByText(t('debts.toast.created', { name: 'KTC' }))

    const card = (await db.accounts.toArray()).find((a) => a.kind === 'credit_card')
    expect(card).toMatchObject({ name: 'KTC', openingBalanceSatang: baht(-4_500) })
    expect((await snapshot()).debts.totalOutstanding).toBe(baht(4_500))
  })
})

describe('Debts — repayment', () => {
  beforeEach(async () => {
    await seedBasics()
    await debtsRepository.create(mortgage(), { ...stamp, id: 'home' })
  })

  it('pays the installment with a required principal / interest / fee split', async () => {
    const { user } = renderDebts()
    const dialog = await openDetail(user, /สินเชื่อบ้าน/)
    await user.click(within(dialog).getAllByRole('button', { name: t('debts.action.payFor', { date: '5 ก.ย. 2026' }) })[0]!)
    const pay = await screen.findByRole('dialog', { name: t('debts.pay.title', { name: 'สินเชื่อบ้าน' }) })
    expect(within(pay).getByLabelText(t('form.amount'))).toHaveDisplayValue(/^18,?000$/)

    await user.click(within(pay).getByRole('button', { name: t('debts.pay.confirm') }))
    expect(await within(pay).findByText(t('txForm.error.allocation_required'))).toBeInTheDocument()

    await user.type(within(pay).getByLabelText(t('txForm.principal')), '13500')
    await user.type(within(pay).getByLabelText(t('txForm.interest')), '4400')
    await user.type(within(pay).getByLabelText(t('txForm.fee')), '0')
    await user.click(within(pay).getByRole('button', { name: t('debts.pay.confirm') }))
    expect(await within(pay).findByText(t('txForm.error.allocation_mismatch'))).toBeInTheDocument()

    await user.clear(within(pay).getByLabelText(t('txForm.fee')))
    await user.type(within(pay).getByLabelText(t('txForm.fee')), '100')
    await user.dblClick(within(pay).getByRole('button', { name: t('debts.pay.confirm') }))
    await screen.findByText(t('debts.toast.paid', { name: 'สินเชื่อบ้าน', amount: '฿18,000' }))

    const { balances, debts, transactions } = await snapshot()
    expect(transactions).toHaveLength(1)
    expect(transactions[0]).toMatchObject({ type: 'debt_payment', debtId: 'home', principalSatang: baht(13_500), interestSatang: baht(4_400), feeSatang: baht(100) })
    expect(balances.get('bank')).toBe(baht(82_000))
    expect(debts.totalOutstanding).toBe(baht(986_500))
    expect((await db.scheduledPayments.toArray()).find((p) => p.dueDate === '2026-09-05')?.status).toBe('paid')
    expect(await within(dialog).findByText(t('debts.detail.split', { principal: '฿13,500', interest: '฿4,400', fee: '฿100' }))).toBeInTheDocument()
  })

  it('records an extra repayment and rejects principal above the outstanding balance', async () => {
    const { user } = renderDebts()
    const dialog = await openDetail(user, /สินเชื่อบ้าน/)
    await user.click(within(dialog).getByRole('button', { name: t('debts.action.extra') }))
    const pay = await screen.findByRole('dialog', { name: t('debts.pay.extraTitle', { name: 'สินเชื่อบ้าน' }) })
    await user.type(within(pay).getByLabelText(t('form.amount')), '1000001')
    await user.type(within(pay).getByLabelText(t('txForm.principal')), '1000001')
    await user.type(within(pay).getByLabelText(t('txForm.interest')), '0')
    await user.type(within(pay).getByLabelText(t('txForm.fee')), '0')
    await user.click(within(pay).getByRole('button', { name: t('debts.pay.confirm') }))
    expect(await within(pay).findByText(t('txForm.error.principal_exceeds_outstanding'))).toBeInTheDocument()
    expect(await db.transactions.count()).toBe(0)

    for (const label of [t('form.amount'), t('txForm.principal')]) {
      await user.clear(within(pay).getByLabelText(label))
      await user.type(within(pay).getByLabelText(label), '50000')
    }
    await user.click(within(pay).getByRole('button', { name: t('debts.pay.confirm') }))
    await screen.findByText(t('debts.toast.paid', { name: 'สินเชื่อบ้าน', amount: '฿50,000' }))
    expect((await snapshot()).debts.totalOutstanding).toBe(baht(950_000))
    // Installments are untouched by an unscheduled payment.
    expect((await db.scheduledPayments.toArray()).every((p) => p.status === 'pending')).toBe(true)
  })

  it('an unknown split is stored explicitly and does not reduce principal', async () => {
    const { user } = renderDebts()
    const dialog = await openDetail(user, /สินเชื่อบ้าน/)
    await user.click(within(dialog).getByRole('button', { name: t('debts.action.extra') }))
    const pay = await screen.findByRole('dialog', { name: t('debts.pay.extraTitle', { name: 'สินเชื่อบ้าน' }) })
    await user.type(within(pay).getByLabelText(t('form.amount')), '5000')
    await user.click(within(pay).getByRole('checkbox', { name: t('txForm.allocationUnknown') }))
    await user.click(within(pay).getByRole('button', { name: t('debts.pay.confirm') }))
    await screen.findByText(t('debts.toast.paid', { name: 'สินเชื่อบ้าน', amount: '฿5,000' }))
    expect((await snapshot()).debts).toMatchObject({ totalOutstanding: baht(1_000_000), unallocated: baht(5_000) })
    expect(await within(dialog).findByText(t('debts.unallocatedWarning', { amount: '฿5,000' }))).toBeInTheDocument()
  })

  it('pause, resume and archive keep payment history', async () => {
    await transactionsRepository.create(
      { type: 'debt_payment', debtId: 'home', amountSatang: baht(1_000), allocation: 'split', principalSatang: baht(1_000), interestSatang: baht(0), feeSatang: baht(0), accountId: 'bank', date: TODAY },
      [],
      { id: 'x1', ...stamp },
    )
    const { user } = renderDebts()
    const dialog = await openDetail(user, /สินเชื่อบ้าน/)
    await user.click(within(dialog).getByRole('button', { name: t('debts.action.pauseSchedule') }))
    await screen.findByText(t('debts.toast.paused'))
    expect((await db.scheduledPayments.toArray()).map((p) => p.dueDate)).toEqual(['2026-09-05'])
    await user.click(within(dialog).getByRole('button', { name: t('debts.action.resumeSchedule') }))
    await screen.findByText(t('debts.toast.resumed'))
    expect(await db.scheduledPayments.count()).toBe(4)

    await user.click(within(dialog).getByRole('button', { name: t('debts.action.archive') }))
    const confirm = await screen.findByRole('dialog', { name: t('debts.archive.title') })
    await user.click(within(confirm).getByRole('button', { name: t('debts.action.archive') }))
    await screen.findByText(t('debts.toast.archived', { name: 'สินเชื่อบ้าน' }))
    expect(await screen.findByText(t('debts.empty'))).toBeInTheDocument()
    expect(await db.transactions.get('x1')).toBeDefined()
    expect(await db.scheduledPayments.count()).toBe(0)
  })
})

describe('Debts — credit card', () => {
  beforeEach(async () => {
    await seedBasics()
    await db.accounts.add(makeAccount({ id: 'card', name: 'บัตร KTC', kind: 'credit_card', sortOrder: 2 }))
    await debtsRepository.create({ name: 'KTC', kind: 'credit_card', openingBalanceSatang: null, openingDate: TODAY, interestMethod: 'unknown', linkedAccountId: 'card' }, { ...stamp, id: 'cc' })
    await transactionsRepository.createExpense({ amountSatang: baht(3_000), accountId: 'card', categoryId: 'food', date: TODAY }, [], { id: 'e1', ...stamp })
  })

  it('pays the card without a split; the purchase stays the only expense', async () => {
    const { user } = renderDebts()
    const dialog = await openDetail(user, /KTC/)
    expect(within(dialog).getByText(t('debts.detail.cardSource', { account: 'บัตร KTC' }))).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: t('debts.action.pay') }))
    const pay = await screen.findByRole('dialog', { name: t('debts.pay.title', { name: 'KTC' }) })
    expect(within(pay).queryByLabelText(t('txForm.principal'))).not.toBeInTheDocument()
    await user.type(within(pay).getByLabelText(t('form.amount')), '1000')
    await user.click(within(pay).getByRole('button', { name: t('debts.pay.confirm') }))
    await screen.findByText(t('debts.toast.paid', { name: 'KTC', amount: '฿1,000' }))

    const { debts, transactions } = await snapshot()
    expect(debts.totalOutstanding).toBe(baht(2_000))
    expect(transactions.filter((tx) => tx.type === 'expense')).toHaveLength(1)
    expect(transactions.find((tx) => tx.type === 'debt_payment')).toMatchObject({ toAccountId: 'card', debtId: 'cc' })
  })

  it('a statement creates one scheduled payment and never replaces the live balance', async () => {
    const { user } = renderDebts()
    const dialog = await openDetail(user, /KTC/)
    await user.click(within(dialog).getByRole('button', { name: t('debts.action.addStatement') }))
    const form = await screen.findByRole('dialog', { name: t('debts.statement.title') })
    await user.type(within(form).getByLabelText(t('debts.statement.balance')), '3000')
    await user.type(within(form).getByLabelText(t('debts.statement.minimum')), '300')
    await user.click(within(form).getByRole('button', { name: t('debts.form.save') }))
    await screen.findByText(t('debts.toast.statement'))
    expect((await db.scheduledPayments.toArray()).map((p) => [p.sourceType, p.expectedAmountSatang])).toEqual([['debt', baht(300)]])
    expect((await snapshot()).debts.totalOutstanding).toBe(baht(3_000))
  })
})
