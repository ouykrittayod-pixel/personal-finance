import { AlertCircle, ArrowLeftRight, CalendarClock, CreditCard, TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router'
import { MoneyDisplay } from '@/components/finance/MoneyDisplay'
import type { MoneySign, MoneyTone } from '@/components/finance/money-format'
import { StatusBadge, type StatusKind } from '@/components/finance/StatusBadge'
import type { CalendarItem, CalendarItemKind, CalendarItemStatus } from '@/domain/calendar'
import type { RecurringObligation } from '@/domain/entities'
import { formatCompactTHB, formatDate, formatTHB } from '@/lib/formatting'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { describeItem, kindLabel, linkFor, statusLabel } from '../calendar-data'

/** Presentation per event kind — the existing semantic tones (income green, expense red, debt orange, scheduled/transfer neutral). */
const VISUAL: Record<CalendarItemKind, { icon: LucideIcon; iconClass: string; tone: MoneyTone; sign: MoneySign }> = {
  expense: { icon: TrendingDown, iconClass: 'bg-expense-muted text-expense', tone: 'expense', sign: 'minus' },
  income: { icon: TrendingUp, iconClass: 'bg-income-muted text-income', tone: 'income', sign: 'plus' },
  debt_payment: { icon: CreditCard, iconClass: 'bg-debt-muted text-debt', tone: 'debt', sign: 'minus' },
  transfer: { icon: ArrowLeftRight, iconClass: 'bg-neutral-muted text-foreground', tone: 'neutral', sign: 'none' },
  scheduled_expense: { icon: CalendarClock, iconClass: 'bg-info-muted text-info', tone: 'neutral', sign: 'none' },
  scheduled_income: { icon: CalendarClock, iconClass: 'bg-income-muted text-income', tone: 'neutral', sign: 'plus' },
  scheduled_debt: { icon: CreditCard, iconClass: 'bg-debt-muted text-debt', tone: 'neutral', sign: 'none' },
}

const BADGE: Record<Exclude<CalendarItemStatus, 'actual'>, StatusKind> = { upcoming: 'pending', overdue: 'overdue', paid: 'paid', skipped: 'skipped' }

/** A full event row: opens the existing detail (transaction, recurring rule, income rule or debt). */
export function CalendarEventRow({ item, obligations, showExtras = false }: { item: CalendarItem; obligations: readonly RecurringObligation[]; showExtras?: boolean }) {
  const visual = VISUAL[item.kind]
  const Icon = visual.icon
  const muted = item.status === 'skipped'
  const extras = [
    item.paidDate && item.paidDate !== item.date ? t(item.kind === 'scheduled_income' ? 'calendar.day.receivedOn' : 'calendar.day.paidOn', { date: formatDate(item.paidDate) }) : null,
    item.status === 'paid' && item.expectedSatang !== undefined && item.expectedSatang !== item.amountSatang ? t('calendar.day.expected', { amount: formatTHB(item.expectedSatang, { trimZeroFraction: true }) }) : null,
    item.paysDueDate ? t('calendar.day.paysDue', { date: formatDate(item.paysDueDate) }) : null,
  ].filter(Boolean)
  return (
    <li>
      <Link
        to={linkFor(item, obligations)}
        aria-label={`${describeItem(item)}${extras.length ? ` ${extras.join(' ')}` : ''}`}
        className="focus-ring flex min-h-touch items-center gap-3 rounded-md px-2 py-2.5 transition-colors duration-(--duration-fast) hover:bg-muted/60"
      >
        <span aria-hidden="true" className={cn('flex size-9 shrink-0 items-center justify-center rounded-full', visual.iconClass)}>
          <Icon className="size-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col" aria-hidden="true">
          <span className={cn('truncate text-sm font-medium', muted && 'text-muted-foreground line-through')}>{item.title}</span>
          <span className="truncate text-xs text-muted-foreground">{item.status === 'actual' ? kindLabel(item.kind) : `${kindLabel(item.kind)} · ${statusLabel(item)}`}</span>
          {showExtras && extras.length > 0 && <span className="truncate text-xs text-muted-foreground">{extras.join(' · ')}</span>}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1" aria-hidden="true">
          <MoneyDisplay amount={item.amountSatang} tone={muted ? 'muted' : visual.tone} sign={visual.sign} size="md" />
          {item.status !== 'actual' && <StatusBadge status={BADGE[item.status]} label={statusLabel(item)} />}
        </span>
      </Link>
    </li>
  )
}

/** A compact line inside a month-grid cell (decorative; the cell's button carries the accessible summary). */
export function CalendarEventChip({ item }: { item: CalendarItem }) {
  const visual = VISUAL[item.kind]
  const Icon = item.status === 'overdue' ? AlertCircle : visual.icon
  return (
    <span className={cn('flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-[11px] leading-tight', item.status === 'overdue' ? 'bg-expense-muted' : 'bg-muted/60')}>
      <Icon className={cn('size-3 shrink-0', item.status === 'overdue' ? 'text-expense' : visual.iconClass.split(' ').find((c) => c.startsWith('text-')))} />
      <span className={cn('min-w-0 flex-1 truncate', item.status === 'skipped' && 'line-through')}>{item.title}</span>
      <span className="shrink-0 tabular-nums">
        {visual.sign === 'plus' ? '+' : ''}
        {formatCompactTHB(item.amountSatang)}
      </span>
    </span>
  )
}
