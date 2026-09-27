import { Wallet } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface HeaderProps {
  /** Current section name (the page's own h1 lives in PageHeader). */
  title: string
  /** Right-aligned actions, e.g. the desktop quick-add button. */
  actions?: ReactNode
  className?: string
}

/**
 * Top bar. Phones: compact (app mark + section name). Tablet/desktop: section
 * name + global actions. Sticky so actions stay reachable while scrolling.
 */
export function Header({ title, actions, className }: HeaderProps) {
  return (
    <header
      className={cn(
        'sticky top-0 z-(--z-index-header) flex h-[calc(var(--spacing-header)+env(safe-area-inset-top))] items-center gap-3 border-b bg-background px-page-x',
        'pt-[env(safe-area-inset-top)]',
        className,
      )}
    >
      <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground md:hidden">
        <Wallet className="size-4" />
      </span>
      <p className="min-w-0 flex-1 truncate text-base font-semibold md:text-sm md:font-medium md:text-muted-foreground">
        {title}
      </p>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}
