import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export type StatTone = 'primary' | 'income' | 'expense' | 'debt' | 'warning' | 'info' | 'neutral'

const ICON_TONE: Record<StatTone, string> = {
  primary: 'bg-primary/10 text-primary',
  income: 'bg-income-muted text-income',
  expense: 'bg-expense-muted text-expense',
  debt: 'bg-debt-muted text-debt',
  warning: 'bg-warning-muted text-warning',
  info: 'bg-info-muted text-info',
  neutral: 'bg-neutral-muted text-muted-foreground',
}

export interface StatCardProps {
  label: string
  /** The figure — usually `<MoneyDisplay size="lg" …/>`. */
  value: ReactNode
  icon?: LucideIcon
  tone?: StatTone
  /** Short supporting line under the value, e.g. "จาก 12 รายการ". */
  hint?: ReactNode
  /** Optional bottom slot, e.g. a ProgressBar. */
  footer?: ReactNode
  className?: string
}

/** A single headline figure with label. Value first in visual weight, label second. */
export function StatCard({ label, value, icon: Icon, tone = 'neutral', hint, footer, className }: StatCardProps) {
  return (
    <Card className={cn('gap-2 px-card', className)}>
      <div className="flex items-center gap-inline">
        {Icon && (
          <span aria-hidden="true" className={cn('flex size-7 items-center justify-center rounded-md', ICON_TONE[tone])}>
            <Icon className="size-4" />
          </span>
        )}
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <div>{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      {footer && <div className="pt-1">{footer}</div>}
    </Card>
  )
}
