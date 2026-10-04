/**
 * The monthly plan: what is expected to come in, what has to go out, and what
 * is left — the "คงเหลือ" line of a budgeting sheet, built from the app's own
 * rules and scheduled payments. Pure: no storage, no clock.
 *
 *   income   = expected income of the month (received: actual amount; else expected)
 *   outgoing = bills + debt payments + planned transfers of the month (paid: actual; else expected)
 *   remaining = income − outgoing
 *
 * Planning the current month also carries over what is still unpaid (or not yet
 * received) from earlier months, so nothing overdue drops out of the picture.
 *
 * Months further ahead than the app has generated yet are projected from the
 * rules (marked `projected`, never stored here), so any future month can be
 * planned. A projected month becomes a real occurrence when the app generates
 * it, or when the user sets its amount.
 */
import { debtScheduleSource } from './debts'
import type { Debt, ID, ISODate, RecurringObligation, ScheduledPayment, ScheduledPaymentSource, Transaction } from './entities'
import { add, subtract, ZERO, type Satang } from './money'
import { daysInMonth, occurrencesBetween } from './recurrence'
import { generationWindow, obligationKind, type ScheduleSource } from './scheduling'

export type PlanGroup = 'income' | 'bill' | 'debt' | 'transfer'
export type PlanStatus = 'paid' | 'pending' | 'overdue' | 'skipped' | 'projected'

export interface PlanItem {
  /** Stable key: the occurrence id, or "proj:<sourceType>:<sourceId>:<dueDate>" for a projected month. */
  key: string
  sourceType: ScheduledPaymentSource
  sourceId: ID
  dueDate: ISODate
  name: string
  group: PlanGroup
  status: PlanStatus
  /** The planned amount. */
  expectedSatang: Satang
  /** Paid / received: what actually moved. */
  actualSatang?: Satang
  /** What the item counts in the totals: actual when paid, nothing when skipped, else the planned amount. */
  amountSatang: Satang
  /** The stored occurrence (absent when projected). */
  paymentId?: ID
  /** The planned amount differs from the rule's usual amount (set for this month). */
  adjusted: boolean
  /** The rule's amount changes month to month (electricity…): the plan is an estimate until the bill arrives. */
  variable: boolean
  /** Unpaid from an earlier month, carried into the current month's plan. */
  carriedOver: boolean
  categoryId?: ID
  debtId?: ID
  toAccountId?: ID
}

export interface MonthPlanTotals {
  income: Satang
  incomeReceived: Satang
  incomeExpected: Satang
  outgoing: Satang
  outgoingPaid: Satang
  outgoingUnpaid: Satang
  /** income − outgoing (may be negative: the month is short). */
  remaining: Satang
  /** Expenses recorded in the month that no plan item covers (daily spending). */
  otherSpending: Satang
  /** remaining − otherSpending. */
  remainingAfterSpending: Satang
}

export interface MonthPlan {
  month: string
  income: PlanItem[]
  outgoing: PlanItem[]
  totals: MonthPlanTotals
}

export interface PlanSources {
  obligations: readonly RecurringObligation[]
  debts: readonly Debt[]
  /** Scheduled payments: at least those due in the month, plus unpaid ones before it. */
  payments: readonly ScheduledPayment[]
  /** Transactions that paid occurrences (for the actual amounts), and the month's own transactions. */
  transactions: readonly Pick<Transaction, 'id' | 'type' | 'date' | 'amountSatang' | 'scheduledPaymentId'>[]
}

const monthStart = (month: string): ISODate => `${month}-01`
const monthEnd = (month: string): ISODate => `${month}-${String(daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)))).padStart(2, '0')}`
const later = (a: ISODate, b: ISODate) => (a > b ? a : b)
const byDue = (a: PlanItem, b: PlanItem) => Number(b.carriedOver) - Number(a.carriedOver) || a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name)

interface Source {
  name: string
  group: PlanGroup
  rule: ScheduleSource | null
  usualAmount: Satang
  variable: boolean
  categoryId?: ID
  debtId?: ID
  toAccountId?: ID
}

function sourcesOf(sources: PlanSources): Map<string, Source> {
  const map = new Map<string, Source>()
  for (const o of sources.obligations) {
    const kind = obligationKind(o)
    map.set(`obligation|${o.id}`, {
      name: o.name,
      group: kind,
      rule: o,
      usualAmount: o.expectedAmountSatang,
      variable: o.variableAmount,
      categoryId: o.categoryId,
      debtId: o.debtId,
      toAccountId: o.toAccountId,
    })
  }
  for (const d of sources.debts) {
    const rule = debtScheduleSource(d)
    map.set(`debt|${d.id}`, { name: d.name, group: 'debt', rule, usualAmount: d.installmentSatang ?? ZERO, variable: false, debtId: d.id })
  }
  return map
}

