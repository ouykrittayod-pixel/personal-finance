import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Card } from '@/components/ui/card'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export interface DashboardSectionProps {
  title: string
  /** "ดูทั้งหมด" destination. */
  to?: string
  children: ReactNode
  /** Remove body padding for edge-to-edge lists. */
  flush?: boolean
  className?: string
}

/** A titled dashboard card with an optional "ดูทั้งหมด" link. */
export function DashboardSection({ title, to, children, flush = false, className }: DashboardSectionProps) {
  return (
    <Card className={cn('gap-stack', flush && 'pb-0', className)}>
      <div className="flex items-center justify-between gap-2 px-card">
        <h2 className="text-base font-semibold">{title}</h2>
        {to && (
          <Link
            to={to}
            className="focus-ring -mr-2 flex min-h-touch items-center gap-0.5 rounded-md px-2 text-sm font-medium text-primary hover:underline md:min-h-8"
          >
            {t('dashboard.viewAll')}
            <span className="sr-only"> {title}</span>
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        )}
      </div>
      <div className={cn(!flush && 'px-card')}>{children}</div>
    </Card>
  )
}
