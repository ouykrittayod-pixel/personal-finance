import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface TransactionListProps {
  children: ReactNode
  /** Accessible name for the list when there is no visible group heading. */
  label?: string
  className?: string
}

/**
 * Flat list of TransactionRow items: hairline dividers, no card per row.
 * For lists grouped by day, stack TransactionGroup elements instead (each has its own list).
 */
export function TransactionList({ children, label, className }: TransactionListProps) {
  return (
    <ul aria-label={label} className={cn('divide-y divide-border', className)}>
      {children}
    </ul>
  )
}

export interface TransactionGroupProps {
  /** Group heading, typically a formatted date ("วันนี้", "25 ก.ย. 2026"). */
  title: ReactNode
  /** Right-aligned summary, typically a day-total MoneyDisplay (computed by the caller). */
  summary?: ReactNode
  children: ReactNode
  className?: string
  /** Heading level for the title: 2 when the groups sit directly under the page's h1. Default 3. */
  headingLevel?: 2 | 3
}

/** A titled section of transactions, e.g. one day. */
export function TransactionGroup({ title, summary, children, className, headingLevel = 3 }: TransactionGroupProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  return (
    <section className={cn('flex flex-col', className)}>
      <header className="flex items-baseline justify-between gap-3 border-b px-card pt-stack pb-2">
        <Heading className="text-xs font-semibold text-muted-foreground">{title}</Heading>
        {summary && <div className="text-xs text-muted-foreground">{summary}</div>}
      </header>
      <ul className="divide-y divide-border">{children}</ul>
    </section>
  )
}
