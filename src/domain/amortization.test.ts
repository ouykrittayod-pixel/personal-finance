import { describe, expect, it } from 'vitest'
import { baht } from '@/test/factories'
import { estimatePayoff } from './amortization'

describe('estimatePayoff', () => {
  it('is unavailable when rate, method or installment is unknown', () => {
    expect(estimatePayoff({ interestMethod: 'unknown', annualInterestRateBps: 500, installmentSatang: baht(1_000) }, baht(10_000)).kind).toBe('unavailable')
    expect(estimatePayoff({ interestMethod: 'reducing_balance', installmentSatang: baht(1_000) }, baht(10_000)).kind).toBe('unavailable')
    expect(estimatePayoff({ interestMethod: 'reducing_balance', annualInterestRateBps: 500 }, baht(10_000)).kind).toBe('unavailable')
    expect(estimatePayoff({ interestMethod: 'flat', annualInterestRateBps: 500, installmentSatang: baht(1_000) }, baht(10_000)).kind).toBe('unavailable')
  })

  it('no interest: whole installments, last one smaller', () => {
    expect(estimatePayoff({ interestMethod: 'none', installmentSatang: baht(3_000) }, baht(10_000))).toEqual({
      kind: 'estimate',
      months: 4,
      totalInterest: 0,
      finalPayment: baht(1_000),
    })
  })

  it('reducing balance: interest on the remaining balance each month, in whole satang', () => {
    // 12% p.a. = 1% a month on ฿10,000 with ฿5,000 installments.
    const result = estimatePayoff({ interestMethod: 'reducing_balance', annualInterestRateBps: 1_200, installmentSatang: baht(5_000) }, baht(10_000))
    expect(result).toEqual({ kind: 'estimate', months: 3, totalInterest: baht(152.51), finalPayment: baht(152.51) })
  })

  it('never pays off when the installment does not cover the interest', () => {
    expect(estimatePayoff({ interestMethod: 'reducing_balance', annualInterestRateBps: 1_200, installmentSatang: baht(100) }, baht(10_000)).kind).toBe('never')
  })

  it('flat rate uses the original principal', () => {
    const result = estimatePayoff({ interestMethod: 'flat', annualInterestRateBps: 1_200, principalSatang: baht(12_000), installmentSatang: baht(1_120) }, baht(12_000))
    expect(result).toMatchObject({ kind: 'estimate', months: 12, totalInterest: baht(1_440) })
  })
})
