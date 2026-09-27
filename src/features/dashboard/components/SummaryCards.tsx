import { CalendarClock, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import { MoneyDisplay } from '@/components/finance/MoneyDisplay'
import { StatCard } from '@/components/finance/StatCard'
import { formatTHB } from '@/lib/formatting'
import { formatYearMonth } from '@/lib/dates'
import { t } from '@/lib/i18n'
import type { DashboardModel } from '../dashboard-data'

/**
 * The four headline figures. Phone: available money full width, income and
 * expenses side by side, obligations full width. Desktop: one row, with the
 * available-money card widest.
 */
export function SummaryCards({ model }: { model: DashboardModel }) {
  const { available, availableAsOf, totals, upcoming, month, isCurrentMonth } = model
  const monthShort = formatYearMonth(month, 'shortYear')

  const expenseHint = [
    t('dashboard.count', { count: totals.expenseCount }),
    totals.debtPayment > 0 ? t('dashboard.expense.excludesDebt', { amount: formatTHB(totals.debtPayment, { trimZeroFraction: true }) }) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const upcomingHint =
    upcoming.count === 0
      ? t('dashboard.upcoming.none')
      : [
          t('dashboard.upcoming.hint', { count: upcoming.count }),
          upcoming.overdueCount > 0 ? t('dashboard.upcoming.overdue', { count: upcoming.overdueCount }) : null,
        ]
          .filter(Boolean)
          .join(' · ')

  return (
    <section aria-label={t('dashboard.summary')} className="grid grid-cols-2 gap-stack lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
      <StatCard
        className="col-span-2 lg:col-span-1"
        label={t('dashboard.available.label')}
        icon={Wallet}
        tone="primary"
        value={<MoneyDisplay amount={available.total} size="xl" />}
        hint={
          availableAsOf
            ? t('dashboard.debt.asOf', { month: formatYearMonth(availableAsOf.slice(0, 7)) })
            : available.accountCount > 0
              ? t('dashboard.available.hint', { count: available.accountCount })
              : t('dashboard.available.none')
        }
      />
      <StatCard
        label={isCurrentMonth ? t('dashboard.income.label') : t('dashboard.income.labelMonth', { month: monthShort })}
        icon={TrendingUp}
        tone="income"
        value={<MoneyDisplay amount={totals.income} tone="income" sign="none" size="lg" />}
        hint={t('dashboard.count', { count: totals.incomeCount })}
      />
      <StatCard
        label={isCurrentMonth ? t('dashboard.expense.label') : t('dashboard.expense.labelMonth', { month: monthShort })}
        icon={TrendingDown}
        tone="expense"
        value={<MoneyDisplay amount={totals.expense} tone="expense" sign="none" size="lg" />}
        hint={expenseHint}
      />
      <StatCard
        className="col-span-2 lg:col-span-1"
        label={t('dashboard.upcoming.label')}
        icon={CalendarClock}
        tone={upcoming.overdueCount > 0 ? 'expense' : 'debt'}
        value={<MoneyDisplay amount={upcoming.total} tone={upcoming.count > 0 ? 'debt' : 'neutral'} size="lg" />}
        hint={upcomingHint}
      />
    </section>
  )
}
