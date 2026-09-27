import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface CategoryBadgeProps {
  label: string
  /** Emoji or a Lucide icon element chosen for the category. */
  icon?: ReactNode
  /** Optional category colour (any CSS colour) shown as a small dot, never as the text colour. */
  color?: string
  className?: string
}

/** Neutral pill naming a category. Colour is an accent only, so text contrast stays constant. */
export function CategoryBadge({ label, icon, color, className }: CategoryBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full bg-neutral-muted px-2.5 py-0.5 text-xs font-medium text-foreground',
        '[&_svg]:size-3.5 [&_svg]:shrink-0',
        className,
      )}
    >
      {icon ? (
        <span aria-hidden="true" className="leading-none">
          {icon}
        </span>
      ) : color ? (
        <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      ) : null}
      <span className="truncate">{label}</span>
    </span>
  )
}
