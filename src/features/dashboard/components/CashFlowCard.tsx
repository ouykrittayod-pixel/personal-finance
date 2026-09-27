import { BarChart3 } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { CHART_COLORS } from '@/components/data/chart-colors'
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/data/ChartContainer'
import { EmptyState } from '@/components/feedback/EmptyState'
import { Card } from '@/components/ui/card'
import { satang } from '@/domain/money'
import type { CashFlowPoint } from '@/domain/reporting'
import { formatCompactTHB, formatTHB } from '@/lib/formatting'
import { formatYearMonth } from '@/lib/dates'
import { t } from '@/lib/i18n'

const config = {
  income: { label: t('dashboard.cashflow.income'), color: CHART_COLORS.income },
  expense: { label: t('dashboard.cashflow.expense'), color: CHART_COLORS.expense },
  debtPayment: { label: t('dashboard.cashflow.debt'), color: CHART_COLORS.debt },
  transfer: { label: t('dashboard.cashflow.transfer'), color: CHART_COLORS.series[3] },
} satisfies ChartConfig

const money = (value: number) => formatTHB(satang(Math.round(value)), { trimZeroFraction: true })

/** Monthly income, expenses, debt payments and transfers as separate bar series. */
export function CashFlowCard({ points, month }: { points: CashFlowPoint[]; month: string }) {
  const title = t('dashboard.cashflow.title')
  const description = t('dashboard.cashflow.description', { month: formatYearMonth(month) })
  const hasData = points.some((p) => p.income > 0 || p.expense > 0 || p.debtPayment > 0 || p.transfer > 0)

  if (!hasData) {
    return (
      <Card className="px-card">
        <h2 className="text-base font-semibold">{title}</h2>
        <EmptyState icon={BarChart3} title={t('dashboard.cashflow.empty')} className="border-none py-6" />
      </Card>
    )
  }

  const summary = points
    .filter((p) => p.income > 0 || p.expense > 0 || p.debtPayment > 0 || p.transfer > 0)
    .map((p) =>
      t('dashboard.cashflow.summaryMonth', {
        month: formatYearMonth(p.month),
        income: money(p.income),
        expense: money(p.expense),
        debt: money(p.debtPayment),
        transfer: money(p.transfer),
      }),
    )
    .join('; ')

  const data = points.map((p) => ({
    label: formatYearMonth(p.month, 'short'),
    income: Number(p.income),
    expense: Number(p.expense),
    debtPayment: Number(p.debtPayment),
    transfer: Number(p.transfer),
  }))

  return (
    <Card className="px-card">
      <ChartContainer title={title} description={description} summary={summary} config={config}>
        <BarChart data={data} barGap={2} margin={{ left: 0, right: 0, top: 4 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis
            width={52}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) => formatCompactTHB(satang(Math.round(value)))}
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                formatter={(value, name, item) => (
                  <div className="flex w-full items-center gap-2">
                    <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
                    <span className="text-muted-foreground">{config[name as keyof typeof config]?.label ?? name}</span>
                    <span className="tabular-nums-money ml-auto font-medium text-foreground">{money(Number(value))}</span>
                  </div>
                )}
              />
            }
          />
          {/* null keeps series order (income, expense, debt, transfer) instead of sorting by key. */}
          <ChartLegend itemSorter={null} content={<ChartLegendContent />} />
          <Bar dataKey="income" fill="var(--color-income)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="expense" fill="var(--color-expense)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="debtPayment" fill="var(--color-debtPayment)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="transfer" fill="var(--color-transfer)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ChartContainer>
    </Card>
  )
}
