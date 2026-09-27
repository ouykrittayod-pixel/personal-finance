import { describe, expect, it } from 'vitest'
import {
  MoneyError,
  abs,
  add,
  allocate,
  compare,
  formatMoney,
  fromBaht,
  max,
  min,
  multiply,
  multiplyRatio,
  negate,
  parseBaht,
  percentOf,
  ratioBps,
  satang,
  subtract,
  sum,
  toDecimalString,
  tryParseBaht,
} from './money'

describe('construction', () => {
  it('accepts integer satang only', () => {
    expect(satang(12345)).toBe(12345)
    expect(() => satang(1.5)).toThrow(MoneyError)
    expect(() => satang(Number.NaN)).toThrow(MoneyError)
    expect(() => satang(Number.MAX_SAFE_INTEGER + 1)).toThrow(MoneyError)
  })

  it('normalises negative zero', () => {
    expect(Object.is(satang(-0), 0)).toBe(true)
  })

  it('converts whole baht to satang', () => {
    expect(fromBaht(25)).toBe(2500)
    expect(() => fromBaht(0.1)).toThrow(MoneyError)
  })
})

describe('parseBaht', () => {
  it.each([
    ['0', 0],
    ['1', 100],
    ['1.5', 150],
    ['1.05', 105],
    ['0.01', 1],
    ['.5', 50],
    ['-.5', -50],
    ['1,234.56', 123456],
    ['  1 234.50 ', 123450],
    ['฿1,000', 100000],
    ['1000 บาท', 100000],
    ['1000THB', 100000],
    ['-12.34', -1234],
    ['+7', 700],
    ['10.', 1000],
  ])('parses %j → %i satang', (input, expected) => {
    expect(parseBaht(input)).toBe(expected)
  })

  it.each(['', ' ', 'abc', '1.234', '1e3', '12.3.4', '--1', '1-', 'NaN', 'Infinity'])(
    'rejects %j',
    (input) => {
      expect(() => parseBaht(input)).toThrow(MoneyError)
      expect(tryParseBaht(input)).toBeNull()
    },
  )

  it('avoids the classic floating-point trap (0.1 + 0.2)', () => {
    expect(add(parseBaht('0.1'), parseBaht('0.2'))).toBe(parseBaht('0.3'))
  })

  it('handles amounts that lose precision as floats', () => {
    expect(parseBaht('1.15')).toBe(115) // 1.15 * 100 = 114.99999999999999 as a float
    expect(parseBaht('4.35')).toBe(435) // 4.35 * 100 = 434.99999999999994
  })
})

describe('arithmetic', () => {
  it('adds, subtracts, negates', () => {
    expect(add(satang(150), satang(250))).toBe(400)
    expect(subtract(satang(150), satang(250))).toBe(-100)
    expect(negate(satang(150))).toBe(-150)
    expect(abs(satang(-150))).toBe(150)
  })

  it('sums a list', () => {
    expect(sum([])).toBe(0)
    expect(sum([satang(10), satang(20), satang(-5)])).toBe(25)
  })

  it('multiplies by integer quantities only', () => {
    expect(multiply(satang(1999), 3)).toBe(5997)
    expect(() => multiply(satang(100), 1.5)).toThrow(MoneyError)
  })

  it('throws on overflow instead of silently losing precision', () => {
    expect(() => add(satang(Number.MAX_SAFE_INTEGER), satang(1))).toThrow(MoneyError)
    expect(() => multiply(satang(Number.MAX_SAFE_INTEGER), 2)).toThrow(MoneyError)
  })
})

