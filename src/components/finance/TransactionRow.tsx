import { Paperclip } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ISODate, TransactionType } from '@/domain/entities'
import type { Satang } from '@/domain/money'
import { formatDate } from '@/lib/formatting'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { MoneyDisplay } from './MoneyDisplay'
import { TRANSACTION_VISUALS } from './transaction-visuals'

export interface TransactionRowProps {
  type: TransactionType
  /** Description, e.g. "ข้าวกลางวัน". */
  title: string
  /** Amount as stored: positive for all types except signed adjustments. */
  amount: Satang
  date?: ISODate
  categoryLabel?: string
  /** Emoji or Lucide icon for the category; falls back to the type icon. */
  categoryIcon?: ReactNode
  accountLabel?: string
  /** Transfers / debt payments: destination account, shown as "A → B". */
  toAccountLabel?: string
  hasAttachment?: boolean
  /** Extra trailing content below the amount (e.g. a StatusBadge). */
  badge?: ReactNode
  onSelect?: () => void
  className?: string
}

/**
 * One transaction in a list. Communicates type, category, description,
 * date, account, amount and attachment availability.
 *
 *   [🍚]  ข้าวกลางวัน                −฿85
 *         อาหาร · เงินสด       📎 25 ก.ย. 2026
 */
export function TransactionRow({
  type,
  title,
  amount,
  date,
  categoryLabel,
  categoryIcon,
  accountLabel,
  toAccountLabel,
  hasAttachment = false,
  badge,
  onSelect,
  className,
}: TransactionRowProps) {
  const visual = TRANSACTION_VISUALS[type]
  const typeLabel = t(visual.labelKey)
  const FallbackIcon = visual.icon
  const showCategoryIcon = categoryIcon !== undefined && (type === 'expense' || type === 'income')

  // Expenses and income lead with their category (the type is still announced); other types state their type.
  const kindLabel = type === 'expense' || type === 'income' ? (categoryLabel ?? typeLabel) : typeLabel
  const account = toAccountLabel && accountLabel ? `${accountLabel} → ${toAccountLabel}` : accountLabel
  const meta = [kindLabel, account].filter(Boolean).join(' · ')

  const content = (
    <>
      <span
        aria-hidden="true"
        className={cn('flex size-10 shrink-0 items-center justify-center rounded-full text-lg', visual.iconClass)}
      >
        {showCategoryIcon ? categoryIcon : <FallbackIcon className="size-5" />}
      </span>

      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">
          {/* Type in words for screen readers — never by colour alone. */}
          <span className="sr-only">{typeLabel}: </span>
          {title}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {toAccountLabel && accountLabel ? (
            <>
              {/* The arrow is visual; screen readers hear "จาก A ไป B". */}
              <span aria-hidden="true">{meta}</span>
              <span className="sr-only">{[kindLabel, t('transfer.a11y', { from: accountLabel, to: toAccountLabel })].join(' · ')}</span>
            </>
          ) : (
            meta
          )}
        </span>
      </span>

      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <MoneyDisplay amount={amount} tone={visual.tone} sign={visual.sign} size="md" />
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          {hasAttachment && (
            <>
              <Paperclip className="size-3.5" aria-hidden="true" />
              <span className="sr-only">{t('attachment.present')}</span>
            </>
          )}
          {date && <time dateTime={date}>{formatDate(date, 'medium')}</time>}
        </span>
        {badge}
      </span>
    </>
  )

  const layout = 'flex w-full items-center gap-3 px-card py-3 text-left'

  return (
    <li data-type={type} className={className}>
      {onSelect ? (
        <button
          type="button"
          onClick={onSelect}
          className={cn(layout, 'focus-ring min-h-touch transition-colors duration-(--duration-fast) hover:bg-muted/60')}
        >
          {content}
        </button>
      ) : (
        <div className={layout}>{content}</div>
      )}
    </li>
  )
}
