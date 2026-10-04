/**
 * Recurring obligations → scheduled payments. Pure rules, no storage.
 *
 *   RecurringObligation (the rule, never money)
 *        ↓ planMissingOccurrences / planRuleChange
 *   ScheduledPayment    (one expected occurrence: pending | paid | skipped)
 *        ↓ the user pays (repository markPaid)
 *   Transaction         (real money: expense, or debt_payment for a debt)
 *
 * Nothing here ever creates a transaction because a date arrived.
 * "Overdue" and "due soon" are derived from today, never stored.
 */
import { hasOwnSchedule } from './debts'
import type { Account, Debt, ID, ISODate, RecurringObligation, ScheduledPayment } from './entities'
import { add, ZERO, type Satang } from './money'
import {
  addDays,
  addMonthsClamped,
  daysBetween,
  isValidDate,
  occurrencesBetween,
  validateRecurrence,
  type RecurrenceIssue,
  type RecurrenceRule,
} from './recurrence'
import { accountClassOf, type EditableType } from './transactions'

/** How far ahead unpaid occurrences are created. */
export const SCHEDULE_HORIZON_MONTHS = 3
/** Unpaid payments due within this many days are "due soon". */
export const DUE_SOON_DAYS = 7

// ---------------------------------------------------------------------------
// Obligations: validation and building
// ---------------------------------------------------------------------------

export interface ObligationDraft {
  name: string
  amountSatang: Satang | null
  /** Bills: required expense category. Ignored when paying a debt. */
  categoryId?: ID
  defaultAccountId?: ID
  /** Set to pay a debt (creates debt payments, never expenses). */
  debtId?: ID
  /**
   * 'income' = expected money in (salary…): needs an income category, never a debt.
   * 'transfer' = planned move to another own account (savings, DCA…): needs `toAccountId`.
   */
  kind?: 'income' | 'transfer'
  /** kind 'transfer': destination account. */
  toAccountId?: ID
  recurrence: RecurrenceRule
  note?: string
}

export type ObligationIssue =
  | 'name_required'
  | 'amount_required'
  | 'amount_not_integer'
  | 'amount_must_be_positive'
  | 'category_required'
  | 'category_not_expense'
  | 'category_not_income'
  | 'account_required'
  | 'unknown_account'
  | 'pay_from_liability'
  | 'debt_not_found'
  | 'debt_has_own_schedule'
  | 'to_account_required'
  | 'unknown_to_account'
  | 'same_account'
  | RecurrenceIssue

export interface ObligationContext {
  accounts: ReadonlyMap<ID, Pick<Account, 'kind' | 'archivedAt'>>
  categories: ReadonlyMap<ID, { kind: 'expense' | 'income' }>
  debts: ReadonlyMap<ID, Pick<Debt, 'kind' | 'scheduleEnabled' | 'statements'>>
}

/**
 * Anything that produces scheduled payments by a recurrence rule: a recurring
 * obligation, or a loan's own installment schedule (see debtScheduleSource).
 */
export type ScheduleSource = Pick<RecurringObligation, 'recurrence' | 'expectedAmountSatang' | 'scheduleFrom' | 'pausedAt' | 'archivedAt'>

export type ObligationKind = 'bill' | 'debt' | 'income' | 'transfer'

/** Bill (expense), debt payment, expected income, or planned transfer — one rule model, four meanings. */
export function obligationKind(obligation: Pick<RecurringObligation, 'kind' | 'debtId'>): ObligationKind {
  if (obligation.kind === 'income') return 'income'
  if (obligation.kind === 'transfer') return 'transfer'
  return obligation.debtId ? 'debt' : 'bill'
}

export const isIncomeObligation = (obligation: Pick<RecurringObligation, 'kind'>) => obligation.kind === 'income'

/** A rule that happens once (a planned one-off bill or income): stored as a single-occurrence rule. */
export const isOneOff = (rule: Pick<RecurrenceRule, 'count'>) => rule.count === 1

/** The rule for a one-off planned item due on `date`. */
export function oneOffRecurrence(date: ISODate): RecurrenceRule {
  return { frequency: 'monthly', interval: 1, startDate: date, dayOfMonth: Number(date.slice(8, 10)), count: 1 }
}

export function isObligationActive(obligation: Pick<RecurringObligation, 'pausedAt' | 'archivedAt'>): boolean {
  return !obligation.pausedAt && !obligation.archivedAt
}

