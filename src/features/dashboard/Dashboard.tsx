import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { ErrorState } from '@/components/feedback/ErrorState'
import { LoadingState } from '@/components/feedback/LoadingState'
import { PageHeader } from '@/components/layout/PageHeader'
import { MonthSelector } from '@/components/navigation/MonthSelector'
import type { ISODate } from '@/domain/entities'
import { formatYearMonth, isYearMonth, yearMonthOf, type YearMonth } from '@/lib/dates'
import { t } from '@/lib/i18n'
import { CashFlowCard } from './components/CashFlowCard'
import { BudgetSummaryCard } from './components/BudgetSummaryCard'
import { DebtSummaryCard } from './components/DebtSummaryCard'
import { RecentTransactionsCard } from './components/RecentTransactionsCard'
import { SpendingByCategoryCard } from './components/SpendingByCategoryCard'
import { SummaryCards } from './components/SummaryCards'
import { UpcomingPaymentsCard } from './components/UpcomingPaymentsCard'
import { loadDashboardData, type DashboardPeriod, type DashboardRawData } from './dashboard-data'
import { useDashboard } from './use-dashboard'

export interface DashboardProps {
  /** Reference "today" (injected for tests). */
  today: ISODate
  /** Data loader (injected for tests). */
  load?: (period: DashboardPeriod) => Promise<DashboardRawData>
  /** Shown under the header (the first-run setup card). */
  intro?: ReactNode
}

/**
 * The financial command center. The selected month lives in the URL
 * (`#/?month=2026-08`) so it survives reloads and can be linked to; the
 * current month has no parameter.
 */
export function Dashboard({ today, load = loadDashboardData, intro }: DashboardProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const currentMonth = yearMonthOf(today)
  const param = searchParams.get('month')
  const month: YearMonth = isYearMonth(param) ? param : currentMonth

  const state = useDashboard({ month, today }, load)

  const setMonth = (next: YearMonth) => {
    setSearchParams(next === currentMonth ? {} : { month: next }, { replace: true })
  }

  return (
    <div className="flex flex-col gap-section">
      <PageHeader
        title={t('dashboard.title')}
        description={month === currentMonth ? t('dashboard.subtitle') : t('dashboard.subtitleMonth', { month: formatYearMonth(month) })}
        actions={<MonthSelector value={month} onChange={setMonth} currentMonth={currentMonth} />}
      />

      {intro}

      {state.status === 'loading' && <LoadingState variant="cards" count={4} />}

      {state.status === 'error' && <ErrorState detail={state.error.message} onRetry={state.retry} />}

      {state.status === 'ready' && (
        <>
          <SummaryCards model={state.model} />
          <div className="grid gap-section lg:grid-cols-2">
            <SpendingByCategoryCard spending={state.model.spending} />
            <CashFlowCard points={state.model.cashFlow} month={state.model.month} />
          </div>
          <div className="grid gap-section lg:grid-cols-2">
            <RecentTransactionsCard rows={state.model.recent} />
            <UpcomingPaymentsCard upcoming={state.model.upcoming} />
          </div>
          {state.model.budget ? (
            <div className="grid gap-section lg:grid-cols-2">
              <BudgetSummaryCard budget={state.model.budget} month={state.model.month} isCurrentMonth={state.model.isCurrentMonth} />
              <DebtSummaryCard debt={state.model.debt} />
            </div>
          ) : (
            <DebtSummaryCard debt={state.model.debt} />
          )}
        </>
      )}
    </div>
  )
}
