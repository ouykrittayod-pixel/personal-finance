import { CalendarX2 } from 'lucide-react'
import { EmptyState } from '@/components/feedback/EmptyState'
import { MoneyDisplay } from '@/components/finance/MoneyDisplay'
import { Drawer } from '@/components/overlays/Drawer'
import type { CalendarItem, CalendarTotals } from '@/domain/calendar'
import type { ISODate, RecurringObligation } from '@/domain/entities'
import { formatDate } from '@/lib/formatting'
import { t } from '@/lib/i18n'
import { CalendarEventRow } from './CalendarEvent'

/** A zero total carries no + / − sign. */
const signed = (amount: number, sign: 'plus' | 'minus') => (amount === 0 ? 'none' : sign)

export interface DayDetailSheetProps {
  date: ISODate | null
  items: CalendarItem[]
  totals: CalendarTotals | null
  obligations: readonly RecurringObligation[]
  onClose: () => void
}

/** One day: totals by kind (debt payments never inside "เงินออก") and every event, each opening its existing detail. */
export function DayDetailSheet({ date, items, totals, obligations, onClose }: DayDetailSheetProps) {
  return (
    <Drawer open={date !== null} onOpenChange={(open) => !open && onClose()} title={date ? formatDate(date, 'long') : t('calendar.day.title')} description={t('calendar.day.title')} size="full">
      {date && totals && (
        <div className="flex flex-col gap-section">
          <dl className="grid grid-cols-2 gap-stack rounded-lg border p-card">
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">{t('calendar.day.in')}</dt>
              <dd>
                <MoneyDisplay amount={totals.moneyIn} tone="income" sign={signed(totals.moneyIn, 'plus')} size="md" />
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">{t('calendar.day.out')}</dt>
              <dd>
                <MoneyDisplay amount={totals.expenses} tone="expense" sign={signed(totals.expenses, 'minus')} size="md" />
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">{t('calendar.day.debt')}</dt>
              <dd>
                <MoneyDisplay amount={totals.debtPayments} tone="debt" sign={signed(totals.debtPayments, 'minus')} size="md" />
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">{t('calendar.day.scheduled')}</dt>
              <dd>
                <MoneyDisplay amount={totals.scheduledOut} size="md" sign="none" />
              </dd>
            </div>
          </dl>
          {items.length === 0 ? (
            <EmptyState icon={CalendarX2} title={t('calendar.day.empty')} className="border-none" />
          ) : (
            <ul aria-label={t('calendar.day.title')} className="-mx-2 flex flex-col divide-y divide-border">
              {items.map((item) => (
                <CalendarEventRow key={item.id} item={item} obligations={obligations} showExtras />
              ))}
            </ul>
          )}
        </div>
      )}
    </Drawer>
  )
}
