/**
 * Financial calendar: a pure VIEW MODEL over existing records. Nothing here
 * creates, stores or changes money.
 *
 * Two layers, one row per financial event:
 *  - Actual transactions (expense, income, debt payment, transfer) on their
 *    transaction date. Adjustments are system corrections and are not shown.
 *  - Scheduled occurrences (ScheduledPayment) on their DUE date — bills, debt
 *    installments / card statements, and expected income. Recurring RULES are
 *    never shown: only their generated occurrences, so a rule and its
 *    occurrence can never appear twice.
 *
 * A paid occurrence and the transaction that paid it are one event when they
 * fall on the same day (one row: "paid", with the actual amount). When the
 * payment date differs from the due date, the occurrence stays on its due
 * date (marked paid, with the actual date) and the transaction appears on its
 * own date marked as the payment of that occurrence.
 *
 * Totals: actual money comes only from transactions (by type; debt payments
 * are never expenses, transfers are neither). "Scheduled" totals count only
 * UNPAID occurrences, so nothing is counted twice and expected money is never
 * treated as actual.
 */
import type { ID, ISODate, RecurringObligation, ScheduledPayment, Transaction } from './entities'
import { add, ZERO, type Satang } from './money'
import { obligationKind, paymentState } from './scheduling'

export type CalendarItemKind = 'expense' | 'income' | 'debt_payment' | 'transfer' | 'scheduled_expense' | 'scheduled_income' | 'scheduled_debt'
export type CalendarItemStatus = 'actual' | 'upcoming' | 'overdue' | 'paid' | 'skipped'
export type CalendarFilter = 'all' | 'income' | 'expense' | 'debt' | 'scheduled' | 'transfer'
export const CALENDAR_FILTERS: readonly CalendarFilter[] = ['all', 'income', 'expense', 'debt', 'scheduled', 'transfer']

export interface CalendarItem {
  /** Stable key: "tx:<id>" or "sp:<id>". */
  id: string
  /** The financial date: transaction date, or the occurrence's due date. */
  date: ISODate
  kind: CalendarItemKind
  status: CalendarItemStatus
  title: string
  /** Actual amount when money moved (a paid occurrence shows what was actually paid), else the expected amount. */
  amountSatang: Satang
  accountId?: ID
  toAccountId?: ID
  categoryId?: ID
  debtId?: ID
  transactionId?: ID
  scheduledPaymentId?: ID
  obligationId?: ID
  /** Scheduled items: what was expected. */
  expectedSatang?: Satang
  /** Paid occurrence: when it was actually paid (may differ from the due date). */
  paidDate?: ISODate
  /** Actual transaction that paid an occurrence due on another day. */
  paysDueDate?: ISODate
}

export interface CalendarSources {
  /** Transactions dated in the month (plus any that paid an occurrence due in it). */
  transactions: readonly Transaction[]
  /** Occurrences due in the month. */
  payments: readonly ScheduledPayment[]
  obligations: readonly RecurringObligation[]
  /** Titles. */
  names: {
    category: (id: ID) => string | undefined
    account: (id: ID) => string | undefined
    debt: (id: ID) => string | undefined
    describe: (tx: Transaction) => string
  }
}

const inMonth = (date: ISODate, month: string) => date.startsWith(`${month}-`)
const ACTUAL: ReadonlySet<Transaction['type']> = new Set(['expense', 'income', 'debt_payment', 'transfer'])

function scheduledKind(payment: ScheduledPayment, obligations: ReadonlyMap<ID, RecurringObligation>): CalendarItemKind {
  if (payment.sourceType === 'debt') return 'scheduled_debt'
  const rule = obligations.get(payment.sourceId)
  if (!rule) return 'scheduled_expense'
  const kind = obligationKind(rule)
  return kind === 'income' ? 'scheduled_income' : kind === 'debt' ? 'scheduled_debt' : 'scheduled_expense'
}

function scheduledStatus(payment: ScheduledPayment, today: ISODate): CalendarItemStatus {
  const state = paymentState(payment, today)
  return state === 'paid' || state === 'skipped' || state === 'overdue' ? state : 'upcoming'
}