const firstOfMonth = (date: ISODate) => `${date.slice(0, 7)}-01`
const later = (a: ISODate, b: ISODate) => (a > b ? a : b)

/**
 * Validate a draft and build the obligation to store (create or edit).
 * On create, generation starts at the rule's start date but no earlier than
 * the first of the current month — the app does not back-fill years of
 * "overdue" bills for a rule that started long ago.
 */
export function buildObligation(
  draft: ObligationDraft,
  context: ObligationContext,
  meta: { id: ID; now: string; today: ISODate; existing?: RecurringObligation },
): { ok: true; obligation: RecurringObligation } | { ok: false; issues: ObligationIssue[] } {
  const issues: ObligationIssue[] = []
  const name = draft.name.trim()
  if (!name) issues.push('name_required')

  if (draft.amountSatang === null) issues.push('amount_required')
  else if (!Number.isSafeInteger(draft.amountSatang)) issues.push('amount_not_integer')
  else if (draft.amountSatang <= 0) issues.push('amount_must_be_positive')

  const income = draft.kind === 'income'
  const transfer = draft.kind === 'transfer'
  if (transfer) {
    if (!draft.toAccountId) issues.push('to_account_required')
    else {
      const to = context.accounts.get(draft.toAccountId)
      if (!to || (to.archivedAt && meta.existing?.toAccountId !== draft.toAccountId)) issues.push('unknown_to_account')
      else if (draft.toAccountId === draft.defaultAccountId) issues.push('same_account')
    }
  } else if (income) {
    if (!draft.categoryId) issues.push('category_required')
    else if (context.categories.get(draft.categoryId)?.kind !== 'income') issues.push('category_not_income')
  } else if (draft.debtId) {
    const debt = context.debts.get(draft.debtId)
    if (!debt) issues.push('debt_not_found')
    // One schedule owner per debt: a debt with its own installments/statements is paid from #/debts.
    else if (hasOwnSchedule(debt)) issues.push('debt_has_own_schedule')
  } else if (!draft.categoryId) {
    issues.push('category_required')
  } else if (context.categories.get(draft.categoryId)?.kind !== 'expense') {
    issues.push('category_not_expense')
  }

  if (!draft.defaultAccountId) issues.push('account_required')
  else {
    const account = context.accounts.get(draft.defaultAccountId)
    if (!account || (account.archivedAt && meta.existing?.defaultAccountId !== draft.defaultAccountId)) issues.push('unknown_account')
    else if ((draft.debtId || income || transfer) && accountClassOf(account.kind) === 'liability') issues.push('pay_from_liability')
  }

  issues.push(...validateRecurrence(draft.recurrence))
  if (issues.length > 0) return { ok: false, issues }

  const { existing } = meta
  const recurrence: RecurrenceRule = { ...draft.recurrence }
  for (const key of Object.keys(recurrence) as (keyof RecurrenceRule)[]) if (recurrence[key] === undefined) delete recurrence[key]

  const obligation: RecurringObligation = {
    // Fields the form does not edit survive an edit.
    ...(existing ?? {}),
    id: existing?.id ?? meta.id,
    name,
    expectedAmountSatang: draft.amountSatang!,
    variableAmount: existing?.variableAmount ?? false,
    recurrence,
    defaultAccountId: draft.defaultAccountId,
    categoryId: transfer || (!income && draft.debtId) ? undefined : draft.categoryId,
    debtId: income || transfer ? undefined : draft.debtId || undefined,
    kind: income ? 'income' : transfer ? 'transfer' : undefined,
    toAccountId: transfer ? draft.toAccountId : undefined,
    scheduleFrom: existing?.scheduleFrom ?? later(recurrence.startDate, firstOfMonth(meta.today)),
    note: draft.note?.trim() || undefined,
    createdAt: existing?.createdAt ?? meta.now,
    updatedAt: meta.now,
  }
  for (const key of Object.keys(obligation) as (keyof RecurringObligation)[]) if (obligation[key] === undefined) delete obligation[key]
  return { ok: true, obligation }
}

// ---------------------------------------------------------------------------
// Generating occurrences
// ---------------------------------------------------------------------------

export interface NewOccurrence {
  dueDate: ISODate
  expectedAmountSatang: Satang
}

