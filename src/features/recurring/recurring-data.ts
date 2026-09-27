/**
 * Recurring page data: loader (repositories → raw) and pure view-model
 * builders. Rules live in domain/scheduling and domain/recurrence.
 */
import type { StatusKind } from '@/components/finance/StatusBadge'
import type { Account, Category, Debt, ID, ISODate, RecurringObligation, ScheduledPayment, Transaction } from '@/domain/entities'
import { matchesSearch, normalizeSearch } from '@/domain/ledger'
import type { Satang } from '@/domain/money'
import { weekdayOf, type RecurrenceRule } from '@/domain/recurrence'
import {
  daysOverdue,
  isIncomeObligation,
  monthlyObligationSummary,
  obligationStatus,
  paymentState,
  type ObligationMonthSummary,
  type PaymentState,
} from '@/domain/scheduling'
import {
  accountsRepository,
  categoriesRepository,
  debtsRepository,
  recurringObligationsRepository,
  scheduledPaymentsRepository,
  transactionsRepository,
} from '@/db/repositories'
import { monthName, weekdayName } from '@/lib/dates'
import { formatDate } from '@/lib/formatting'
import { t } from '@/lib/i18n'

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export function frequencyLabel(rule: Pick<RecurrenceRule, 'frequency' | 'interval'>): string {
  const n = rule.interval
  switch (rule.frequency) {
    case 'weekly':
      return n === 1 ? t('freq.weekly') : t('freq.weeklyN', { n })
    case 'monthly':
      return n === 1 ? t('freq.monthly') : t('freq.monthlyN', { n })
    case 'yearly':
      return n === 1 ? t('freq.yearly') : t('freq.yearlyN', { n })
  }
}

/** "/ เดือน", "/ 3 เดือน" — shown after the amount. */
export function perLabel(rule: Pick<RecurrenceRule, 'frequency' | 'interval'>): string {
  if (rule.interval === 1) return t(`freq.per.${rule.frequency}`)
  return `/ ${rule.interval} ${t(`recurring.form.intervalUnit.${rule.frequency}`)}`
}

/** "ทุกเดือน วันที่ 6", "ทุกสัปดาห์ วันจันทร์", "ทุกปี วันที่ 15 มีนาคม". */
export function scheduleLabel(rule: RecurrenceRule): string {
  const freq = frequencyLabel(rule)
  const startDay = Number(rule.startDate.slice(8, 10))
  switch (rule.frequency) {
    case 'weekly':
      return t('freq.detail.weekly', { freq, weekday: weekdayName(rule.dayOfWeek ?? weekdayOf(rule.startDate)) })
    case 'monthly':
      return t('freq.detail.monthly', { freq, day: rule.dayOfMonth ?? startDay })
    case 'yearly':
      return t('freq.detail.yearly', {
        freq,
        day: rule.dayOfMonth ?? startDay,
        month: monthName(rule.monthOfYear ?? Number(rule.startDate.slice(5, 7))),
      })
  }
}

