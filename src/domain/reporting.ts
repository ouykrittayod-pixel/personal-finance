/**
 * Reporting: pure aggregations used by the Dashboard (and later Analytics).
 *
 * Rules (see domain/transactions.ts):
 * - Income   = `income` transactions only.
 * - Expenses = `expense` transactions only. Debt payments are NEVER expenses —
 *   a credit-card purchase is counted once, when it is made.
 * - Debt payments are reported as their own series.
 * - Transfers and adjustments move money between/within accounts; they are
 *   neither income nor expense.
 * - Recurring obligations are not spending until paid; unpaid scheduled
 *   payments are reported as upcoming obligations.
 *
 * Dates are ISO strings, so month membership is a prefix check and ordering
 * is plain string comparison. All money is integer satang.
 */
import type { Account, Debt, ID, ISODate, ScheduledPayment, Transaction } from './entities'
import { compareNewestFirst } from './ledger'
import { debtPosition, isDebtActive, isRevolving, loanProgress, owedOf } from './debts'
import { accountEffects } from './transactions'
import { add, allocate, max, ratioBps, satang, sum, ZERO, type BasisPoints, type Satang } from './money'

/** "YYYY-MM". */
export type YearMonth = string

const inMonth = (date: ISODate, month: YearMonth) => date.startsWith(`${month}-`)

// ---------------------------------------------------------------------------
// Month totals
// ---------------------------------------------------------------------------

export interface MonthTotals {
  income: Satang
  incomeCount: number
  expense: Satang
  expenseCount: number
  debtPayment: Satang
  debtPaymentCount: number
}

export function monthTotals(transactions: readonly Transaction[], month: YearMonth): MonthTotals {
  let income = ZERO
  let expense = ZERO
  let debtPayment = ZERO
  let incomeCount = 0
  let expenseCount = 0
  let debtPaymentCount = 0
  for (const tx of transactions) {
    if (!inMonth(tx.date, month)) continue
    if (tx.type === 'income') {
      income = add(income, tx.amountSatang)
      incomeCount += 1
    } else if (tx.type === 'expense') {
      expense = add(expense, tx.amountSatang)
      expenseCount += 1
    } else if (tx.type === 'debt_payment') {
      debtPayment = add(debtPayment, tx.amountSatang)
      debtPaymentCount += 1
    }
  }
  return { income, incomeCount, expense, expenseCount, debtPayment, debtPaymentCount }
}

// ---------------------------------------------------------------------------
// Account balances & available money
// ---------------------------------------------------------------------------

/**
 * Current balance per account: opening balance + effects of every transaction
 * dated on/after the account's opening date. Liabilities are negative.
 */
export function accountBalances(accounts: readonly Account[], transactions: readonly Transaction[]): Map<ID, Satang> {
  const balances = new Map<ID, Satang>()
  const openingDates = new Map<ID, ISODate>()
  for (const account of accounts) {
    balances.set(account.id, account.openingBalanceSatang)
    openingDates.set(account.id, account.openingDate)
  }
  for (const tx of transactions) {
    for (const effect of accountEffects(tx)) {
      const current = balances.get(effect.accountId)
      const openingDate = openingDates.get(effect.accountId)
      if (current === undefined || openingDate === undefined || tx.date < openingDate) continue
      balances.set(effect.accountId, add(current, effect.deltaSatang))
    }
  }
  return balances
}

/** Account kinds counted as money you can spend now. Investments and liabilities are excluded. */
export const LIQUID_ACCOUNT_KINDS: ReadonlySet<Account['kind']> = new Set(['cash', 'bank', 'savings', 'e_wallet'])

export interface AvailableMoney {
  total: Satang
  accountCount: number
}

/** Sum of balances of open liquid asset accounts. Not profit — just what is in the accounts. */
/**
 * The one definition of "available money": active cash, bank, savings and
 * e-wallet accounts (not investment, cards, loans or archived accounts). With
 * `asOf`, accounts opened after that date are left out (pass balances as of it too).
 */
