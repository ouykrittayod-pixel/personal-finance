import { describe, expect, it } from 'vitest'
import { formatUsage } from '@/features/budget/budget-data'
import { formatPercentBps1 } from './index'

describe('one-decimal percentages (integer maths)', () => {
  it.each([
    [4_167, '41.7%'],
    [4_166, '41.7%'],
    [7_000, '70%'],
    [9_750, '97.5%'],
    [17_750, '177.5%'],
    [1_240, '12.4%'],
    [-1_111, '-11.1%'],
  ])('%i bps → %s', (bps, text) => expect(formatPercentBps1(bps)).toBe(text))

  it('budget usage below 100% never shows as 100%', () => {
    expect(formatUsage(9_999)).toBe('99.9%')
    expect(formatUsage(10_000)).toBe('100%')
    expect(formatUsage(4_166)).toBe('41.7%')
  })
})
