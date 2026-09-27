import { useLiveQuery } from 'dexie-react-hooks'
import { BarChart3, CreditCard, Lightbulb, PiggyBank, TrendingDown, TrendingUp } from 'lucide-react'
import { createElement, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Cell, Pie, PieChart } from 'recharts'
import { ChartContainer, type ChartConfig } from '@/components/data/ChartContainer'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { LoadingState } from '@/components/feedback/LoadingState'
import { ProgressBar } from '@/components/feedback/ProgressBar'
import { ACCOUNT_KIND_VISUALS } from '@/components/finance/account-visuals'
import { MoneyDisplay } from '@/components/finance/MoneyDisplay'
import { StatCard } from '@/components/finance/StatCard'
import { StatusBadge } from '@/components/finance/StatusBadge'
import { PageHeader } from '@/components/layout/PageHeader'
import { MonthSelector } from '@/components/navigation/MonthSelector'
import type { Change } from '@/domain/analytics'
import type { ISODate } from '@/domain/entities'
import { add, negate, type Satang } from '@/domain/money'
import { formatUsage, STATUS_BADGE, STATUS_TONE } from '@/features/budget/budget-data'
import { CashFlowCard } from '@/features/dashboard/components/CashFlowCard'
import { DashboardSection } from '@/features/dashboard/components/DashboardSection'
import { ledgerLinkFor } from '@/features/transactions/ledger-data'
import { formatYearMonth, isYearMonth, todayISO, yearMonthOf } from '@/lib/dates'
import { formatDate, formatPercentBps1, formatTHB } from '@/lib/formatting'
import { t } from '@/lib/i18n'
import { buildAnalyticsModel, changeText, loadAnalyticsData, type AnalyticsModel, type AnalyticsRawData } from './analytics-data'

export interface AnalyticsProps {
  today: ISODate
  /** Injected in tests. */
  load?: (month: string) => Promise<AnalyticsRawData>
}

type LoadResult = { ok: true; raw: AnalyticsRawData } | { ok: false }

const money = (amount: Satang) => formatTHB(amount, { trimZeroFraction: true })

function compareHint(change: Change, hasPrevious: boolean, previousMonth: string) {
  return hasPrevious
    ? t('analytics.vs', {
        month: formatYearMonth(previousMonth, 'shortYear'),
        change: changeText(change),
      })
    : t('analytics.noPrevious')
}

function Overview({ model }: { model: AnalyticsModel }) {
  const { totals, comparison, previousMonth } = model
  const left = add(totals.income, negate(totals.expense))
  return (
    <section aria-label={t('analytics.overview')} className="flex flex-col gap-stack">
      <div className="grid grid-cols-2 gap-stack lg:grid-cols-4">
        <StatCard
          label={t('analytics.income')}
          icon={TrendingUp}
          tone="income"
          value={<MoneyDisplay amount={totals.income} tone="income" sign={totals.income ? 'plus' : 'none'} size="lg" />}
          hint={compareHint(comparison.income, comparison.hasPrevious, previousMonth)}
        />
        <StatCard
          label={t('analytics.expense')}
          icon={TrendingDown}
          tone="expense"
          value={<MoneyDisplay amount={totals.expense} size="lg" />}
          hint={compareHint(comparison.expense, comparison.hasPrevious, previousMonth)}
        />
        <StatCard
          label={t('analytics.debtPayment')}
          icon={CreditCard}
          tone="debt"
          value={<MoneyDisplay amount={totals.debtPayment} tone="debt" size="lg" />}
          hint={compareHint(comparison.debtPayment, comparison.hasPrevious, previousMonth)}
        />
        <StatCard
          label={t('analytics.left')}
          icon={PiggyBank}
          tone="primary"
          value={<MoneyDisplay amount={left} size="lg" />}
          hint={`${t('analytics.leftHint')} · ${compareHint(comparison.leftFromIncome, comparison.hasPrevious, previousMonth)}`}
        />
      </div>
      {totals.debtPayment > 0 && (
        <p className="text-xs text-muted-foreground">
          {t('analytics.outflow', {
            total: money(add(totals.expense, totals.debtPayment)),
            expense: money(totals.expense),
            debt: money(totals.debtPayment),
          })}
        </p>
      )}
    </section>
  )
}

