import type { Satang } from '@/domain/money'
import { cn } from '@/lib/utils'
import { MoneyDisplay } from './MoneyDisplay'
import type { MoneySign, MoneyTone } from './money-format'

export interface SummaryFigure {
  label: string
  amount: Satang
  tone?: MoneyTone
  sign?: MoneySign
}

export interface FinancialSummaryProps {
  /** The one number to understand first (e.g. "คงเหลือ"). */
  primary: SummaryFigure
  /** Supporting figures (e.g. รายรับ, รายจ่าย, ชำระหนี้). */
  items?: SummaryFigure[]
  /** Accessible name for the summary region. */
  label?: string
  className?: string
}

/**
 * The 5-second overview: one hero figure, then up to four supporting figures
 * in a row. Pure presentation — all amounts are computed by the caller.
 */
export function FinancialSummary({ primary, items = [], label, className }: FinancialSummaryProps) {
  return (
    <section aria-label={label ?? primary.label} className={cn('flex flex-col gap-4', className)}>
      <dl className="flex flex-col gap-1">
        <dt className="text-sm text-muted-foreground">{primary.label}</dt>
        <dd>
          <MoneyDisplay amount={primary.amount} tone={primary.tone} sign={primary.sign} size="xl" />
        </dd>
      </dl>
      {items.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
          {items.map((item) => (
            <div key={item.label} className="flex flex-col gap-0.5 border-l-2 border-border pl-3">
              <dt className="text-xs text-muted-foreground">{item.label}</dt>
              <dd>
                <MoneyDisplay amount={item.amount} tone={item.tone} sign={item.sign} size="md" />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}
