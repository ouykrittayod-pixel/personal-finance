/**
 * Plan page data: loader (repositories → raw) and the view model (rules in
 * domain/plan). Everything is local (IndexedDB), so one load covers every
 * month the page can show.
 */
import type { Account, Category, Debt, ISODate, RecurringObligation, ScheduledPayment, Transaction } from '@/domain/entities'
import { buildMonthPlan, monthsFrom, type MonthPlan } from '@/domain/plan'
import type { Satang } from '@/domain/money'
import {
  accountsRepository,
  categoriesRepository,
  debtsRepository,
  recurringObligationsRepository,
  scheduledPaymentsRepository,
  transactionsRepository,
} from '@/db/repositories'

export interface PlanRawData {
  obligations: RecurringObligation[]
  debts: Debt[]
  payments: ScheduledPayment[]
  transactions: Transaction[]
  accounts: Account[]
  categories: Category[]
}

export async function loadPlanData(): Promise<PlanRawData> {
  const [obligations, debts, payments, transactions, accounts, categories] = await Promise.all([
    recurringObligationsRepository.listAll(),
    debtsRepository.listAll(),
    scheduledPaymentsRepository.listAll(),
    transactionsRepository.listAll(),
    accountsRepository.listAll(),
    categoriesRepository.listAll(),
  ])
  return { obligations, debts, payments, transactions, accounts, categories }
}

/** How many months the "months ahead" strip shows (this month first). */
export const AHEAD_MONTHS = 6

export interface MonthSummary {
  month: string
  income: Satang
  outgoing: Satang
  remaining: Satang
}

export interface PlanModel {
  plan: MonthPlan
  ahead: MonthSummary[]
  /** No rules and no scheduled payments at all: show how to start. */
  empty: boolean
}

export function buildPlanModel(raw: PlanRawData, month: string, today: ISODate): PlanModel {
  const sources = { obligations: raw.obligations, debts: raw.debts, payments: raw.payments, transactions: raw.transactions }
  const ahead = monthsFrom(today.slice(0, 7), AHEAD_MONTHS).map((m): MonthSummary => {
    const { totals } = buildMonthPlan(sources, m, today)
    return { month: m, income: totals.income, outgoing: totals.outgoing, remaining: totals.remaining }
  })
  return {
    plan: buildMonthPlan(sources, month, today),
    ahead,
    empty: raw.obligations.every((o) => o.archivedAt) && raw.payments.length === 0,
  }
}