export function availableMoney(accounts: readonly Account[], balances: ReadonlyMap<ID, Satang>, asOf?: ISODate): AvailableMoney {
  const liquid = accounts.filter((a) => !a.archivedAt && LIQUID_ACCOUNT_KINDS.has(a.kind) && (asOf === undefined || a.openingDate <= asOf))
  return {
    total: sum(liquid.map((a) => balances.get(a.id) ?? a.openingBalanceSatang)),
    accountCount: liquid.length,
  }
}

// ---------------------------------------------------------------------------
// Spending by category
// ---------------------------------------------------------------------------

export const UNCATEGORIZED = '__uncategorized'
export const OTHER_CATEGORIES = '__other'

export interface CategorySpend {
  /** Category id, UNCATEGORIZED, or OTHER_CATEGORIES (grouped remainder). */
  key: string
  amount: Satang
  /** Share of total spending; shares of one breakdown always sum to exactly 10,000. */
  shareBps: BasisPoints
}

export interface SpendingBreakdown {
  total: Satang
  items: CategorySpend[]
}

/**
 * Expenses of a month grouped by category, largest first. When there are more
 * than `maxSlices` groups, the smallest are merged into OTHER_CATEGORIES.
 */
export function spendingByCategory(
  transactions: readonly Transaction[],
  month: YearMonth,
  maxSlices = Number.POSITIVE_INFINITY,
): SpendingBreakdown {
  const totals = new Map<string, Satang>()
  for (const tx of transactions) {
    if (tx.type !== 'expense' || !inMonth(tx.date, month)) continue
    const key = tx.categoryId ?? UNCATEGORIZED
    totals.set(key, add(totals.get(key) ?? ZERO, tx.amountSatang))
  }

  let groups = [...totals.entries()]
    .map(([key, amount]) => ({ key, amount }))
    .sort((a, b) => b.amount - a.amount || a.key.localeCompare(b.key))

  if (groups.length > maxSlices && maxSlices >= 2) {
    const kept = groups.slice(0, maxSlices - 1)
    const rest = sum(groups.slice(maxSlices - 1).map((g) => g.amount))
    groups = [...kept, { key: OTHER_CATEGORIES, amount: rest }]
  }

  const total = sum(groups.map((g) => g.amount))
  const shares = total > 0 ? allocate(satang(10_000), groups.map((g) => g.amount)) : groups.map(() => ZERO)
  return {
    total,
    items: groups.map((g, index) => ({ ...g, shareBps: shares[index] ?? 0 })),
  }
}

// ---------------------------------------------------------------------------
// Cash flow
// ---------------------------------------------------------------------------

export interface CashFlowPoint {
  month: YearMonth
  income: Satang
  expense: Satang
  debtPayment: Satang
  /** Money moved between own accounts (neither income nor spending). */
  transfer: Satang
}

/** Income, expense, debt-payment and transfer totals per month, in the order given. Separate series, never mixed. */
export function cashFlow(transactions: readonly Transaction[], months: readonly YearMonth[]): CashFlowPoint[] {
  const points = new Map<YearMonth, CashFlowPoint>(
    months.map((month) => [month, { month, income: ZERO, expense: ZERO, debtPayment: ZERO, transfer: ZERO }]),
  )
  for (const tx of transactions) {
    const point = points.get(tx.date.slice(0, 7))
    if (!point) continue
    if (tx.type === 'income') point.income = add(point.income, tx.amountSatang)
    else if (tx.type === 'expense') point.expense = add(point.expense, tx.amountSatang)
    else if (tx.type === 'debt_payment') point.debtPayment = add(point.debtPayment, tx.amountSatang)
    else if (tx.type === 'transfer') point.transfer = add(point.transfer, tx.amountSatang)
  }
  return months.map((month) => points.get(month)!)
}

// ---------------------------------------------------------------------------
// Upcoming payments
// ---------------------------------------------------------------------------

export type UpcomingStatus = 'overdue' | 'due_soon' | 'pending'

export interface UpcomingPayment {
  payment: ScheduledPayment
  status: UpcomingStatus
}

