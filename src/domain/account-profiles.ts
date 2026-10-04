/**
 * What an account's page shows beyond its balance, by kind. Pure.
 *
 * Credit card: limit, used (= owed), available, how much of the limit is used,
 * the billing cycle (statement day → due day) and the spending in it.
 *
 * Investment: current value (the balance, kept up to date with
 * "อัปเดตมูลค่า" adjustments), the money put in (opening + transfers in −
 * transfers out), gain or loss against it, returns received (income), fees
 * (expenses), how much was invested this month / year and the planned
 * transfers (DCA) into it.
 */
import { accountActivity, calculateAccountBalance } from './accounts'
import type { Account, Debt, ID, ISODate, RecurringObligation, Transaction } from './entities'
import { add, negate, ratioBps, subtract, ZERO, type Satang } from './money'
import { addDays, addMonthsClamped, daysInMonth, nextOccurrenceOnOrAfter } from './recurrence'
import { isObligationActive } from './scheduling'

/** The date with day-of-month `day` in the month of `date`, clamped to the month's last day. */
function dayInMonth(date: ISODate, day: number): ISODate {
  const year = Number(date.slice(0, 4))
  const month = Number(date.slice(5, 7))
  return `${date.slice(0, 7)}-${String(Math.min(day, daysInMonth(year, month))).padStart(2, '0')}`
}

/** The first date on or after `from` whose day of month is `day` (clamped in short months). */
export function nextDayOfMonth(from: ISODate, day: number): ISODate {
  const thisMonth = dayInMonth(from, day)
  return thisMonth >= from ? thisMonth : dayInMonth(addMonthsClamped(`${from.slice(0, 7)}-01`, 1), day)
}

export interface CreditCardProfile {
  limit?: Satang
  /** What is owed now (positive). Zero when the card is in credit. */
  used: Satang
  /** Money owed to the user by the card (overpaid), if any. */
  inCredit: Satang
  /** limit − used (may be negative when over the limit). */
  available?: Satang
  /** Share of the limit used, in basis points. */
  usedBps?: number
  statementDay?: number
  paymentDueDay?: number
  /** Current billing cycle (after the last statement date, up to the next one). */
  cycle?: { start: ISODate; end: ISODate; spending: Satang; count: number }
  /** The next payment due date (from the due day). */
  nextDueDate?: ISODate
  /** Purchases this calendar month (always shown; the cycle may not be set). */
  spendingThisMonth: Satang
  /** The linked debt's latest statement (if statements are recorded). */
  lastStatement?: { statementDate: ISODate; balance: Satang; minimumDue?: Satang; dueDate: ISODate }
  /** The planned card payment (a recurring rule paying the linked debt). */
  plannedPayment?: { name: string; amount: Satang; nextDate: ISODate | null }
}

export function creditCardProfile(
  account: Account,
  transactions: readonly Transaction[],
  context: { debts: readonly Debt[]; obligations: readonly RecurringObligation[] },
  today: ISODate,
): CreditCardProfile {
  const balance = calculateAccountBalance(account, transactions) ?? ZERO
  const used = balance < 0 ? negate(balance) : ZERO
  const inCredit = balance > 0 ? balance : ZERO
  const limit = account.creditLimitSatang
  const purchases = transactions.filter((tx) => tx.type === 'expense' && tx.accountId === account.id)
  const monthStart = `${today.slice(0, 7)}-01`
  const spendingThisMonth = purchases.filter((tx) => tx.date >= monthStart && tx.date <= today).reduce((sum, tx) => add(sum, tx.amountSatang), ZERO)

  let cycle: CreditCardProfile['cycle']
  if (account.statementDay) {
    const end = nextDayOfMonth(today, account.statementDay)
    const previous = dayInMonth(addMonthsClamped(`${end.slice(0, 7)}-01`, -1), account.statementDay)
    const start = addDays(previous, 1)
    const inCycle = purchases.filter((tx) => tx.date >= start && tx.date <= end)
    cycle = { start, end, spending: inCycle.reduce((sum, tx) => add(sum, tx.amountSatang), ZERO), count: inCycle.length }
  }

  const debt = context.debts.find((d) => d.linkedAccountId === account.id && !d.archivedAt)
  const latest = debt?.statements?.slice().sort((a, b) => b.statementDate.localeCompare(a.statementDate))[0]
  const rule = debt ? context.obligations.find((o) => o.debtId === debt.id && !o.archivedAt && isObligationActive(o)) : undefined

  return {
    ...(limit ? { limit, available: subtract(limit, used), usedBps: ratioBps(used, limit) } : {}),
    used,
    inCredit,
    ...(account.statementDay ? { statementDay: account.statementDay } : {}),
    ...(account.paymentDueDay ? { paymentDueDay: account.paymentDueDay, nextDueDate: nextDayOfMonth(today, account.paymentDueDay) } : {}),
    ...(cycle ? { cycle } : {}),
    spendingThisMonth,
    ...(latest
      ? { lastStatement: { statementDate: latest.statementDate, balance: latest.balanceSatang, ...(latest.minimumDueSatang !== undefined ? { minimumDue: latest.minimumDueSatang } : {}), dueDate: latest.dueDate } }
      : {}),
    ...(rule ? { plannedPayment: { name: rule.name, amount: rule.expectedAmountSatang, nextDate: nextOccurrenceOnOrAfter(rule.recurrence, today) } } : {}),
  }
}

