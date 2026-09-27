import { t } from '@/lib/i18n'
import { ChoiceGroup, type ChoiceOption } from './ChoiceGroup'

export interface AccountSelectorProps {
  /** Accounts to show, default first. Supplied by the caller — no data access here. */
  options: readonly ChoiceOption[]
  value: string | undefined
  onValueChange: (accountId: string) => void
  label?: string
  hideLabel?: boolean
  name?: string
  className?: string
}

/** Horizontal chip row of accounts: thumb-friendly, scrolls on phones, wraps on larger screens. */
export function AccountSelector({ label = t('form.account'), hideLabel, ...props }: AccountSelectorProps) {
  return <ChoiceGroup legend={label} hideLegend={hideLabel} layout="scroll" {...props} />
}