/** The plan of one month ("YYYY-MM"), as seen on `today`. */
export function buildMonthPlan(sources: PlanSources, month: string, today: ISODate): MonthPlan {
  const start = monthStart(month)
  const end = monthEnd(month)
  const currentMonth = today.slice(0, 7)
  const isCurrent = month === currentMonth
  const bySource = sourcesOf(sources)
  const paidBy = new Map(sources.transactions.filter((tx) => tx.scheduledPaymentId).map((tx) => [tx.scheduledPaymentId!, tx]))
  const items: PlanItem[] = []
  const stored = new Set<string>()

  for (const p of sources.payments) {
    const inMonth = p.dueDate >= start && p.dueDate <= end
    const carried = isCurrent && p.status === 'pending' && p.dueDate < start
    if (inMonth) stored.add(`${p.sourceType}|${p.sourceId}|${p.dueDate}`)
    if (!inMonth && !carried) continue
    const source = bySource.get(`${p.sourceType}|${p.sourceId}`)
    if (!source) continue
    const tx = p.status === 'paid' ? paidBy.get(p.id) : undefined
    const actual = p.status === 'paid' ? (tx?.amountSatang ?? p.expectedAmountSatang) : undefined
    items.push({
      key: p.id,
      sourceType: p.sourceType,
      sourceId: p.sourceId,
      dueDate: p.dueDate,
      name: source.name,
      group: source.group,
      status: p.status === 'pending' ? (p.dueDate < today ? 'overdue' : 'pending') : p.status,
      expectedSatang: p.expectedAmountSatang,
      ...(actual !== undefined ? { actualSatang: actual } : {}),
      amountSatang: p.status === 'skipped' ? ZERO : (actual ?? p.expectedAmountSatang),
      paymentId: p.id,
      adjusted: p.status === 'pending' && p.expectedAmountSatang !== source.usualAmount,
      variable: source.variable,
      carriedOver: carried,
      ...(source.categoryId ? { categoryId: source.categoryId } : {}),
      ...(source.debtId ? { debtId: source.debtId } : {}),
      ...(source.toAccountId ? { toAccountId: source.toAccountId } : {}),
    })
  }

  // Months the app has not generated yet: project from the rules (never the past).
  if (month >= currentMonth) {
    for (const [key, source] of bySource) {
      if (!source.rule) continue
      const window = generationWindow(source.rule, today)
      if (!window) continue
      const from = later(later(window.from, start), monthStart(currentMonth))
      const [sourceType, sourceId] = key.split('|') as [ScheduledPaymentSource, ID]
      for (const dueDate of occurrencesBetween(source.rule.recurrence, from, end)) {
        if (stored.has(`${key}|${dueDate}`)) continue
        items.push({
          key: `proj:${sourceType}:${sourceId}:${dueDate}`,
          sourceType,
          sourceId,
          dueDate,
          name: source.name,
          group: source.group,
          status: 'projected',
          expectedSatang: source.usualAmount,
          amountSatang: source.usualAmount,
          adjusted: false,
          variable: source.variable,
          carriedOver: false,
          ...(source.categoryId ? { categoryId: source.categoryId } : {}),
          ...(source.debtId ? { debtId: source.debtId } : {}),
          ...(source.toAccountId ? { toAccountId: source.toAccountId } : {}),
        })
      }
    }
  }

  const income = items.filter((i) => i.group === 'income').sort(byDue)
  const outgoing = items.filter((i) => i.group !== 'income').sort(byDue)
  const total = (list: PlanItem[], keep: (i: PlanItem) => boolean = () => true) => list.filter(keep).reduce((sum, i) => add(sum, i.amountSatang), ZERO)
  const settled = (i: PlanItem) => i.status === 'paid'
  const open = (i: PlanItem) => i.status !== 'paid' && i.status !== 'skipped'

  const plannedTx = new Set(sources.payments.map((p) => p.transactionId).filter((id): id is ID => id !== undefined))
  const otherSpending = sources.transactions
    .filter((tx) => tx.type === 'expense' && tx.date >= start && tx.date <= end && !tx.scheduledPaymentId && !plannedTx.has(tx.id))
    .reduce((sum, tx) => add(sum, tx.amountSatang), ZERO)

  const incomeTotal = total(income)
  const outgoingTotal = total(outgoing)
  const remaining = subtract(incomeTotal, outgoingTotal)
  return {
    month,
    income,
    outgoing,
    totals: {
      income: incomeTotal,
      incomeReceived: total(income, settled),
      incomeExpected: total(income, open),
      outgoing: outgoingTotal,
      outgoingPaid: total(outgoing, settled),
      outgoingUnpaid: total(outgoing, open),
      remaining,
      otherSpending,
      remainingAfterSpending: subtract(remaining, otherSpending),
    },
  }
}

/** Months from `first` on, `count` of them ("YYYY-MM"). */
export function monthsFrom(first: string, count: number): string[] {
  const [year, month] = first.split('-').map(Number) as [number, number]
  return Array.from({ length: count }, (_, i) => {
    const index = year * 12 + (month - 1) + i
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
  })
}
