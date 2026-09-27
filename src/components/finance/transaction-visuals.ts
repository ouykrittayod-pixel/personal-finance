import { ArrowLeftRight, CreditCard, SlidersHorizontal, TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react'
import type { TransactionType } from '@/domain/entities'
import type { MessageKey } from '@/lib/i18n'
import type { MoneySign, MoneyTone } from './money-format'

export interface TransactionVisual {
  labelKey: MessageKey
  /** Fallback icon when the row has no category icon. */
  icon: LucideIcon
  tone: MoneyTone
  sign: MoneySign
  /** Background tint for the leading icon. */
  iconClass: string
}

/**
 * How each transaction type looks. Presentation only.
 * Debt payments are deliberately distinct from expenses: orange tone,
 * card icon and the "ชำระหนี้" label — never the expense red.
 */
export const TRANSACTION_VISUALS: Record<TransactionType, TransactionVisual> = {
  expense: {
    labelKey: 'txType.expense',
    icon: TrendingDown,
    tone: 'expense',
    sign: 'minus',
    iconClass: 'bg-neutral-muted text-foreground',
  },
  income: {
    labelKey: 'txType.income',
    icon: TrendingUp,
    tone: 'income',
    sign: 'plus',
    iconClass: 'bg-income-muted text-income',
  },
  debt_payment: {
    labelKey: 'txType.debt_payment',
    icon: CreditCard,
    tone: 'debt',
    sign: 'minus',
    iconClass: 'bg-debt-muted text-debt',
  },
  transfer: {
    labelKey: 'txType.transfer',
    icon: ArrowLeftRight,
    tone: 'neutral',
    sign: 'none',
    iconClass: 'bg-info-muted text-info',
  },
  adjustment: {
    labelKey: 'txType.adjustment',
    icon: SlidersHorizontal,
    tone: 'muted',
    sign: 'auto',
    iconClass: 'bg-neutral-muted text-muted-foreground',
  },
}
