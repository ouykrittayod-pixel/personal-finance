import { ShieldCheck } from 'lucide-react'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ProgressBar } from '@/components/feedback/ProgressBar'
import { MoneyDisplay } from '@/components/finance/MoneyDisplay'
import { formatPercentBps, formatTHB } from '@/lib/formatting'
import { formatYearMonth } from '@/lib/dates'
import { t } from '@/lib/i18n'
import type { DashboardModel } from '../dashboard-data'
import { DashboardSection } from './DashboardSection'

/** Compact debt overview; details live on #/debts. */
export function DebtSummaryCard({ debt }: { debt: DashboardModel['debt'] }) {
  const title = t('dashboard.debt.title')

  if (debt.activeCount === 0) {
    return (
      <DashboardSection title={title}>
        <EmptyState icon={ShieldCheck} title={t('dashboard.debt.empty')} description={t('dashboard.debt.emptyHint')} className="border-none py-6" />
      </DashboardSection>
    )
  }

  const progressText = debt.progress
    ? t('dashboard.debt.progressText', {
        paid: formatTHB(debt.progress.paid, { trimZeroFraction: true }),
        original: formatTHB(debt.progress.original, { trimZeroFraction: true }),
      })
    : undefined

  return (
    <DashboardSection title={title} to="/debts">
      <div className="grid gap-section md:grid-cols-2">
        <div className="flex flex-col gap-stack">
          <div className="flex flex-col gap-1">
            <MoneyDisplay amount={debt.totalOutstanding} tone="debt" size="xl" />
            <p className="text-sm text-muted-foreground">
              {t('dashboard.debt.active', { count: debt.activeCount })}
              {debt.asOf && ` · ${t('dashboard.debt.asOf', { month: formatYearMonth(debt.asOf.slice(0, 7)) })}`}
            </p>
          </div>
          {debt.progress && (
            <div className="flex flex-col gap-1.5">
              <ProgressBar
                value={debt.progress.paidBps / 100}
                label={t('dashboard.debt.progress')}
                valueText={`${progressText} (${formatPercentBps(debt.progress.paidBps)})`}
                tone="debt"
                showValue
              />
              <p className="text-xs text-muted-foreground">{progressText}</p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-muted-foreground">{t('dashboard.debt.top')}</h3>
          <ul className="divide-y divide-border">
            {debt.top.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0 truncate text-sm">{row.name}</span>
                {row.outstanding === null ? (
                  <span className="text-sm text-muted-foreground">{t('debts.unknown')}</span>
                ) : (
                  <MoneyDisplay amount={row.outstanding} tone="debt" size="md" />
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </DashboardSection>
  )
}
