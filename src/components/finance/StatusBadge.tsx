import { AlertCircle, AlertTriangle, CheckCircle2, CircleDot, Clock, MinusCircle, PauseCircle, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { t, type MessageKey } from '@/lib/i18n'

export type StatusKind = 'pending' | 'due_soon' | 'overdue' | 'paid' | 'skipped' | 'active' | 'closed' | 'paused'

const STATUS: Record<StatusKind, { labelKey: MessageKey; icon: LucideIcon; className: string }> = {
  pending: { labelKey: 'status.pending', icon: Clock, className: 'bg-info-muted text-info' },
  due_soon: { labelKey: 'status.due_soon', icon: AlertTriangle, className: 'bg-warning-muted text-warning' },
  overdue: { labelKey: 'status.overdue', icon: AlertCircle, className: 'bg-expense-muted text-expense' },
  paid: { labelKey: 'status.paid', icon: CheckCircle2, className: 'bg-income-muted text-income' },
  skipped: { labelKey: 'status.skipped', icon: MinusCircle, className: 'bg-neutral-muted text-muted-foreground' },
  active: { labelKey: 'status.active', icon: CircleDot, className: 'bg-debt-muted text-debt' },
  closed: { labelKey: 'status.closed', icon: CheckCircle2, className: 'bg-neutral-muted text-muted-foreground' },
  paused: { labelKey: 'status.paused', icon: PauseCircle, className: 'bg-neutral-muted text-muted-foreground' },
}

export interface StatusBadgeProps {
  status: StatusKind
  /** Override the default label (e.g. "เกินกำหนด 3 วัน"). */
  label?: string
  className?: string
}

/** Status pill with icon + text, so meaning never depends on colour alone. */
export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const { labelKey, icon: Icon, className: tone } = STATUS[status]
  return (
    <span
      data-status={status}
      className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', tone, className)}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {label ?? t(labelKey)}
    </span>
  )
}