describe('multiplyRatio / percentOf rounding', () => {
  it('computes 7% VAT with half-up rounding', () => {
    expect(percentOf(parseBaht('100'), 700)).toBe(700)
    expect(percentOf(satang(1050), 700)).toBe(74) // 73.5 → 74
  })

  it('supports each rounding mode', () => {
    // 5 × 1 / 2 = 2.5
    expect(multiplyRatio(satang(5), 1, 2, 'half-up')).toBe(3)
    expect(multiplyRatio(satang(5), 1, 2, 'half-even')).toBe(2)
    expect(multiplyRatio(satang(7), 1, 2, 'half-even')).toBe(4) // 3.5 → 4
    expect(multiplyRatio(satang(5), 1, 2, 'floor')).toBe(2)
    expect(multiplyRatio(satang(5), 1, 2, 'ceil')).toBe(3)
    expect(multiplyRatio(satang(5), 1, 2, 'truncate')).toBe(2)
  })

  it('rounds negative values symmetrically (half away from zero)', () => {
    expect(multiplyRatio(satang(-5), 1, 2, 'half-up')).toBe(-3)
    expect(multiplyRatio(satang(-5), 1, 2, 'floor')).toBe(-3)
    expect(multiplyRatio(satang(-5), 1, 2, 'ceil')).toBe(-2)
    expect(multiplyRatio(satang(-5), 1, 2, 'truncate')).toBe(-2)
  })

  it('handles a negative denominator', () => {
    expect(multiplyRatio(satang(10), 1, -4)).toBe(-3) // -2.5 → -3
  })

  it('computes monthly interest from an annual rate in bps without floats', () => {
    // 100,000 baht at 16% p.a. for one month = 100000 × 0.16 / 12 = 1333.33
    expect(multiplyRatio(parseBaht('100000'), 1600, 10_000 * 12)).toBe(133333)
  })

  it('rejects division by zero and non-integer ratios', () => {
    expect(() => multiplyRatio(satang(100), 1, 0)).toThrow(MoneyError)
    expect(() => multiplyRatio(satang(100), 0.5, 1)).toThrow(MoneyError)
  })
})

describe('allocate', () => {
  it('splits evenly, giving the remainder to the first parts', () => {
    expect(allocate(satang(1000), [1, 1, 1])).toEqual([334, 333, 333])
  })

  it('always sums back to the original total', () => {
    const total = satang(1_000_001)
    const parts = allocate(total, [3, 7, 11, 13])
    expect(sum(parts)).toBe(total)
  })

  it('handles negative totals and zero weights', () => {
    const parts = allocate(satang(-100), [1, 0, 2])
    expect(parts).toEqual([-33, 0, -67])
    expect(sum(parts)).toBe(-100)
  })

  it('validates weights', () => {
    expect(() => allocate(satang(100), [])).toThrow(MoneyError)
    expect(() => allocate(satang(100), [0, 0])).toThrow(MoneyError)
    expect(() => allocate(satang(100), [-1, 2])).toThrow(MoneyError)
  })
})

describe('comparison', () => {
  it('compares and picks min/max', () => {
    expect(compare(satang(1), satang(2))).toBe(-1)
    expect(compare(satang(2), satang(2))).toBe(0)
    expect(compare(satang(3), satang(2))).toBe(1)
    expect(min(satang(5), satang(-1), satang(3))).toBe(-1)
    expect(max(satang(5), satang(-1), satang(3))).toBe(5)
  })
})

describe('toDecimalString', () => {
  it.each([
    [0, '0.00'],
    [5, '0.05'],
    [-5, '-0.05'],
    [100, '1.00'],
    [123456, '1234.56'],
    [-123456, '-1234.56'],
  ])('%i → %s', (value, expected) => {
    expect(toDecimalString(satang(value))).toBe(expected)
  })

  it('round-trips with parseBaht', () => {
    for (const value of [0, 1, -1, 99, 100, 123456789, -987654321]) {
      expect(parseBaht(toDecimalString(satang(value)))).toBe(value)
    }
  })
})

describe('formatMoney', () => {
  it('formats in Thai baht by default', () => {
    expect(formatMoney(satang(123456))).toBe('฿1,234.56')
    expect(formatMoney(satang(0))).toBe('฿0.00')
    expect(formatMoney(satang(-5))).toBe('-฿0.05')
  })

  it('formats large values exactly', () => {
    expect(formatMoney(satang(Number.MAX_SAFE_INTEGER))).toBe('฿90,071,992,547,409.91')
  })

  it('supports options', () => {
    expect(formatMoney(satang(123400), { symbol: false })).toBe('1,234.00')
    expect(formatMoney(satang(123400), { trimZeroFraction: true })).toBe('฿1,234')
    expect(formatMoney(satang(123450), { trimZeroFraction: true })).toBe('฿1,234.50')
    expect(formatMoney(satang(500), { signDisplay: 'always' })).toBe('+฿5.00')
  })
})

describe('ratioBps', () => {
  it('returns integer basis points with half-up rounding', () => {
    expect(ratioBps(satang(325000), satang(842000))).toBe(3860)
    expect(ratioBps(satang(1), satang(3))).toBe(3333)
    expect(ratioBps(satang(2), satang(3))).toBe(6667)
    expect(ratioBps(satang(500), satang(500))).toBe(10000)
  })

  it('returns 0 for an empty whole', () => {
    expect(ratioBps(satang(0), satang(0))).toBe(0)
  })
})
