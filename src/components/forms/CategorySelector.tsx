import { t } from '@/lib/i18n'
import { ChoiceGroup, type ChoiceOption } from './ChoiceGroup'

export interface CategorySelectorProps {
  /** Categories to show, most-used first. Supplied by the caller — no data access here. */
  options: readonly ChoiceOption[]
  value: string | undefined
  onValueChange: (categoryId: string) => void
  label?: string
  hideLabel?: boolean
  name?: string
  className?: string
}

/** One-tap category grid (4 per row on phones) — the fastest path for daily expense entry. */
export function CategorySelector({ label = t('form.category'), hideLabel, ...props }: CategorySelectorProps) {
  return <ChoiceGroup legend={label} hideLegend={hideLabel} layout="grid" {...props} />
}
