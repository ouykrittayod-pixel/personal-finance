import { CalendarCheck, CreditCard, Repeat } from 'lucide-react'
import { Link } from 'react-router'
import { SecondaryButton } from '@/components/actions/buttons'
import { EmptyState } from '@/components/feedback/EmptyState'
import { MoneyDisplay } from '@/components/finance/MoneyDisplay'
import { StatusBadge } from '@/components/finance/StatusBadge'
import { formatDate } from '@/lib/formatting'
import { t } from '@/lib/i18n'
import type { DashboardModel, UpcomingRow } from '../dashboard-data'
import { DashboardSection } from './DashboardSection'

function UpcomingPaymentRow({ row }: { row: UpcomingRow }) {
  const Icon = row.sourceType === 'debt' ? CreditCard : Repeat
  const content = (
    <>
      <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-debt-muted text-debt">
        <Icon className="size-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{row.name}</span>
        <span className="text-xs text-muted-foreground">
          <time dateTime={row.dueDate}>{t('dashboard.upcomingList.due', { date: formatDate(row.dueDate, 'medium') })}</time>
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <MoneyDisplay amount={row.amount} size="md" />
        <StatusBadge status={row.status} label={row.status === 'overdue' ? t('recurring.overdueDays', { days: row.overdueDays }) : undefined} />
      </span>
    </>
  )
  const layout = 'flex w-full items-center gap-3 px-card py-3 text-left'
  return (
    <li>
      <Link
        to={row.sourceType === 'obligation' ? `/recurring?id=${row.sourceId}` : `/debts?id=${row.sourceId}`}
        className={`${layout} focus-ring min-h-touch transition-colors duration-(--duration-fast) hover:bg-muted/60`}
      >
        {content}
      </Link>
    </li>
  )
}

/** Unpaid scheduled payments (obligations and debt installments): overdue first, then by due date. */
export function UpcomingPaymentsCard({ upcoming }: { upcoming: DashboardModel['upcoming'] }) {
  const title = t('dashboard.upcomingList.title')
  const hidden = upcoming.count - upcoming.items.length

  return (
    <DashboardSection title={title} to={upcoming.count > 0 ? '/recurring' : undefined} flush={upcoming.count > 0}>
      {upcoming.count === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title={t('dashboard.upcomingList.empty')}
          className="border-none py-6"
          action={
            <SecondaryButton asChild>
              <Link to="/recurring">{t('dashboard.upcomingList.manage')}</Link>
            </SecondaryButton>
          }
        />
      ) : (
        <>
          <ul aria-label={title} className="divide-y divide-border border-t">
            {upcoming.items.map((row) => (
              <UpcomingPaymentRow key={row.id} row={row} />
            ))}
          </ul>
          {hidden > 0 && (
            <p className="border-t px-card py-3 text-sm text-muted-foreground">{t('dashboard.upcomingList.more', { count: hidden })}</p>
          )}
        </>
      )}
    </DashboardSection>
  )
}
