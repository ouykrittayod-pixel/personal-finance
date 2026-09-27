// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { satang } from '@/domain/money'
import { t } from '@/lib/i18n'
import { FinancialSummary } from './FinancialSummary'
import { MINUS_SIGN } from './money-format'
import { MoneyDisplay } from './MoneyDisplay'
import { StatusBadge } from './StatusBadge'
import { TransactionRow } from './TransactionRow'

const baht = (value: number) => satang(value * 100)

describe('MoneyDisplay', () => {
  it('renders a machine-readable value with tone and size classes', () => {
    render(<MoneyDisplay amount={baht(27500)} tone="income" size="xl" />)
    const el = screen.getByText('+฿27,500')
    expect(el.tagName).toBe('DATA')
    expect(el).toHaveAttribute('value', '27500.00')
    expect(el).toHaveClass('text-income', 'amount-xl', 'tabular-nums-money')
  })
})

describe('TransactionRow', () => {
  it('shows an expense with category, account, date, attachment and signed amount', () => {
    render(
      <ul>
        <TransactionRow
          type="expense"
          title="ข้าวกลางวัน"
          amount={baht(85)}
          date="2026-09-25"
          categoryLabel="อาหาร"
          categoryIcon="🍚"
          accountLabel="เงินสด"
          hasAttachment
        />
      </ul>,
    )
    expect(screen.getByText('ข้าวกลางวัน')).toBeInTheDocument()
    expect(screen.getByText('อาหาร · เงินสด')).toBeInTheDocument()
    expect(screen.getByText(`${MINUS_SIGN}฿85`)).toHaveAttribute('data-tone', 'expense')
    expect(screen.getByText(t('attachment.present'))).toBeInTheDocument()
    expect(screen.getByText(/2026/).closest('time')).toHaveAttribute('dateTime', '2026-09-25')
  })

  it('makes debt payments visually distinct from expenses', () => {
    render(
      <ul>
        <TransactionRow type="debt_payment" title="ชำระบัตรเครดิต" amount={baht(2500)} accountLabel="KBank" />
      </ul>,
    )
    expect(screen.getByText(`${t('txType.debt_payment')} · KBank`)).toBeInTheDocument()
    const amount = screen.getByText(`${MINUS_SIGN}฿2,500`)
    expect(amount).toHaveAttribute('data-tone', 'debt')
    expect(amount).not.toHaveClass('text-expense')
    expect(screen.getByRole('listitem')).toHaveAttribute('data-type', 'debt_payment')
  })

  it('labels income by type and shows a plus sign', () => {
    render(
      <ul>
        <TransactionRow type="income" title="เงินเดือน" amount={baht(27500)} accountLabel="KBank" />
      </ul>,
    )
    expect(screen.getByText(`${t('txType.income')} · KBank`)).toBeInTheDocument()
    expect(screen.getByText('+฿27,500')).toHaveAttribute('data-tone', 'income')
  })

  it('is a full-width button when selectable', async () => {
    const onSelect = vi.fn<() => void>()
    render(
      <ul>
        <TransactionRow type="expense" title="กาแฟ" amount={baht(55)} onSelect={onSelect} />
      </ul>,
    )
    await userEvent.click(screen.getByRole('button', { name: /กาแฟ/ }))
    expect(onSelect).toHaveBeenCalledOnce()
  })
})

describe('FinancialSummary', () => {
  it('presents a hero figure and supporting figures as a description list', () => {
    render(
      <FinancialSummary
        primary={{ label: 'คงเหลือ', amount: baht(3280) }}
        items={[
          { label: 'รายรับ', amount: baht(27500), tone: 'income' },
          { label: 'รายจ่าย', amount: baht(8420), tone: 'expense' },
        ]}
      />,
    )
    expect(screen.getByRole('region', { name: 'คงเหลือ' })).toBeInTheDocument()
    expect(screen.getByText('฿3,280')).toHaveClass('amount-xl')
    expect(screen.getByText('+฿27,500')).toHaveClass('amount-md')
  })
})

describe('StatusBadge', () => {
  it('uses text + icon, not colour alone', () => {
    render(<StatusBadge status="overdue" />)
    const badge = screen.getByText(t('status.overdue'))
    expect(badge).toHaveAttribute('data-status', 'overdue')
    expect(badge.querySelector('svg')).not.toBeNull()
  })
})
