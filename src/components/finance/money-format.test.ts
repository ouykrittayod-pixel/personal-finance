import { describe, expect, it } from 'vitest'
import { satang } from '@/domain/money'
import { formatSignedMoney, MINUS_SIGN } from './money-format'

const baht = (value: number) => satang(value * 100)

describe('formatSignedMoney', () => {
  it('matches the design examples', () => {
    expect(formatSignedMoney(baht(27500), { tone: 'income' })).toBe('+฿27,500')
    expect(formatSignedMoney(baht(85), { tone: 'expense' })).toBe(`${MINUS_SIGN}฿85`)
    expect(formatSignedMoney(baht(2581670), { tone: 'debt' })).toBe('฿2,581,670')
    expect(formatSignedMoney(baht(3280))).toBe('฿3,280')
  })

  it('shows satang only when present, unless forced', () => {
    expect(formatSignedMoney(satang(8550), { tone: 'expense' })).toBe(`${MINUS_SIGN}฿85.50`)
    expect(formatSignedMoney(baht(85), { alwaysShowDecimals: true })).toBe('฿85.00')
  })

  it('shows a minus for negative neutral amounts and no sign for zero', () => {
    expect(formatSignedMoney(baht(-1200))).toBe(`${MINUS_SIGN}฿1,200`)
    expect(formatSignedMoney(satang(0), { tone: 'income' })).toBe('฿0')
  })

  it('supports forced signs without changing the magnitude', () => {
    expect(formatSignedMoney(baht(2500), { tone: 'debt', sign: 'minus' })).toBe(`${MINUS_SIGN}฿2,500`)
    expect(formatSignedMoney(baht(-40), { sign: 'plus' })).toBe('+฿40')
    expect(formatSignedMoney(baht(-40), { sign: 'none' })).toBe('฿40')
  })
})
