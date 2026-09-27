import { ProgressBar } from '@/components/feedback/ProgressBar'
import { MoneyDisplay } from '@/components/finance/MoneyDisplay'
import { StatusBadge } from '@/components/finance/StatusBadge'
import { formatYearMonth } from '@/lib/dates'
import { t } from '@/lib/i18n'
import { formatUsage, STATUS_BADGE, STATUS_TONE } from '@/features/budget/budget-data'
import type { DashboardModel } from '../dashboard-data'
import { DashboardSection } from './DashboardSection'

/** Compact budget line for the month; everything else lives on #/budget. Shown only when the month has budgets. */
export function BudgetSummaryCard({ budget, month, isCurrentMonth }: { budget: NonNullable<DashboardModel['budget']>; month: string; isCurrentMonth: boolean }) {
  const title = isCurrentMonth ? t('dashboard.budget.title') : t('dashboard.budget.titleMonth', { month: formatYearMonth(month) })
  const usage = budget.usageBps === null ? '—' : formatUsage(budget.usageBps)
  return (
    <DashboardSection title={title} to={`/budget?month=${month}`}>
      <div className="flex flex-col gap-stack px-card">
        <div className="grid grid-cols-2 gap-stack">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">{budget.scope === 'overall' ? t('dashboard.budget.limit') : t('dashboard.budget.limitCategories')}</span>
            <MoneyDisplay amount={budget.limit} size="lg" />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">{t('dashboard.budget.spent')}</span>
            <MoneyDisplay amount={budget.spent} size="lg" />
          </div>
        </div>
        <ProgressBar value={(budget.usageBps ?? 0) / 100} label={title} valueText={`${usage} · ${t(`budget.status.${budget.status}`)}`} tone={STATUS_TONE[budget.status]} />
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{t('budget.line.progress', { percent: usage })}</span>
          <StatusBadge status={STATUS_BADGE[budget.status]} label={t(`budget.status.${budget.status}`)} />
        </div>
      </div>
    </DashboardSection>
  )
}
