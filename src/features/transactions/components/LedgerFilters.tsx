import { Search, X } from 'lucide-react'
import { useId } from 'react'
import { ChoiceGroup } from '@/components/forms/ChoiceGroup'
import { DateInput } from '@/components/forms/DateInput'
import { Input } from '@/components/ui/input'
import type { ISODate } from '@/domain/entities'
import { LEDGER_TYPE_FILTERS, type LedgerTypeFilter } from '@/domain/ledger'
import { t, type MessageKey } from '@/lib/i18n'
import type { LedgerFilters as Filters, RangePreset } from '../ledger-data'

const TYPE_LABEL: Record<LedgerTypeFilter, MessageKey> = {
  all: 'ledger.type.all',
  expense: 'txType.expense',
  income: 'txType.income',
  debt_payment: 'txType.debt_payment',
  transfer: 'ledger.type.transfer',
}
const PRESETS: readonly RangePreset[] = ['today', 'week', 'month', 'custom']

export interface LedgerFiltersProps {
  filters: Filters
  /** Raw (not yet debounced) search text. */
  searchText: string
  onSearchTextChange: (text: string) => void
  onChange: (next: Filters) => void
  rangeReversed: boolean
  today: ISODate
  /** Hide the type chips (a page that shows one type only). */
  showTypes?: boolean
  searchLabel?: string
  searchPlaceholder?: string
}

/** Search, type chips and date presets. Chips scroll sideways on phones instead of wrapping the page. */
export function LedgerFilters({
  filters,
  searchText,
  onSearchTextChange,
  onChange,
  rangeReversed,
  today,
  showTypes = true,
  searchLabel = t('ledger.searchLabel'),
  searchPlaceholder = t('ledger.search'),
}: LedgerFiltersProps) {
  const searchId = useId()
  return (
    <div className="flex flex-col gap-stack">
      <div className="relative">
        <label htmlFor={searchId} className="sr-only">
          {searchLabel}
        </label>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          id={searchId}
          type="search"
          value={searchText}
          onChange={(event) => onSearchTextChange(event.target.value)}
          placeholder={searchPlaceholder}
          enterKeyHint="search"
          autoComplete="off"
          className="pr-10 pl-9"
        />
        {searchText && (
          <button
            type="button"
            onClick={() => onSearchTextChange('')}
            aria-label={t('ledger.clearSearch')}
            className="focus-ring absolute top-1/2 right-1 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="flex flex-col gap-stack lg:flex-row lg:items-start lg:justify-between">
        {showTypes && (
        <ChoiceGroup
          legend={t('ledger.typeFilter')}
          hideLegend
          layout="scroll"
          name="ledger-type"
          options={LEDGER_TYPE_FILTERS.map((type) => ({ value: type, label: t(TYPE_LABEL[type]) }))}
          value={filters.type}
          onValueChange={(type) => onChange({ ...filters, type: type as LedgerTypeFilter })}
        />
        )}
        <ChoiceGroup
          legend={t('ledger.dateFilter')}
          hideLegend
          layout="scroll"
          name="ledger-range"
          options={PRESETS.map((preset) => ({ value: preset, label: t(`ledger.range.${preset}`) }))}
          value={filters.preset}
          onValueChange={(preset) => onChange({ ...filters, preset: preset as RangePreset })}
        />
      </div>

      {filters.preset === 'custom' && (
        <div className="flex flex-col gap-2">
          <div className="grid gap-stack sm:grid-cols-2">
            <DateInput
              label={t('ledger.from')}
              shortcuts={false}
              today={today}
              value={filters.customStart}
              onValueChange={(customStart) => onChange({ ...filters, customStart })}
            />
            <DateInput
              label={t('ledger.to')}
              shortcuts={false}
              today={today}
              value={filters.customEnd}
              onValueChange={(customEnd) => onChange({ ...filters, customEnd })}
            />
          </div>
          {rangeReversed && (
            <p role="status" className="text-xs text-warning">
              {t('ledger.rangeInvalid')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