export interface InvestmentProfile {
  value: Satang
  /** Opening value + transfers in − transfers out: the money put in. */
  invested: Satang
  /** value − invested. */
  gain: Satang
  /** gain / invested in basis points (absent when nothing was put in). */
  gainBps?: number
  /** Dividends / interest recorded as income into the account. */
  returns: Satang
  /** Fees recorded as expenses from the account. */
  fees: Satang
  /** Value changes recorded with "อัปเดตมูลค่า" (adjustments). */
  valueChanges: Satang
  /** When the value was last updated (latest adjustment), if ever. */
  lastValuedOn?: ISODate
  investedThisMonth: Satang
  investedThisYear: Satang
  /** Planned transfers into this account (DCA, savings), next date first. */
  plans: { id: ID; name: string; amount: Satang; nextDate: ISODate | null; paused: boolean }[]
}

export function investmentProfile(account: Account, transactions: readonly Transaction[], obligations: readonly RecurringObligation[], today: ISODate): InvestmentProfile {
  const value = calculateAccountBalance(account, transactions) ?? ZERO
  const activity = accountActivity(account, transactions)
  const invested = subtract(add(account.openingBalanceSatang, activity.transfersIn), activity.transfersOut)
  const gain = subtract(value, invested)
  const transfersIn = transactions.filter((tx) => tx.type === 'transfer' && tx.toAccountId === account.id)
  const sumSince = (from: ISODate) => transfersIn.filter((tx) => tx.date >= from && tx.date <= today).reduce((sum, tx) => add(sum, tx.amountSatang), ZERO)
  const lastAdjustment = transactions
    .filter((tx) => tx.type === 'adjustment' && tx.accountId === account.id)
    .map((tx) => tx.date)
    .sort()
    .at(-1)
  const plans = obligations
    .filter((o) => o.kind === 'transfer' && o.toAccountId === account.id && !o.archivedAt)
    .map((o) => ({ id: o.id, name: o.name, amount: o.expectedAmountSatang, nextDate: o.pausedAt ? null : nextOccurrenceOnOrAfter(o.recurrence, today), paused: Boolean(o.pausedAt) }))
    .sort((a, b) => (a.nextDate ?? '9999').localeCompare(b.nextDate ?? '9999'))

  return {
    value,
    invested,
    gain,
    ...(invested > 0 ? { gainBps: ratioBps(gain, invested) } : {}),
    returns: activity.incomeIn,
    fees: activity.expensesOut,
    valueChanges: activity.adjustments,
    ...(lastAdjustment ? { lastValuedOn: lastAdjustment } : {}),
    investedThisMonth: sumSince(`${today.slice(0, 7)}-01`),
    investedThisYear: sumSince(`${today.slice(0, 4)}-01-01`),
    plans,
  }
}
