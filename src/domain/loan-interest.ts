/**
 * Daily interest on a reducing-balance loan — the way Thai lenders (and the
 * user's own loan sheets) compute an installment:
 *
 *   interest = interest-bearing principal × annual rate × days ÷ days in year
 *
 * - interest-bearing principal: opening balance + principal adjustments that
 *   bear interest − principal already repaid (before this payment). Amounts the
 *   lender carries without interest (accrued interest, court fees…) are
 *   adjustments with `interestBearing: false`: they are owed, but never earn
 *   interest.
 * - days: from the previous payment (or the loan's start) to this payment.
 * - days in year: 365, or 366 when this payment falls in a leap year.
 * - rounded to the satang (half-up) at each payment.
 *
 * Whatever is paid beyond the interest goes to principal — so paying more than
 * the installment repays principal faster. A suggestion only: the form fills
 * it in and the user can still type what the receipt says. Pure.
 */
import type { Debt, ID, ISODate, Transaction } from './entities'
import { allocationOf } from './debts'
import { add, multiplyRatio, subtract, ZERO, type Satang } from './money'

export interface DailyInterestSplit {
  principal: Satang
  interest: Satang
  /** Principal the interest was charged on. */
  base: Satang
  days: number
  daysInYear: number
  /** Previous payment date, or the loan's start when this is the first payment. */
  from: ISODate
}

const DAY_MS = 86_400_000
const toUTC = (date: ISODate) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))
const daysBetween = (from: ISODate, to: ISODate) => Math.round((toUTC(to) - toUTC(from)) / DAY_MS)
export const daysInYear = (date: ISODate) => {
  const year = Number(date.slice(0, 4))
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365
}

/** Loans whose interest can be computed: reducing balance with a known rate. */
export const hasDailyInterest = (debt: Pick<Debt, 'kind' | 'interestMethod' | 'annualInterestRateBps'>) =>
  debt.kind !== 'credit_card' && debt.interestMethod === 'reducing_balance' && debt.annualInterestRateBps !== undefined

/**
 * Split a payment of `amountSatang` on `date` into interest and principal.
 * `excludeId` leaves out the payment being edited. Null when the debt has no
 * computable interest or the inputs are not usable.
 */
export function dailyInterestSplit(
  debt: Debt,
  transactions: readonly Transaction[],
  payment: { date: ISODate; amountSatang: Satang; excludeId?: ID },
): DailyInterestSplit | null {
  if (!hasDailyInterest(debt) || !/^\d{4}-\d{2}-\d{2}$/.test(payment.date) || payment.amountSatang < 0) return null
  const start = debt.startDate ?? debt.openingDate
  if (payment.date < debt.openingDate || payment.date < start) return null

  const earlier = transactions.filter(
    (tx) => tx.type === 'debt_payment' && tx.debtId === debt.id && tx.id !== payment.excludeId && tx.date >= debt.openingDate && tx.date <= payment.date,
  )
  let repaid = ZERO
  let from = start
  for (const tx of earlier) {
    repaid = add(repaid, allocationOf(tx)?.principal ?? ZERO)
    if (tx.date > from) from = tx.date
  }
  const bearing = (debt.principalAdjustments ?? [])
    .filter((a) => a.interestBearing !== false && a.date >= debt.openingDate && a.date <= payment.date)
    .reduce((total, a) => add(total, a.amountSatang), ZERO)
  const owed = subtract(add(debt.openingBalanceSatang, bearing), repaid)
  const base = owed > 0 ? owed : ZERO

  const days = daysBetween(from, payment.date)
  const yearDays = daysInYear(payment.date)
  const computed = multiplyRatio(base, debt.annualInterestRateBps! * days, 10_000 * yearDays)
  const interest = computed < payment.amountSatang ? computed : payment.amountSatang
  return { principal: subtract(payment.amountSatang, interest), interest, base, days, daysInYear: yearDays, from }
}
