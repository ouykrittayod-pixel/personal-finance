import { CHART_COLORS } from '@/components/data/chart-colors'
import type { Category, ID } from '@/domain/entities'
import type { Satang } from '@/domain/money'
import { OTHER_CATEGORIES, UNCATEGORIZED, type SpendingBreakdown } from '@/domain/reporting'
import { t } from '@/lib/i18n'

export interface CategorySlice {
  key: string
  label: string
  icon?: string
  color: string
  amount: Satang
  shareBps: number
}

/**
 * Names and colours for a spending breakdown (Dashboard donut, Analytics).
 * Categories with their own colour keep it; others take the next palette
 * colour in order; greys are reserved for "อื่น ๆ" and uncategorized.
 */
export function toCategorySlices(breakdown: SpendingBreakdown, categories: ReadonlyMap<ID, Category>): CategorySlice[] {
  let paletteIndex = 0
  return breakdown.items.map((item): CategorySlice => {
    if (item.key === OTHER_CATEGORIES) return { ...item, label: t('dashboard.spending.other'), color: 'var(--muted-foreground)' }
    if (item.key === UNCATEGORIZED) return { ...item, label: t('dashboard.spending.uncategorized'), color: 'var(--neutral)' }
    const category = categories.get(item.key)
    let color = category?.color
    if (!color) {
      color = CHART_COLORS.series[paletteIndex % CHART_COLORS.series.length] ?? 'var(--chart-1)'
      paletteIndex += 1
    }
    return { ...item, label: category?.name ?? t('dashboard.spending.uncategorized'), icon: category?.icon, color }
  })
}
