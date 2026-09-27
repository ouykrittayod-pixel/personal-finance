import { Banknote, Boxes, CreditCard, HandCoins, Landmark, LineChart, PiggyBank, Wallet, type LucideIcon } from 'lucide-react'
import type { AccountKind } from '@/domain/entities'
import type { MessageKey } from '@/lib/i18n'

/** Icon and label for each account kind. Presentation only. */
export const ACCOUNT_KIND_VISUALS: Record<AccountKind, { icon: LucideIcon; labelKey: MessageKey }> = {
  cash: { icon: Banknote, labelKey: 'account.kind.cash' },
  bank: { icon: Landmark, labelKey: 'account.kind.bank' },
  savings: { icon: PiggyBank, labelKey: 'account.kind.savings' },
  e_wallet: { icon: Wallet, labelKey: 'account.kind.e_wallet' },
  investment: { icon: LineChart, labelKey: 'account.kind.investment' },
  credit_card: { icon: CreditCard, labelKey: 'account.kind.credit_card' },
  loan: { icon: HandCoins, labelKey: 'account.kind.loan' },
  other: { icon: Boxes, labelKey: 'account.kind.other' },
}