/** The window occurrences are generated in: [scheduleFrom, today + horizon]. Null if the rule is not active. */
export function generationWindow(obligation: ScheduleSource, today: ISODate): { from: ISODate; to: ISODate } | null {
  if (!isObligationActive(obligation)) return null
  const from = later(obligation.scheduleFrom ?? obligation.recurrence.startDate, obligation.recurrence.startDate)
  if (!isValidDate(from)) return null
  return { from, to: addMonthsClamped(today, SCHEDULE_HORIZON_MONTHS) }
}

/**
 * Occurrences that should exist but don't yet. Deterministic and idempotent:
 * running it again after its results are stored returns nothing.
 * (The database's unique [sourceType+sourceId+dueDate] index is the backstop.)
 */
export function planMissingOccurrences(obligation: ScheduleSource, existing: readonly Pick<ScheduledPayment, 'dueDate'>[], today: ISODate): NewOccurrence[] {
  const window = generationWindow(obligation, today)
  if (!window) return []
  const have = new Set(existing.map((p) => p.dueDate))
  return occurrencesBetween(obligation.recurrence, window.from, window.to)
    .filter((dueDate) => !have.has(dueDate))
    .map((dueDate) => ({ dueDate, expectedAmountSatang: obligation.expectedAmountSatang }))
}

export interface RuleChangePlan {
  /** Future unpaid occurrences that no longer match the rule. */
  remove: ID[]
  /** Future unpaid occurrences on a still-valid date whose amount changed. */
  update: { id: ID; expectedAmountSatang: Satang }[]
  create: NewOccurrence[]
}

/**
 * After an edit: future unpaid occurrences follow the new rule; everything
 * else — paid, skipped and past (overdue) occurrences — is history and is
 * never touched. Unchanged occurrences keep their ids.
 *
 * Amounts: with `previousAmount` (the rule's amount before the edit), only
 * occurrences still at that amount follow the new one — a month whose amount
 * the user set by hand (the plan) keeps it. Occurrences planned beyond the
 * generation horizon are kept while their date is still on the rule.
 */
export function planRuleChange(obligation: ScheduleSource, existing: readonly ScheduledPayment[], today: ISODate, previousAmount?: Satang): RuleChangePlan {
  const isFutureUnpaid = (p: ScheduledPayment) => p.status === 'pending' && p.dueDate >= today
  const history = existing.filter((p) => !isFutureUnpaid(p))
  const futureUnpaid = existing.filter(isFutureUnpaid)

  const window = generationWindow(obligation, today)
  const wanted = window ? occurrencesBetween(obligation.recurrence, later(window.from, today), window.to) : []
  const lastPlanned = futureUnpaid.reduce((max, p) => (p.dueDate > max ? p.dueDate : max), window?.to ?? today)
  const onRule = new Set(window ? occurrencesBetween(obligation.recurrence, later(window.from, today), lastPlanned) : [])
  const historyDates = new Set(history.map((p) => p.dueDate))
  const futureByDate = new Map(futureUnpaid.map((p) => [p.dueDate, p]))
  const follows = (p: ScheduledPayment) => previousAmount === undefined || p.expectedAmountSatang === previousAmount

  return {
    remove: futureUnpaid.filter((p) => !onRule.has(p.dueDate)).map((p) => p.id),
    update: futureUnpaid
      .filter((p) => onRule.has(p.dueDate) && follows(p) && p.expectedAmountSatang !== obligation.expectedAmountSatang)
      .map((p) => ({ id: p.id, expectedAmountSatang: obligation.expectedAmountSatang })),
    create: wanted
      .filter((dueDate) => !futureByDate.has(dueDate) && !historyDates.has(dueDate))
      .map((dueDate) => ({ dueDate, expectedAmountSatang: obligation.expectedAmountSatang })),
  }
}

/** Pausing or deleting: future unpaid occurrences go; history stays. `all` also drops overdue unpaid ones. */
export function unpaidToRemove(existing: readonly ScheduledPayment[], today: ISODate, scope: 'future' | 'all'): ID[] {
  return existing.filter((p) => p.status === 'pending' && (scope === 'all' || p.dueDate >= today)).map((p) => p.id)
}

// ---------------------------------------------------------------------------
// Derived status
// ---------------------------------------------------------------------------

export type PaymentState = 'overdue' | 'due_soon' | 'pending' | 'paid' | 'skipped'