function Insights({ model }: { model: AnalyticsModel }) {
  return (
    <DashboardSection title={t('analytics.insights')}>
      {model.insightTexts.length === 0 ? (
        <p className="px-card text-sm text-muted-foreground">{t('analytics.insightsEmpty')}</p>
      ) : (
        <ul aria-label={t('analytics.insights')} className="flex flex-col gap-2 px-card">
          {model.insightTexts.map((text) => (
            <li key={text} className="flex items-start gap-2 text-sm">
              <Lightbulb aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
              {text}
            </li>
          ))}
        </ul>
      )}
    </DashboardSection>
  )
}

function Categories({ model }: { model: AnalyticsModel }) {
  const title = t('analytics.categories.title')
  if (model.categoryRows.length === 0) {
    return (
      <DashboardSection title={title}>
        <p className="px-card text-sm text-muted-foreground">{t('analytics.categories.empty')}</p>
      </DashboardSection>
    )
  }
  const config = Object.fromEntries(model.donut.map((s) => [s.key, { label: s.label, color: s.color }])) satisfies ChartConfig
  const summary = model.categoryRows.map((r) => `${r.label} ${money(r.amount)}, ${formatPercentBps1(r.shareBps)}`).join('; ')
  return (
    <DashboardSection title={title}>
      <div className="flex flex-col gap-stack px-card">
        <ChartContainer title={t('analytics.categories.chart')} summary={summary} config={config} heightClass="h-48" className="mx-auto w-full max-w-64">
          <PieChart>
            <Pie
              data={model.donut.map((s) => ({
                key: s.key,
                amount: Number(s.amount),
                fill: s.color,
              }))}
              dataKey="amount"
              nameKey="key"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={1}
              strokeWidth={0}
              isAnimationActive={false}
            >
              {model.donut.map((s) => (
                <Cell key={s.key} fill={s.color} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        <table className="w-full text-sm" aria-label={t('analytics.categories.table')}>
          <thead className="sr-only">
            <tr>
              <th scope="col">{t('analytics.categories.category')}</th>
              <th scope="col">{t('analytics.categories.amount')}</th>
              <th scope="col">{t('analytics.categories.share')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {model.categoryRows.map((row) => (
              <tr key={row.key}>
                <th scope="row" className="py-1 text-left font-normal">
                  {row.categoryId ? (
                    <Link
                      to={ledgerLinkFor(model.month, row.categoryId)}
                      aria-label={t('analytics.categories.open', {
                        name: row.label,
                      })}
                      className="focus-ring -mx-1 flex min-h-touch items-center gap-2 rounded px-1 hover:underline md:min-h-9"
                    >
                      <span aria-hidden="true">{row.icon}</span>
                      {row.label}
                    </Link>
                  ) : (
                    <span className="flex min-h-touch items-center gap-2 md:min-h-9">{row.label}</span>
                  )}
                </th>
                <td className="py-1 text-right tabular-nums">{money(row.amount)}</td>
                <td className="w-16 py-1 text-right text-muted-foreground tabular-nums">{formatPercentBps1(row.shareBps)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-right text-xs text-muted-foreground">
          {t('analytics.categories.total', {
            amount: money(model.categories.total),
          })}
        </p>
      </div>
    </DashboardSection>
  )
}

function Budget({ model }: { model: AnalyticsModel }) {
  const { budget } = model
  const lines = [...(budget.overall ? [budget.overall] : []), ...budget.categories]
  return (
    <DashboardSection title={t('analytics.budget.title')} to={`/budget?month=${model.month}`}>
      <div className="flex flex-col gap-stack px-card">
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('analytics.budget.empty')}{' '}
            <Link to={`/budget?month=${model.month}`} className="font-medium text-primary hover:underline">
              {t('analytics.budget.open')}
            </Link>
          </p>
        ) : (
          <ul className="flex flex-col gap-stack">
            {lines.map((line) => {
              const overall = line.budget.categoryId === '__overall'
              const name = overall ? t('budget.overall.name') : model.names.category(line.budget.categoryId)
              const usage = line.usageBps === null ? '—' : formatUsage(line.usageBps)
              return (
                <li key={line.budget.id} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    {overall ? (
                      <span className="font-medium">{name}</span>
                    ) : (
                      <Link
                        to={ledgerLinkFor(model.month, line.budget.categoryId)}
                        aria-label={t('analytics.categories.open', { name })}
                        className="focus-ring -mx-1 flex min-h-touch items-center rounded px-1 font-medium hover:underline md:min-h-8"
                      >
                        {name}
                      </Link>
                    )}
                    <StatusBadge status={STATUS_BADGE[line.status]} label={`${usage} · ${t(`budget.status.${line.status}`)}`} />
                  </div>
                  <ProgressBar
                    value={(line.usageBps ?? 0) / 100}
                    label={name}
                    valueText={`${usage} ${t(`budget.status.${line.status}`)}`}
                    tone={STATUS_TONE[line.status]}
                    size="sm"
                  />
                  <span className="text-xs text-muted-foreground">
                    {t('analytics.budget.line', {
                      limit: money(line.limit),
                      spent: money(line.spent),
                      rest:
                        line.overBy > 0
                          ? t('analytics.budget.over', {
                              amount: money(line.overBy),
                            })
                          : t('analytics.budget.left', {
                              amount: money(line.remaining),
                            }),
                    })}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        {lines.length > 0 && <p className="text-xs text-muted-foreground">{t('analytics.budget.note')}</p>}
      </div>
    </DashboardSection>
  )
}

function Debts({ model }: { model: AnalyticsModel }) {
  const { debts } = model
  return (
    <DashboardSection title={t('analytics.debt.title')} to="/debts">
      <div className="flex flex-col gap-stack px-card">
        {debts.lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('analytics.debt.empty')}</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-stack">
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">{t('analytics.debt.outstanding')}</dt>
                <dd>
                  <MoneyDisplay amount={debts.totalOutstanding} tone="debt" size="lg" />
                </dd>
                <dd className="text-xs text-muted-foreground">{t('analytics.debt.count', { count: debts.lines.length })}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">{t('analytics.debt.paid')}</dt>
                <dd>
                  <MoneyDisplay amount={debts.paid} tone="debt" size="lg" />
                </dd>
                <dd className="text-xs text-muted-foreground">
                  {t('analytics.debt.principal')} {money(debts.principal)} · {t('analytics.debt.cost')} {money(debts.interestAndFees)}
                </dd>
              </div>
            </dl>
            {debts.unallocated > 0 && (
              <p className="text-xs text-warning">
                {t('analytics.debt.unallocated', {
                  amount: money(debts.unallocated),
                })}
              </p>
            )}
            <ul className="divide-y divide-border">
              {debts.lines.map((line) => (
                <li key={line.debt.id}>
                  <Link
                    to={`/debts?id=${line.debt.id}`}
                    aria-label={t('analytics.debt.open', {
                      name: line.debt.name,
                    })}
                    className="focus-ring -mx-1 flex min-h-touch flex-col justify-center gap-0.5 rounded px-1 py-2 hover:bg-muted/60"
                  >
                    <span className="text-sm font-medium">{line.debt.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {t('analytics.debt.line', {
                        outstanding:
                          line.outstanding === null
                            ? t('analytics.debt.unknown')
                            : line.outstanding < 0
                              ? t('debts.row.cardCredit', {
                                  amount: money(Math.abs(line.outstanding) as Satang),
                                })
                              : money(line.outstanding),
                        paid: money(line.paid),
                      })}
                    </span>
                    {line.debt.kind === 'credit_card'
                      ? line.paid > 0 && <span className="text-xs text-muted-foreground">{t('analytics.debt.cardNote')}</span>
                      : line.paid > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {t('analytics.debt.split', {
                              principal: money(line.principal),
                              interest: money(line.interest),
                              fees: money(line.fees),
                            })}
                          </span>
                        )}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              {t('analytics.debt.asOf', {
                date: formatDate(model.asOf, 'long'),
              })}
            </p>
          </>
        )}
      </div>
    </DashboardSection>
  )
}

function Cash({ model }: { model: AnalyticsModel }) {
  const { cash } = model
  return (
    <DashboardSection title={t('analytics.cash.title')} to="/accounts">
      <div className="flex flex-col gap-stack px-card">
        {cash.lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('analytics.cash.empty')}</p>
        ) : (
          <>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">
                {t('analytics.cash.available', {
                  date: formatDate(model.asOf, 'long'),
                })}
              </span>
              <MoneyDisplay amount={cash.available} size="lg" />
              <span className="text-xs text-muted-foreground">
                {model.isFuture
                  ? t('analytics.cash.future')
                  : cash.previousAvailable === null
                    ? t('analytics.cash.noPrevious')
                    : t('analytics.cash.change', {
                        diff: `${cash.available - cash.previousAvailable >= 0 ? '+' : '−'}${money(Math.abs(cash.available - cash.previousAvailable) as Satang)}`,
                        month: formatYearMonth(model.previousMonth),
                      })}
              </span>
            </div>
            <ul className="divide-y divide-border">
              {cash.lines.map((line) => (
                <li key={line.account.id} className="flex min-h-touch items-center justify-between gap-3 py-2 md:min-h-10">
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    <span aria-hidden="true" className="text-muted-foreground">
                      {createElement(ACCOUNT_KIND_VISUALS[line.account.kind].icon, { className: 'size-4' })}
                    </span>
                    <span className="truncate">{line.account.name}</span>
                    {line.group !== 'available' && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        · {line.group === 'card' ? t(line.balance > 0 ? 'analytics.cash.cardCredit' : 'analytics.cash.card') : t('analytics.cash.other')}
                      </span>
                    )}
                  </span>
                  {/* A card's balance is negative while it is owed: show what is owed, or the credit left after overpaying. */}
                  <MoneyDisplay
                    amount={line.group === 'card' ? (Math.abs(line.balance) as Satang) : line.balance}
                    tone={line.group === 'card' && line.balance < 0 ? 'debt' : 'neutral'}
                    size="md"
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </DashboardSection>
  )
}

function Recurring({ model }: { model: AnalyticsModel }) {
  const { recurring } = model
  return (
    <DashboardSection title={t('analytics.recurring.title')} to="/recurring">
      <div className="flex flex-col gap-stack px-card">
        {recurring.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('analytics.recurring.empty')}</p>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {recurring.items.map((item) => (
                <li key={item.sourceId} className="flex min-h-10 items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 truncate">
                    {model.names.obligation(item.sourceId)}
                    {item.count > 1 && <span className="text-xs text-muted-foreground"> · {t('analytics.recurring.times', { count: item.count })}</span>}
                  </span>
                  <MoneyDisplay amount={item.amount} size="md" />
                </li>
              ))}
            </ul>
            <p className="text-sm">
              {t('analytics.recurring.total', {
                amount: money(recurring.total),
                other: money(recurring.other),
              })}
            </p>
          </>
        )}
        <p className="text-xs text-muted-foreground">{t('analytics.recurring.note')}</p>
      </div>
    </DashboardSection>
  )
}

/**
 * Analytics: descriptive monthly reporting from actual records (month in the
 * URL, `#/analytics?month=2026-09`). Every figure reuses the existing
 * reporting, budget, debt and account functions; no predictions or advice.
 */
export function AnalyticsView({ today, load = loadAnalyticsData }: AnalyticsProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const currentMonth = yearMonthOf(today)
  const param = searchParams.get('month')
  const month = isYearMonth(param) ? param : currentMonth
  const [attempt, setAttempt] = useState(0)

  const result = useLiveQuery<LoadResult>(
    () =>
      load(month).then(
        (raw) => ({ ok: true as const, raw }),
        () => ({ ok: false as const }),
      ),
    [load, month, attempt],
  )
  const raw = result?.ok && result.raw.month === month ? result.raw : null
  const model = useMemo(() => (raw ? buildAnalyticsModel(raw, today) : null), [raw, today])

  return (
    <div className="flex flex-col gap-section">
      <PageHeader
        title={t('analytics.title')}
        description={month === currentMonth ? t('analytics.subtitle') : t('analytics.subtitleMonth', { month: formatYearMonth(month) })}
        actions={
          <MonthSelector
            value={month}
            onChange={(next) =>
              setSearchParams(next === currentMonth ? {} : { month: next }, {
                replace: true,
              })
            }
            currentMonth={currentMonth}
          />
        }
      />

      {!model && !(result && !result.ok) && <LoadingState variant="cards" count={4} />}
      {result && !result.ok && <ErrorState onRetry={() => setAttempt((n) => n + 1)} />}

      {model && !model.hasAnyData && <EmptyState icon={BarChart3} title={t('analytics.empty')} description={t('analytics.emptyHint')} />}

      {model && model.hasAnyData && (
        <>
          <Overview model={model} />
          <Insights model={model} />
          <div className="grid gap-section lg:grid-cols-2">
            <CashFlowCard points={model.trend} month={model.month} />
            <Categories model={model} />
          </div>
          <div className="grid gap-section lg:grid-cols-2">
            <Budget model={model} />
            <Debts model={model} />
          </div>
          <div className="grid gap-section lg:grid-cols-2">
            <Cash model={model} />
            <Recurring model={model} />
          </div>
        </>
      )}
    </div>
  )
}

/** Route entry (lazy-loaded). */
export function AnalyticsPage() {
  const [today] = useState(todayISO)
  return <AnalyticsView today={today} />
}
