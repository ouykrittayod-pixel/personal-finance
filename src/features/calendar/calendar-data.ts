/**
 * Calendar page data: a month-scoped loader over the existing repositories and
 * a pure view-model builder (domain/calendar does the financial logic).
 */
import { describeTransaction } from '@/components/finance/describe-transaction'
import {
  accountsRepository,
  categoriesRepository,
  debtsRepository,
  recurringObligationsRepository,
  scheduledPaymentsRepository,
  transactionsRepository,
} from '@/db/repositories'
import {
  buildCalendarItems,
  calendarTotals,
  groupByDay,
  matchesCalendarFilter,
  monthGrid,
  type CalendarFilter,
  type CalendarItem,
  type CalendarItemKind,
  type CalendarItemStatus,
  type CalendarTotals,
} from '@/domain/calendar'
import type { Account, Category, Debt, ID, ISODate, RecurringObligation, ScheduledPayment, Transaction } from '@/domain/entities'
import { formatMoney, type Satang } from '@/domain/money'
import { monthBounds } from '@/lib/dates'
import { APP_LOCALE, t, type MessageKey } from '@/lib/i18n'

export interface CalendarRawData {
  month: string
  /** Transactions dated in the month, plus any that paid an occurrence due in it. */
  transactions: Transaction[]
  /** Occurrences due in the month. */
  payments: ScheduledPayment[]
  obligations: RecurringObligation[]
  debts: Debt[]
  categories: Category[]
  accounts: Account[]
}

/** Only the selected month is read (by the date indexes); never attachment data. */
export async function loadCalendarData(month: string): Promise<CalendarRawData> {
  const { start, end } = monthBounds(month)
  const [transactions, payments, obligations, debts, categories, accounts] = await Promise.all([
    transactionsRepository.listBetween(start, end),
    scheduledPaymentsRepository.listBetween(start, end),
    recurringObligationsRepository.listAll(),
    debtsRepository.listAll(),
    categoriesRepository.listAll(),
    accountsRepository.listAll(),
  ])
  const have = new Set(transactions.map((tx) => tx.id))
  const missing = payments.flatMap((p) => (p.transactionId && !have.has(p.transactionId) ? [p.transactionId] : []))
  const linked = (await Promise.all(missing.map((id) => transactionsRepository.get(id)))).filter((tx): tx is Transaction => tx !== undefined)
  return { month, transactions: [...transactions, ...linked], payments, obligations, debts, categories, accounts }
}

export interface CalendarDay {
  date: ISODate
  inMonth: boolean
  isToday: boolean
  items: CalendarItem[]
}

export interface CalendarModel {
  month: string
  weeks: CalendarDay[][]
  /** Days of the month that have (filtered) items — the phone agenda. */
  agenda: { date: ISODate; isToday: boolean; items: CalendarItem[] }[]
  /** Month totals (independent of the filter). */
  totals: CalendarTotals
  itemCount: number
}

export function buildCalendarModel(raw: CalendarRawData, filter: CalendarFilter, today: ISODate): CalendarModel {
  const categories = new Map(raw.categories.map((c) => [c.id, c.name]))
  const accounts = new Map(raw.accounts.map((a) => [a.id, a.name]))
  const debts = new Map(raw.debts.map((d) => [d.id, d.name]))
  const all = buildCalendarItems(
    {
      transactions: raw.transactions,
      payments: raw.payments,
      obligations: raw.obligations,
      names: {
        category: (id) => categories.get(id),
        account: (id) => accounts.get(id),
        debt: (id) => debts.get(id),
        describe: (tx) =>
          describeTransaction(tx, {
            categoryName: tx.categoryId ? categories.get(tx.categoryId) : undefined,
            debtName: tx.debtId ? debts.get(tx.debtId) : undefined,
            toAccountName: tx.toAccountId ? accounts.get(tx.toAccountId) : undefined,
          }),
      },
    },
    raw.month,
    today,
  )
  const items = all.filter((item) => matchesCalendarFilter(item, filter))
  const byDay = new Map(groupByDay(items).map((d) => [d.date, d.items]))
  return {
    month: raw.month,
    weeks: monthGrid(raw.month).map((week) =>
      week.map((cell) => ({ ...cell, isToday: cell.date === today, items: cell.inMonth ? (byDay.get(cell.date) ?? []) : [] })),
    ),
    agenda: groupByDay(items).map((d) => ({ ...d, isToday: d.date === today })),
    totals: calendarTotals(raw, monthBounds(raw.month)),
    itemCount: items.length,
  }
}

/** Totals for one day (same rules as the month). */
export const dayTotals = (raw: CalendarRawData, date: ISODate) => calendarTotals(raw, { start: date, end: date })

/** Where an event opens: the existing detail views (no second detail system). */
export function linkFor(item: CalendarItem, obligations: readonly RecurringObligation[]): string {
  if (item.status === 'actual') return `/transactions?tx=${item.transactionId}`
  if (item.obligationId) {
    const rule = obligations.find((o) => o.id === item.obligationId)
    return rule?.kind === 'income' ? `/income?rule=${item.obligationId}` : `/recurring?id=${item.obligationId}`
  }
  if (item.debtId) return `/debts?id=${item.debtId}`
  return item.transactionId ? `/transactions?tx=${item.transactionId}` : '/recurring'
}

const KIND_LABEL: Record<CalendarItemKind, MessageKey> = {
  expense: 'calendar.kind.expense',
  income: 'calendar.kind.income',
  debt_payment: 'calendar.kind.debt_payment',
  transfer: 'calendar.kind.transfer',
  scheduled_expense: 'calendar.kind.scheduled_expense',
  scheduled_income: 'calendar.kind.scheduled_income',
  scheduled_debt: 'calendar.kind.scheduled_debt',
}

/** Status in words ("กำหนดจ่าย", "เลยกำหนด", "จ่ายแล้ว", "คาดว่าจะได้รับ", "ได้รับแล้ว"…). */
export function statusLabel(item: Pick<CalendarItem, 'kind' | 'status'>): string {
  if (item.status === 'actual') return t(KIND_LABEL[item.kind])
  const income = item.kind === 'scheduled_income'
  const debt = item.kind === 'scheduled_debt'
  const key: Record<Exclude<CalendarItemStatus, 'actual'>, MessageKey> = {
    upcoming: income ? 'calendar.status.expected' : debt ? 'calendar.status.dueDebt' : 'calendar.status.due',
    overdue: 'calendar.status.overdue',
    paid: income ? 'calendar.status.received' : debt ? 'calendar.status.paidDebt' : 'calendar.status.paid',
    skipped: 'calendar.status.skipped',
  }
  return t(key[item.status])
}

export const kindLabel = (kind: CalendarItemKind) => t(KIND_LABEL[kind])

const baht = (amount: Satang) => formatMoney(amount, { locale: APP_LOCALE, symbol: false, trimZeroFraction: true })

/** Screen-reader text: "รายจ่าย อาหาร 450 บาท", "กำหนดจ่าย อินเทอร์เน็ต 899 บาท เลยกำหนด". */
export function describeItem(item: CalendarItem): string {
  const tail = item.status === 'actual' ? '' : ` ${statusLabel(item)}`
  return `${kindLabel(item.kind)} ${item.title} ${baht(item.amountSatang)} บาท${tail}`
}

/** Money direction for display: + for income, − for money out, none for transfers. */
export const signOf = (kind: CalendarItemKind): 'in' | 'out' | 'move' =>
  kind === 'income' || kind === 'scheduled_income' ? 'in' : kind === 'transfer' ? 'move' : 'out'

export type { CalendarFilter, CalendarItem, ID }