export interface UpcomingPaymentsOptions {
  today: ISODate
  /** Include unpaid payments due on or before this date (overdue ones are always included). */
  until: ISODate
  /** Payments due on or before this date (and not overdue) are "due soon". */
  dueSoonUntil: ISODate
}

export interface UpcomingPaymentsResult {
  items: UpcomingPayment[]
  total: Satang
  overdueCount: number
}

/** Unpaid scheduled payments due by `until`, earliest first, each classified by urgency. */
export function upcomingPayments(
  scheduled: readonly ScheduledPayment[],
  { today, until, dueSoonUntil }: UpcomingPaymentsOptions,
): UpcomingPaymentsResult {
  const items = scheduled
    .filter((p) => p.status === 'pending' && p.dueDate <= until)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id))
    .map((payment): UpcomingPayment => ({
      payment,
      status: payment.dueDate < today ? 'overdue' : payment.dueDate <= dueSoonUntil ? 'due_soon' : 'pending',
    }))
  return {
    items,
    total: sum(items.map((i) => i.payment.expectedAmountSatang)),
    overdueCount: items.filter((i) => i.status === 'overdue').length,
  }
}

// ---------------------------------------------------------------------------
// Debt summary
// ---------------------------------------------------------------------------

export interface DebtSummaryItem {
  debt: Debt
  /** Owed amount; null when unknown (e.g. a card whose account is missing). */
  outstanding: Satang | null
}

export interface DebtSummary {
  /** Sum owed across active debts (loans' principal + cards' liability) as of the date. */
  totalOutstanding: Satang
  activeCount: number
  /** Active debts, largest outstanding first. */
  items: DebtSummaryItem[]
  /** Repayment progress across loans with a known starting principal; null if none. */
  progress: { original: Satang; paid: Satang; paidBps: BasisPoints } | null
  /** Loan payments whose principal/interest split is unknown (they do not reduce principal). */
  unallocated: Satang
}

/**
 * Debt overview as of a date (default: all history). Loans use principal
 * accounting, cards their card-account liability (see domain/debts.ts) — so a
 * historical month shows that month's balance, not today's.
 */
export function debtSummary(
  debts: readonly Debt[],
  transactions: readonly Transaction[],
  accounts: readonly Account[],
  asOf?: ISODate,
): DebtSummary {
  // A debt not yet tracked on `asOf` (loan before its effective date, card before its account opened) is left out.
  const trackedFrom = (d: Debt) => (isRevolving(d) ? accounts.find((a) => a.id === d.linkedAccountId)?.openingDate : d.openingDate)
  const active = debts.filter(isDebtActive).filter((d) => {
    const from = trackedFrom(d)
    return asOf === undefined || from === undefined || from <= asOf
  })
  let original = ZERO
  let paid = ZERO
  let unallocated = ZERO
  const positions = active.map((debt) => {
    const position = debtPosition(debt, accounts, transactions, asOf)
    if (position.model === 'loan') {
      unallocated = add(unallocated, position.loan.unallocatedPaid)
      const progress = loanProgress(position.loan)
      if (progress) {
        original = add(original, progress.base)
        paid = add(paid, progress.paid)
      }
    }
    return position
  })
  const items = positions
    .map((p): DebtSummaryItem => ({ debt: p.debt, outstanding: p.outstanding === null ? null : max(ZERO, p.outstanding) }))
    .sort((a, b) => (b.outstanding ?? -1) - (a.outstanding ?? -1) || a.debt.name.localeCompare(b.debt.name))

  return {
    totalOutstanding: sum(positions.map(owedOf)),
    activeCount: active.length,
    items,
    progress: original > 0 ? { original, paid, paidBps: ratioBps(paid, original) } : null,
    unallocated,
  }
}

// ---------------------------------------------------------------------------
// Recent activity
// ---------------------------------------------------------------------------

/** Most recent transactions: by date, then by entry time, newest first. */
export function recentTransactions(transactions: readonly Transaction[], limit: number): Transaction[] {
  return [...transactions]
    .sort(compareNewestFirst)
    .slice(0, limit)
}