/** Badge + words for a scheduled payment's state (never colour alone). */
export function describePayment(
  payment: Pick<ScheduledPayment, 'status' | 'dueDate'>,
  today: ISODate,
  income = false,
): { kind: StatusKind; label: string; state: PaymentState } {
  const state = paymentState(payment, today)
  switch (state) {
    case 'overdue':
      return { state, kind: 'overdue', label: t(income ? 'income.status.overdueDays' : 'recurring.overdueDays', { days: daysOverdue(payment, today) }) }
    case 'due_soon':
      return { state, kind: 'due_soon', label: payment.dueDate === today ? t(income ? 'income.status.dueToday' : 'recurring.dueToday') : t('status.due_soon') }
    case 'pending':
      return { state, kind: 'pending', label: t(income ? 'income.status.pending' : 'recurring.unpaid') }
    case 'paid':
      return { state, kind: 'paid', label: t(income ? 'income.status.received' : 'status.paid') }
    case 'skipped':
      return { state, kind: 'skipped', label: t('status.skipped') }
  }
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export interface RecurringRawData {
  obligations: RecurringObligation[]
  payments: ScheduledPayment[]
  categories: Category[]
  accounts: Account[]
  debts: Debt[]
}

export async function loadRecurringData(): Promise<RecurringRawData> {
  const [obligations, payments, categories, accounts, debts] = await Promise.all([
    recurringObligationsRepository.listAll(),
    scheduledPaymentsRepository.listAll(),
    categoriesRepository.listAll(),
    accountsRepository.listAll(),
    debtsRepository.listAll(),
  ])
  return { obligations, payments: payments.filter((p) => p.sourceType === 'obligation'), categories, accounts, debts }
}

// ---------------------------------------------------------------------------
// List view model
// ---------------------------------------------------------------------------

export type RecurringFilter = 'all' | 'due' | 'overdue' | 'paid' | 'paused'
export const RECURRING_FILTERS: readonly RecurringFilter[] = ['all', 'due', 'overdue', 'paid', 'paused']

export interface RecurringRow {
  id: ID
  name: string
  icon?: string
  isDebt: boolean
  categoryLabel?: string
  amount: Satang
  perLabel: string
  scheduleLabel: string
  paused: boolean
  /** The occurrence to act on (oldest overdue, else next unpaid). */
  current?: { id: ID; dueDate: ISODate; amount: Satang }
  dueText: string
  status: { kind: StatusKind; label: string }
  overdueCount: number
  paidThisMonth: boolean
}

export interface RecurringModel {
  summary: ObligationMonthSummary
  rows: RecurringRow[]
  totalCount: number
  emptyReason: 'no_data' | 'no_match' | null
}

const RANK: Record<string, number> = { overdue: 0, due_soon: 1, pending: 2, paid: 3, none: 4 }

export function buildRecurringModel(raw: RecurringRawData, filters: { filter: RecurringFilter; search: string }, today: ISODate): RecurringModel {
  const month = today.slice(0, 7)
  const categories = new Map(raw.categories.map((c) => [c.id, c]))
  const debts = new Map(raw.debts.map((d) => [d.id, d]))
  // Payments to make only; expected income (salary…) lives on #/income.
  const live = raw.obligations.filter((o) => !o.archivedAt && !isIncomeObligation(o))
  const liveIds = new Set(live.map((o) => o.id))
  const paymentsBySource = new Map<ID, ScheduledPayment[]>()
  for (const p of raw.payments) {
    if (!liveIds.has(p.sourceId)) continue
    paymentsBySource.set(p.sourceId, [...(paymentsBySource.get(p.sourceId) ?? []), p])
  }

  const all = live.map((obligation): RecurringRow & { rank: number } => {
    const payments = paymentsBySource.get(obligation.id) ?? []
    const status = obligationStatus(payments, today)
    const category = obligation.categoryId ? categories.get(obligation.categoryId) : undefined
    const debt = obligation.debtId ? debts.get(obligation.debtId) : undefined
    const monthPayments = payments.filter((p) => p.dueDate.startsWith(`${month}-`) && p.status !== 'skipped')
    const paused = Boolean(obligation.pausedAt)

    let badge: { kind: StatusKind; label: string }
    let dueText: string
    if (status.current) {
      const described = describePayment(status.current, today)
      badge = { kind: described.kind, label: described.label }
      dueText = t('recurring.due', { date: formatDate(status.current.dueDate) })
    } else if (paused) {
      badge = { kind: 'paused', label: t('status.paused') }
      dueText = t('recurring.pausedNote')
    } else {
      badge = { kind: 'paid', label: t('status.paid') }
      dueText = t('recurring.noUpcoming')
    }
    // Paused rules show "paused" unless something is overdue (that still needs attention).
    if (paused && status.state !== 'overdue') badge = { kind: 'paused', label: t('status.paused') }

    return {
      id: obligation.id,
      name: obligation.name,
      icon: category?.icon,
      isDebt: Boolean(obligation.debtId),
      categoryLabel: debt ? t('recurring.detail.debt') : category?.name,
      amount: obligation.expectedAmountSatang,
      perLabel: perLabel(obligation.recurrence),
      scheduleLabel: scheduleLabel(obligation.recurrence),
      paused,
      current: status.current ? { id: status.current.id, dueDate: status.current.dueDate, amount: status.current.expectedAmountSatang } : undefined,
      dueText,
      status: badge,
      overdueCount: status.overdueCount,
      paidThisMonth: monthPayments.length > 0 && monthPayments.every((p) => p.status === 'paid'),
      rank: (paused && status.state !== 'overdue' ? 10 : 0) + (RANK[status.state] ?? 4),
    }
  })

  const query = filters.search.trim()
  const rows = all
    .filter((row) => {
      switch (filters.filter) {
        case 'all':
          return true
        case 'due':
          return row.current !== undefined && row.overdueCount === 0
        case 'overdue':
          return row.overdueCount > 0
        case 'paid':
          return row.paidThisMonth
        case 'paused':
          return row.paused
      }
    })
    .filter((row) => !query || matchesSearch(normalizeSearch(`${row.name} ${row.categoryLabel ?? ''}`), query))
    .sort((a, b) => a.rank - b.rank || (a.current?.dueDate ?? '9999').localeCompare(b.current?.dueDate ?? '9999') || a.name.localeCompare(b.name))
    .map(({ rank: _rank, ...row }) => row)

  return {
    summary: monthlyObligationSummary(
      raw.payments.filter((p) => liveIds.has(p.sourceId)),
      live,
      month,
      today,
    ),
    rows,
    totalCount: live.length,
    emptyReason: live.length === 0 ? 'no_data' : rows.length === 0 ? 'no_match' : null,
  }
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export interface RecurringDetail {
  obligation: RecurringObligation
  category?: Category
  account?: Account
  debt?: Debt
  /** Unpaid first, oldest first (what to pay next is on top); then paid / skipped history, newest first. */
  payments: ScheduledPayment[]
  /** Transactions that paid occurrences (for the actual amount/date). */
  paidTransactions: Map<ID, Transaction>
  /** For the edit form. */
  categories: Category[]
  accounts: Account[]
  debts: Debt[]
}

/**
 * Order of occurrences in a detail list: unpaid ones first, oldest first, so the
 * overdue / next one is the first "ชำระแล้ว" a user sees (never a future month);
 * then paid and skipped history, newest first.
 */
export function orderForDetail(payments: readonly ScheduledPayment[]): ScheduledPayment[] {
  const unpaid = payments.filter((p) => p.status === 'pending').sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  const settled = payments.filter((p) => p.status !== 'pending').sort((a, b) => b.dueDate.localeCompare(a.dueDate))
  return [...unpaid, ...settled]
}

export async function loadRecurringDetail(id: ID): Promise<RecurringDetail | null> {
  const obligation = await recurringObligationsRepository.get(id)
  if (!obligation || obligation.archivedAt) return null
  const [payments, categories, accounts, debts] = await Promise.all([
    scheduledPaymentsRepository.listForSource('obligation', id),
    categoriesRepository.listAll(),
    accountsRepository.listAll(),
    debtsRepository.listAll(),
  ])
  const linked = await Promise.all(payments.filter((p) => p.transactionId).map((p) => transactionsRepository.get(p.transactionId!)))
  return {
    obligation,
    category: categories.find((c) => c.id === obligation.categoryId),
    account: accounts.find((a) => a.id === obligation.defaultAccountId),
    debt: debts.find((d) => d.id === obligation.debtId),
    payments: orderForDetail(payments),
    paidTransactions: new Map(linked.filter((tx): tx is Transaction => tx !== undefined).map((tx) => [tx.id, tx])),
    categories,
    accounts,
    debts,
  }
}
