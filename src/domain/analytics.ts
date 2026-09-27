/**
 * Analytics: descriptive reporting built ONLY from the existing definitions —
 * monthTotals / spendingByCategory / cashFlow (reporting), debtPosition and
 * allocationOf (debts), calculateAccountBalance / calculateAvailableMoney
 * (accounts) and getMonthlyBudgetSummary (budget). Nothing here redefines
 * what income, spending or debt is:
 *   - expense = spending; income = income; debt payments are cash out but never
 *     expenses; transfers are neither; adjustments are not reported here;
 *   - a card purchase is an expense, paying the card is a debt payment;
 *   - scheduled / expected amounts are never actual.
 * No predictions, scores or advice — only deterministic facts and comparisons.
 */
import { calculateAccountBalance, calculateAvailableMoney, isLiquid } from './accounts'
import { getMonthlyBudgetSummary, type MonthlyBudgetSummary } from './budget'
import { allocationOf, debtPosition, isDebtActive, isRevolving } from './debts'
import type { Account, Budget, Debt, ID, ISODate, Transaction } from './entities'
import { add, ratioBps, subtract, sum, ZERO, type BasisPoints, type Satang } from './money'
import { monthTotals, spendingByCategory, type MonthTotals, type SpendingBreakdown } from './reporting'

const inMonth = (date: ISODate, month: string) => date.startsWith(`${month}-`)

// ---------------------------------------------------------------------------
// Month comparison
// ---------------------------------------------------------------------------

export interface Change {
  current: Satang
  previous: Satang
  /** current − previous */
  diff: Satang
  /** diff / previous in basis points (signed); null when the previous month is 0 (no infinite percentages). */
  changeBps: BasisPoints | null
}

export function change(current: Satang, previous: Satang): Change {
  const diff = subtract(current, previous)
  const magnitude = previous > 0 ? ratioBps(diff < 0 ? subtract(ZERO, diff) : diff, previous) : null
  return {
    current,
    previous,
    diff,
    changeBps: magnitude === null ? null : diff < 0 ? -magnitude : magnitude,
  }
}

export interface MonthComparison {
  income: Change
  expense: Change
  debtPayment: Change
  /** income − expense (debt payments are not expenses, so they are not subtracted). */
  leftFromIncome: Change
  /** Whether the previous month has any income/expense/debt-payment activity to compare with. */
  hasPrevious: boolean
}

export function getMonthComparison(transactions: readonly Transaction[], month: string, previousMonth: string): MonthComparison {
  const now = monthTotals(transactions, month)
  const before = monthTotals(transactions, previousMonth)
  return {
    income: change(now.income, before.income),
    expense: change(now.expense, before.expense),
    debtPayment: change(now.debtPayment, before.debtPayment),
    leftFromIncome: change(subtract(now.income, now.expense), subtract(before.income, before.expense)),
    hasPrevious: before.incomeCount + before.expenseCount + before.debtPaymentCount > 0,
  }
}

// ---------------------------------------------------------------------------
// Debts
// ---------------------------------------------------------------------------

export interface DebtMonthLine {
  debt: Debt
  /** Owed as of the date (loan principal / card liability); null = unknown. */
  outstanding: Satang | null
  /** Debt payments made to this debt in the month. */
  paid: Satang
  /** Loans: explicitly allocated parts of this month's payments. Cards carry no split. */
  principal: Satang
  interest: Satang
  fees: Satang
  /** Loan payments without a split (principal is never inferred from them). */
  unallocated: Satang
}

export interface DebtAnalytics {
  lines: DebtMonthLine[]
  totalOutstanding: Satang
  paid: Satang
  principal: Satang
  interestAndFees: Satang
  unallocated: Satang
}

