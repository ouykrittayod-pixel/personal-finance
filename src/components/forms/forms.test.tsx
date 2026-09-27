// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { Satang } from '@/domain/money'
import { t } from '@/lib/i18n'
import { sanitizeAmountText } from './amount-text'
import { AmountInput } from './AmountInput'
import { CategorySelector } from './CategorySelector'
import { DateInput } from './DateInput'

describe('sanitizeAmountText', () => {
  it.each([
    ['1234', '1234'],
    ['1,234.50', '1234.50'],
    ['12.345', '12.34'],
    ['1.2.3', '1.23'],
    ['฿ 99', '99'],
    ['-50', '50'],
    ['abc', ''],
  ])('%j → %j', (input, expected) => {
    expect(sanitizeAmountText(input)).toBe(expected)
  })
})

function ControlledAmount({ onAmount }: { onAmount: (amount: Satang | null) => void }) {
  const [text, setText] = useState('')
  return (
    <AmountInput
      value={text}
      onValueChange={(next, amount) => {
        setText(next)
        onAmount(amount)
      }}
    />
  )
}

describe('AmountInput', () => {
  it('uses the decimal keypad and an accessible label', () => {
    render(<ControlledAmount onAmount={() => {}} />)
    const input = screen.getByLabelText(t('form.amount'))
    expect(input).toHaveAttribute('inputmode', 'decimal')
  })

  it('reports integer satang while typing and groups digits on blur', async () => {
    const user = userEvent.setup()
    const onAmount = vi.fn<(amount: Satang | null) => void>()
    render(<ControlledAmount onAmount={onAmount} />)
    const input = screen.getByLabelText(t('form.amount'))

    await user.type(input, '1234.567')
    expect(input).toHaveValue('1234.56')
    expect(onAmount).toHaveBeenLastCalledWith(123456)

    await user.tab()
    expect(input).toHaveValue('1,234.56')

    await user.click(input)
    expect(input).toHaveValue('1234.56')
  })

  it('flags an amount that cannot be represented exactly, after blur', async () => {
    const user = userEvent.setup()
    const onAmount = vi.fn<(amount: Satang | null) => void>()
    render(<ControlledAmount onAmount={onAmount} />)
    const input = screen.getByLabelText(t('form.amount'))
    await user.type(input, '999999999999999999')
    expect(onAmount).toHaveBeenLastCalledWith(null)
    expect(input).not.toHaveAttribute('aria-invalid') // not while typing
    await user.tab()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText(t('form.amountInvalid'))).toBeInTheDocument()
  })
})

it('shows an external validation message', () => {
  render(<AmountInput value="0" onValueChange={() => {}} error="ต้องมากกว่า 0" />)
  expect(screen.getByLabelText(t('form.amount'))).toHaveAccessibleDescription('ต้องมากกว่า 0')
})

describe('CategorySelector', () => {
  it('is a labelled radio group and reports the chosen id', async () => {
    const onChange = vi.fn<(value: string) => void>()
    render(
      <CategorySelector
        options={[
          { value: 'food', label: 'อาหาร', icon: '🍚' },
          { value: 'travel', label: 'เดินทาง', icon: '🚆' },
        ]}
        value="food"
        onValueChange={onChange}
      />,
    )
    expect(screen.getByRole('group', { name: t('form.category') })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /อาหาร/ })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: /เดินทาง/ }))
    expect(onChange).toHaveBeenCalledWith('travel')
  })
})

describe('DateInput', () => {
  it('offers today / yesterday shortcuts', async () => {
    const onChange = vi.fn<(value: string) => void>()
    render(<DateInput value="2026-09-25" today="2026-09-25" onValueChange={onChange} />)
    expect(screen.getByRole('button', { name: t('form.today') })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: t('form.yesterday') }))
    expect(onChange).toHaveBeenCalledWith('2026-09-24')
    expect(screen.getByLabelText(t('form.date'))).toHaveValue('2026-09-25')
  })
})
