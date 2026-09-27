/**
 * Payoff ESTIMATE for a loan — never the contract's schedule and never used
 * for balances. Only produced when every input is known: outstanding
 * principal, interest method, annual rate (unless there is no interest) and
 * the monthly installment. Anything unknown → no estimate (no guessing).
 */
import type { Debt } from './entities'
import { add, multiplyRatio, subtract, ZERO, type Satang } from './money'

/** Estimates stop here (50 years); longer counts as "never paid off". */
export const MAX_ESTIMATE_MONTHS = 600

export type PayoffEstimate =
  | { kind: 'unavailable' }
  /** The installment does not even cover the monthly interest. */
  | { kind: 'never' }
  | { kind: 'estimate'; months: number; totalInterest: Satang; finalPayment: Satang }

export function estimatePayoff(
  debt: Pick<Debt, 'interestMethod' | 'annualInterestRateBps' | 'installmentSatang' | 'principalSatang'>,
  outstanding: Satang,
): PayoffEstimate {
  const installment = debt.installmentSatang
  if (!installment || installment <= 0 || outstanding < 0) return { kind: 'unavailable' }

  const monthlyInterest = (balance: Satang): Satang | null => {
    switch (debt.interestMethod) {
      case 'none':
        return ZERO
      case 'reducing_balance':
        return debt.annualInterestRateBps === undefined ? null : multiplyRatio(balance, debt.annualInterestRateBps, 12 * 10_000)
      case 'flat':
        // Flat rate: the same interest every month on the original principal — needs that principal.
        return debt.annualInterestRateBps === undefined || debt.principalSatang === undefined
          ? null
          : multiplyRatio(debt.principalSatang, debt.annualInterestRateBps, 12 * 10_000)
      case 'unknown':
        return null
    }
  }

  if (monthlyInterest(outstanding) === null) return { kind: 'unavailable' }
  if (outstanding === 0) return { kind: 'estimate', months: 0, totalInterest: ZERO, finalPayment: ZERO }

  let balance = outstanding
  let totalInterest = ZERO
  for (let month = 1; month <= MAX_ESTIMATE_MONTHS; month++) {
    const interest = monthlyInterest(balance)!
    if (installment <= interest) return { kind: 'never' }
    totalInterest = add(totalInterest, interest)
    const due = add(balance, interest)
    if (due <= installment) return { kind: 'estimate', months: month, totalInterest, finalPayment: due }
    balance = subtract(due, installment)
  }
  return { kind: 'never' }
}
