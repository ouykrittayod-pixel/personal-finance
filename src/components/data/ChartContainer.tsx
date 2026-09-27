import type { ComponentProps, ReactNode } from 'react'
import { ChartContainer as ChartCanvas, type ChartConfig } from '@/components/ui/chart'
import { cn } from '@/lib/utils'

export type { ChartConfig }
export { ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'

export interface ChartContainerProps {
  title: string
  description?: string
  /** Series config: labels + colours. Use CHART_COLORS (semantic tokens), never raw hex. */
  config: ChartConfig
  /** A Recharts chart element (BarChart, LineChart, …). */
  children: ComponentProps<typeof ChartCanvas>['children']
  /**
   * Plain-language summary for screen readers, e.g. "รายจ่ายเดือนนี้สูงสุดคือหมวดอาหาร".
   * Charts are visual; this keeps the insight accessible.
   */
  summary: string
  /** Optional controls (Tabs / period picker) aligned right of the title. */
  actions?: ReactNode
  /** Tailwind height class for the plot area. */
  heightClass?: string
  className?: string
}

/**
 * Titled, accessible frame for every chart. Wraps shadcn's ChartContainer so
 * colours come from CSS variables and follow light/dark themes.
 */
export function ChartContainer({
  title,
  description,
  config,
  children,
  summary,
  actions,
  heightClass = 'h-56 md:h-64',
  className,
}: ChartContainerProps) {
  return (
    <figure className={cn('flex flex-col gap-stack', className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <figcaption className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">{title}</span>
          {description && <span className="text-xs text-muted-foreground">{description}</span>}
        </figcaption>
        {actions}
      </div>
      <p className="sr-only">{summary}</p>
      <div aria-hidden="true">
        <ChartCanvas config={config} className={cn('aspect-auto w-full', heightClass)}>
          {children}
        </ChartCanvas>
      </div>
    </figure>
  )
}