export function getDebtAnalytics(
  debts: readonly Debt[],
  accounts: readonly Account[],
  transactions: readonly Transaction[],
  month: string,
  asOf: ISODate,
): DebtAnalytics {
  const lines = debts
    .filter((d) => isDebtActive(d) || transactions.some((tx) => tx.debtId === d.id && tx.type === 'debt_payment' && inMonth(tx.date, month)))
    .map((debt): DebtMonthLine => {
      const position = debtPosition(debt, accounts, transactions, asOf)
      const line: DebtMonthLine = {
        debt,
        outstanding: position.outstanding,
        paid: ZERO,
        principal: ZERO,
        interest: ZERO,
        fees: ZERO,
        unallocated: ZERO,
      }
      for (const tx of transactions) {
        if (tx.type !== 'debt_payment' || tx.debtId !== debt.id || !inMonth(tx.date, month)) continue
        line.paid = add(line.paid, tx.amountSatang)
        if (isRevolving(debt)) continue
        const split = allocationOf(tx)
        if (!split) line.unallocated = add(line.unallocated, tx.amountSatang)
        else {
          line.principal = add(line.principal, split.principal)
          line.interest = add(line.interest, split.interest)
          line.fees = add(line.fees, split.fee)
        }
      }
      return line
    })
    .sort((a, b) => (b.outstanding ?? -1) - (a.outstanding ?? -1) || a.debt.name.localeCompare(b.debt.name))
  return {
    lines,
    totalOutstanding: sum(lines.map((l) => (l.outstanding !== null && l.outstanding > 0 && isDebtActive(l.debt) ? l.outstanding : ZERO))),
    paid: sum(lines.map((l) => l.paid)),
    principal: sum(lines.map((l) => l.principal)),
    interestAndFees: sum(lines.map((l) => add(l.interest, l.fees))),
    unallocated: sum(lines.map((l) => l.unallocated)),
  }
}

// ---------------------------------------------------------------------------
// Cash position
// ---------------------------------------------------------------------------

export interface AccountPositionLine {
  account: Account
  balance: Satang
  /** 'available' counts in available money; 'card' is owed; 'other' (investment, other, loan) is shown apart. */
  group: 'available' | 'card' | 'other'
}

export interface CashPosition {
  /** Available money as of the date — the one existing definition. */
  available: Satang
  /** Available money at the previous month-end, when any counted account existed then. */
  previousAvailable: Satang | null
  lines: AccountPositionLine[]
}

export function getCashPosition(accounts: readonly Account[], transactions: readonly Transaction[], asOf: ISODate, previousAsOf: ISODate | null): CashPosition {
  const now = calculateAvailableMoney(accounts, transactions, asOf)
  const before = previousAsOf === null ? null : calculateAvailableMoney(accounts, transactions, previousAsOf)
  const lines = accounts
    .filter((a) => !a.archivedAt && a.openingDate <= asOf)
    .map((account): AccountPositionLine => {
      const balance = calculateAccountBalance(account, transactions, asOf) ?? ZERO
      const group = account.kind === 'credit_card' ? 'card' : isLiquid(account) ? 'available' : 'other'
      return { account, balance, group }
    })
  return {
    available: now.total,
    previousAvailable: before !== null && before.accountCount > 0 ? before.total : null,
    lines,
  }
}

// ---------------------------------------------------------------------------
// Recurring expenses
// ---------------------------------------------------------------------------

export interface RecurringExpenseSummary {
  /** Paid recurring bills of the month (expense transactions that settled a scheduled occurrence). */
  items: { sourceId: ID; amount: Satang; count: number }[]
  total: Satang
  /** All other expenses of the month. */
  other: Satang
}

/**
 * Only PAID occurrences are spending: an expense transaction created by paying
 * a scheduled occurrence (it carries scheduledPaymentId). Unpaid occurrences
 * are not expenses and are not counted. `sourceOf` maps an occurrence id to
 * its rule (obligation) id.
 */
export function getRecurringExpenseSummary(
  transactions: readonly Transaction[],
  month: string,
  sourceOf: (scheduledPaymentId: ID) => ID | undefined,
): RecurringExpenseSummary {
  const bySource = new Map<ID, { sourceId: ID; amount: Satang; count: number }>()
  let total = ZERO
  let all = ZERO
  for (const tx of transactions) {
    if (tx.type !== 'expense' || !inMonth(tx.date, month)) continue
    all = add(all, tx.amountSatang)
    const source = tx.scheduledPaymentId ? sourceOf(tx.scheduledPaymentId) : undefined
    if (!source) continue
    const entry = bySource.get(source) ?? {
      sourceId: source,
      amount: ZERO,
      count: 0,
    }
    entry.amount = add(entry.amount, tx.amountSatang)
    entry.count += 1
    bySource.set(source, entry)
    total = add(total, tx.amountSatang)
  }
  return {
    items: [...bySource.values()].sort((a, b) => b.amount - a.amount),
    total,
    other: subtract(all, total),
  }
}

// ---------------------------------------------------------------------------
// Insights (deterministic facts, never judgements or predictions)
// ---------------------------------------------------------------------------