export function paymentState(payment: Pick<ScheduledPayment, 'status' | 'dueDate'>, today: ISODate): PaymentState {
  if (payment.status !== 'pending') return payment.status
  if (payment.dueDate < today) return 'overdue'
  return daysBetween(today, payment.dueDate) <= DUE_SOON_DAYS ? 'due_soon' : 'pending'
}

export function isOverdue(payment: Pick<ScheduledPayment, 'status' | 'dueDate'>, today: ISODate): boolean {
  return payment.status === 'pending' && payment.dueDate < today
}

/** Days past due (0 when not overdue). */
export function daysOverdue(payment: Pick<ScheduledPayment, 'status' | 'dueDate'>, today: ISODate): number {
  return isOverdue(payment, today) ? daysBetween(payment.dueDate, today) : 0
}

const byDue = (a: ScheduledPayment, b: ScheduledPayment) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id)

export interface ObligationStatus {
  /** The occurrence to act on: oldest overdue, else the next unpaid. */
  current?: ScheduledPayment
  state: PaymentState | 'none'
  overdueCount: number
  /** Most recent paid occurrence. */
  lastPaid?: ScheduledPayment
}

export function obligationStatus(payments: readonly ScheduledPayment[], today: ISODate): ObligationStatus {
  const sorted = [...payments].sort(byDue)
  const unpaid = sorted.filter((p) => p.status === 'pending')
  const overdue = unpaid.filter((p) => p.dueDate < today)
  const current = overdue[0] ?? unpaid[0]
  const lastPaid = sorted.filter((p) => p.status === 'paid').at(-1)
  return {
    current,
    state: current ? paymentState(current, today) : lastPaid ? 'paid' : 'none',
    overdueCount: overdue.length,
    lastPaid,
  }
}

// ---------------------------------------------------------------------------
// Monthly summary (obligations, not spending)
// ---------------------------------------------------------------------------

export interface ObligationMonthSummary {
  /** Expected amounts due this month (paid + unpaid; skipped excluded). */
  due: Satang
  /** Expected amounts of this month's occurrences already paid. */
  paid: Satang
  /** Expected amounts of this month's occurrences still unpaid. */
  outstanding: Satang
  /** Unpaid occurrences from earlier months (overdue). */
  overdueEarlier: Satang
  activeCount: number
}

export function monthlyObligationSummary(
  payments: readonly ScheduledPayment[],
  obligations: readonly RecurringObligation[],
  month: string,
  today: ISODate,
): ObligationMonthSummary {
  let due = ZERO
  let paid = ZERO
  let outstanding = ZERO
  let overdueEarlier = ZERO
  for (const p of payments) {
    if (p.dueDate.startsWith(`${month}-`)) {
      if (p.status === 'skipped') continue
      due = add(due, p.expectedAmountSatang)
      if (p.status === 'paid') paid = add(paid, p.expectedAmountSatang)
      else outstanding = add(outstanding, p.expectedAmountSatang)
    } else if (p.status === 'pending' && p.dueDate < `${month}-01` && p.dueDate < today) {
      overdueEarlier = add(overdueEarlier, p.expectedAmountSatang)
    }
  }
  return { due, paid, outstanding, overdueEarlier, activeCount: obligations.filter(isObligationActive).length }
}

export const dueSoonUntil = (today: ISODate) => addDays(today, DUE_SOON_DAYS)

/**
 * What kind of transaction settling this occurrence creates: bills are expenses;
 * debts (a debt-linked obligation or a debt installment) are debt payments —
 * never expenses, so a credit-card bill is not counted as spending twice;
 * expected income (salary…) is received as an income transaction.
 */
export function paymentTypeFor(
  payment: Pick<ScheduledPayment, 'sourceType' | 'sourceId'>,
  obligation?: Pick<RecurringObligation, 'debtId' | 'kind' | 'toAccountId'>,
): { type: EditableType; debtId?: ID; toAccountId?: ID } {
  if (payment.sourceType === 'debt') return { type: 'debt_payment', debtId: payment.sourceId }
  if (obligation?.kind === 'income') return { type: 'income' }
  if (obligation?.kind === 'transfer') return { type: 'transfer', toAccountId: obligation.toAccountId }
  if (obligation?.debtId) return { type: 'debt_payment', debtId: obligation.debtId }
  return { type: 'expense' }
}
