import { describe, expect, it } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('keeps amount sizes alongside semantic text colours', () => {
    expect(cn('amount-xl', 'text-income')).toBe('amount-xl text-income')
  })

  it('still resolves real conflicts', () => {
    expect(cn('text-income', 'text-expense')).toBe('text-expense')
  })
})