export type Insight =
  | { kind: 'expense_change'; change: Change }
  | { kind: 'income_change'; change: Change }
  | {
      kind: 'top_category'
      categoryId: string
      amount: Satang
      shareBps: BasisPoints
    }
  | {
      kind: 'budget_used'
      categoryId: string
      usageBps: BasisPoints
      overBy: Satang
    }
  | {
      kind: 'budget_total'
      usageBps: BasisPoints
      scope: 'overall' | 'categories'
    }
  | {
      kind: 'debt_paid'
      paid: Satang
      principal: Satang
      interestAndFees: Satang
    }
  | { kind: 'recurring_share'; total: Satang; shareBps: BasisPoints }
  | { kind: 'available_change'; available: Satang; diff: Satang }

export interface InsightInput {
  totals: MonthTotals
  comparison: MonthComparison
  categories: SpendingBreakdown
  budget: MonthlyBudgetSummary
  debts: DebtAnalytics
  recurring: RecurringExpenseSummary
  cash: CashPosition
}

/**
 * Facts that are shown only when the data supports them: comparisons need a
 * previous month with activity; "top category" needs at least two categories;
 * budget lines need a budget; debt lines need payments.
 */
export function buildFinancialInsights(input: InsightInput): Insight[] {
  const out: Insight[] = []
  const { totals, comparison, categories, budget, debts, recurring, cash } = input
  if (comparison.hasPrevious && (totals.expense > 0 || comparison.expense.previous > 0)) out.push({ kind: 'expense_change', change: comparison.expense })
  if (comparison.hasPrevious && (totals.income > 0 || comparison.income.previous > 0)) out.push({ kind: 'income_change', change: comparison.income })
  if (categories.items.length >= 2) {
    const [top] = categories.items
    out.push({
      kind: 'top_category',
      categoryId: top!.key,
      amount: top!.amount,
      shareBps: top!.shareBps,
    })
  }
  const headline = budget.overall ?? (budget.categories.length > 0 ? { usageBps: budget.categoryTotals.usageBps } : null)
  if (headline && headline.usageBps !== null)
    out.push({
      kind: 'budget_total',
      usageBps: headline.usageBps,
      scope: budget.overall ? 'overall' : 'categories',
    })
  for (const line of budget.categories) {
    if (line.status === 'over_budget' && line.usageBps !== null)
      out.push({
        kind: 'budget_used',
        categoryId: line.budget.categoryId,
        usageBps: line.usageBps,
        overBy: line.overBy,
      })
  }
  if (debts.paid > 0)
    out.push({
      kind: 'debt_paid',
      paid: debts.paid,
      principal: debts.principal,
      interestAndFees: debts.interestAndFees,
    })
  if (recurring.total > 0 && totals.expense > 0)
    out.push({
      kind: 'recurring_share',
      total: recurring.total,
      shareBps: ratioBps(recurring.total, totals.expense),
    })
  if (cash.previousAvailable !== null)
    out.push({
      kind: 'available_change',
      available: cash.available,
      diff: subtract(cash.available, cash.previousAvailable),
    })
  return out
}

/** Everything the page needs for one month, from already-loaded records. */
export function getMonthlyAnalytics(input: {
  transactions: readonly Transaction[]
  accounts: readonly Account[]
  debts: readonly Debt[]
  budgets: readonly Budget[]
  month: string
  previousMonth: string
  asOf: ISODate
  /** null when there is nothing to compare with yet (a month that has not started). */
  previousAsOf: ISODate | null
  sourceOf: (scheduledPaymentId: ID) => ID | undefined
}) {
  const totals = monthTotals(input.transactions, input.month)
  const comparison = getMonthComparison(input.transactions, input.month, input.previousMonth)
  const categories = spendingByCategory(input.transactions, input.month)
  const budget = getMonthlyBudgetSummary(input.budgets, input.transactions, input.month)
  const debts = getDebtAnalytics(input.debts, input.accounts, input.transactions, input.month, input.asOf)
  const recurring = getRecurringExpenseSummary(input.transactions, input.month, input.sourceOf)
  const cash = getCashPosition(input.accounts, input.transactions, input.asOf, input.previousAsOf)
  return {
    totals,
    comparison,
    categories,
    budget,
    debts,
    recurring,
    cash,
    insights: buildFinancialInsights({
      totals,
      comparison,
      categories,
      budget,
      debts,
      recurring,
      cash,
    }),
  }
}
export type MonthlyAnalytics = ReturnType<typeof getMonthlyAnalytics>