/** All events whose financial date is in `month` ("YYYY-MM"), date order (then scheduled before actual, then title). */
export function buildCalendarItems(sources: CalendarSources, month: string, today: ISODate): CalendarItem[] {
  const obligations = new Map(sources.obligations.map((o) => [o.id, o]))
  const txById = new Map(sources.transactions.map((tx) => [tx.id, tx]))
  const items: CalendarItem[] = []
  const mergedTx = new Set<ID>()

  for (const payment of sources.payments) {
    if (!inMonth(payment.dueDate, month)) continue
    const rule = payment.sourceType === 'obligation' ? obligations.get(payment.sourceId) : undefined
    const paidTx = payment.transactionId ? txById.get(payment.transactionId) : undefined
    const debtId = payment.sourceType === 'debt' ? payment.sourceId : rule?.debtId
    // Same day → one event (the occurrence, paid, with the actual amount).
    const merged = payment.status === 'paid' && paidTx !== undefined && paidTx.date === payment.dueDate
    if (merged) mergedTx.add(paidTx.id)
    items.push({
      id: `sp:${payment.id}`,
      date: payment.dueDate,
      kind: scheduledKind(payment, obligations),
      status: scheduledStatus(payment, today),
      title: rule?.name ?? (debtId ? sources.names.debt(debtId) : undefined) ?? '—',
      amountSatang: paidTx ? paidTx.amountSatang : payment.expectedAmountSatang,
      expectedSatang: payment.expectedAmountSatang,
      scheduledPaymentId: payment.id,
      ...(payment.sourceType === 'obligation' ? { obligationId: payment.sourceId } : {}),
      ...(debtId ? { debtId } : {}),
      ...(rule?.categoryId ? { categoryId: rule.categoryId } : {}),
      ...(rule?.defaultAccountId ? { accountId: rule.defaultAccountId } : {}),
      ...(paidTx ? { transactionId: paidTx.id, paidDate: paidTx.date, accountId: paidTx.accountId } : payment.paidDate ? { paidDate: payment.paidDate } : {}),
    })
  }

  const dueDates = new Map(sources.payments.map((p) => [p.id, p.dueDate]))
  for (const tx of sources.transactions) {
    if (!ACTUAL.has(tx.type) || !inMonth(tx.date, month) || mergedTx.has(tx.id)) continue
    const dueDate = tx.scheduledPaymentId ? dueDates.get(tx.scheduledPaymentId) : undefined
    items.push({
      id: `tx:${tx.id}`,
      date: tx.date,
      kind: tx.type as CalendarItemKind,
      status: 'actual',
      title: sources.names.describe(tx),
      amountSatang: tx.amountSatang,
      accountId: tx.accountId,
      ...(tx.toAccountId ? { toAccountId: tx.toAccountId } : {}),
      ...(tx.categoryId ? { categoryId: tx.categoryId } : {}),
      ...(tx.debtId ? { debtId: tx.debtId } : {}),
      transactionId: tx.id,
      ...(tx.scheduledPaymentId ? { scheduledPaymentId: tx.scheduledPaymentId } : {}),
      ...(dueDate && dueDate !== tx.date ? { paysDueDate: dueDate } : {}),
    })
  }

  return items.sort((a, b) => a.date.localeCompare(b.date) || Number(a.status === 'actual') - Number(b.status === 'actual') || a.title.localeCompare(b.title))
}

export function matchesCalendarFilter(item: Pick<CalendarItem, 'kind' | 'status'>, filter: CalendarFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'income':
      return item.kind === 'income' || item.kind === 'scheduled_income'
    case 'expense':
      return item.kind === 'expense' || item.kind === 'scheduled_expense'
    case 'debt':
      return item.kind === 'debt_payment' || item.kind === 'scheduled_debt'
    case 'scheduled':
      return item.kind.startsWith('scheduled_')
    case 'transfer':
      return item.kind === 'transfer'
  }
}

export interface CalendarTotals {
  /** Actual income received. */
  moneyIn: Satang
  /** Actual expenses (never debt payments or transfers). */
  expenses: Satang
  debtPayments: Satang
  transfers: Satang
  /** Unpaid bills + debt installments due (upcoming or overdue) — expected, not spent. */
  scheduledOut: Satang
  /** Unpaid expected income — not received. */
  expectedIn: Satang
}

/**
 * Totals from the transactions and occurrences themselves (not from rows, so a
 * merged paid event is counted exactly once, as the transaction it is).
 */
export function calendarTotals(sources: Pick<CalendarSources, 'transactions' | 'payments' | 'obligations'>, range: { start: ISODate; end: ISODate }): CalendarTotals {
  const totals: CalendarTotals = { moneyIn: ZERO, expenses: ZERO, debtPayments: ZERO, transfers: ZERO, scheduledOut: ZERO, expectedIn: ZERO }
  const within = (date: ISODate) => date >= range.start && date <= range.end
  for (const tx of sources.transactions) {
    if (!within(tx.date)) continue
    if (tx.type === 'income') totals.moneyIn = add(totals.moneyIn, tx.amountSatang)
    else if (tx.type === 'expense') totals.expenses = add(totals.expenses, tx.amountSatang)
    else if (tx.type === 'debt_payment') totals.debtPayments = add(totals.debtPayments, tx.amountSatang)
    else if (tx.type === 'transfer') totals.transfers = add(totals.transfers, tx.amountSatang)
  }
  const obligations = new Map(sources.obligations.map((o) => [o.id, o]))
  for (const payment of sources.payments) {
    if (payment.status !== 'pending' || !within(payment.dueDate)) continue
    if (scheduledKind(payment, obligations) === 'scheduled_income') totals.expectedIn = add(totals.expectedIn, payment.expectedAmountSatang)
    else totals.scheduledOut = add(totals.scheduledOut, payment.expectedAmountSatang)
  }
  return totals
}

/** Items grouped by date (only days that have items), in date order. */
export function groupByDay(items: readonly CalendarItem[]): { date: ISODate; items: CalendarItem[] }[] {
  const days = new Map<ISODate, CalendarItem[]>()
  for (const item of items) days.set(item.date, [...(days.get(item.date) ?? []), item])
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, dayItems]) => ({ date, items: dayItems }))
}

/**
 * The month's grid: whole weeks (Monday first) covering the month. Days from
 * the neighbouring months are flagged so their events never join this month.
 */
export function monthGrid(month: string): { date: ISODate; inMonth: boolean }[][] {
  const [year, m] = month.split('-').map(Number) as [number, number]
  const first = new Date(Date.UTC(year, m - 1, 1))
  const daysInMonth = new Date(Date.UTC(year, m, 0)).getUTCDate()
  const lead = (first.getUTCDay() + 6) % 7 // Monday = 0
  const cells = Math.ceil((lead + daysInMonth) / 7) * 7
  const weeks: { date: ISODate; inMonth: boolean }[][] = []
  for (let i = 0; i < cells; i++) {
    const day = new Date(Date.UTC(year, m - 1, 1 - lead + i))
    const date = day.toISOString().slice(0, 10)
    if (i % 7 === 0) weeks.push([])
    weeks.at(-1)!.push({ date, inMonth: inMonth(date, month) })
  }
  return weeks
}
