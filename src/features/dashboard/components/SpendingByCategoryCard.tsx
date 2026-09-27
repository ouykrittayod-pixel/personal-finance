import { PieChart as PieIcon } from 'lucide-react'
import { Cell, Pie, PieChart } from 'recharts'
import { ChartContainer, type ChartConfig } from '@/components/data/ChartContainer'
import { EmptyState } from '@/components/feedback/EmptyState'
import { MoneyDisplay } from '@/components/finance/MoneyDisplay'
import { Card } from '@/components/ui/card'
import { formatPercentBps, formatTHB } from '@/lib/formatting'
import { t } from '@/lib/i18n'
import type { DashboardModel } from '../dashboard-data'

export function SpendingByCategoryCard({ spending }: { spending: DashboardModel['spending'] }) {
  const title = t('dashboard.spending.title')

  if (spending.slices.length === 0) {
    return (
      <Card className="px-card">
        <h2 className="text-base font-semibold">{title}</h2>
        <EmptyState icon={PieIcon} title={t('dashboard.spending.empty')} description={t('dashboard.spending.emptyHint')} className="border-none py-6" />
      </Card>
    )
  }

  const config = Object.fromEntries(spending.slices.map((s) => [s.key, { label: s.label, color: s.color }])) satisfies ChartConfig
  const summary = t('dashboard.spending.summary', {
    total: formatTHB(spending.total, { trimZeroFraction: true }),
    parts: spending.slices
      .map((s) => `${s.label} ${formatTHB(s.amount, { trimZeroFraction: true })} (${formatPercentBps(s.shareBps)})`)
      .join(', '),
  })
  // Recharts needs plain numbers; satang integers are fine for proportions.
  const data = spending.slices.map((s) => ({ key: s.key, amount: Number(s.amount), fill: s.color }))

  return (
    <Card className="px-card">
      <div className="grid items-center gap-stack sm:grid-cols-[minmax(0,13rem)_1fr]">
        <ChartContainer title={title} summary={summary} config={config} heightClass="h-48 sm:h-52" className="mx-auto w-full max-w-64 sm:max-w-none">
          <PieChart>
            <Pie data={data} dataKey="amount" nameKey="key" innerRadius="62%" outerRadius="92%" paddingAngle={1} strokeWidth={0} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.key} fill={d.fill} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>

        <div className="flex flex-col gap-stack">
          <dl className="flex items-baseline justify-between gap-2 border-b pb-2">
            <dt className="text-sm text-muted-foreground">{t('dashboard.spending.total')}</dt>
            <dd>
              <MoneyDisplay amount={spending.total} tone="expense" sign="none" size="lg" />
            </dd>
          </dl>
          <ul className="flex flex-col gap-2 text-sm">
            {spending.slices.map((slice) => (
              <li key={slice.key} className="flex items-center gap-2">
                <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} />
                <span className="min-w-0 flex-1 truncate">
                  {slice.icon && <span aria-hidden="true">{slice.icon} </span>}
                  {slice.label}
                </span>
                <MoneyDisplay amount={slice.amount} size="sm" />
                <span className="tabular-nums-money w-10 text-right text-xs text-muted-foreground">{formatPercentBps(slice.shareBps)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  )
}
