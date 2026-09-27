import { Wallet } from 'lucide-react'
import { NavLink } from 'react-router'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { ShellNavItem } from './types'

/** App mark + name. `collapsible` hides the text on the tablet icon rail. */
export function Brand({ collapsible = false }: { collapsible?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2 px-3', collapsible && 'md:max-lg:justify-center md:max-lg:px-0')}>
      <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Wallet className="size-4" />
      </span>
      <div className={cn('min-w-0 leading-tight', collapsible && 'md:max-lg:sr-only')}>
        <div className="truncate text-sm font-semibold">{t('app.name')}</div>
        <div className="truncate text-xs text-muted-foreground">{t('app.tagline')}</div>
      </div>
    </div>
  )
}

export interface NavListProps {
  items: readonly ShellNavItem[]
  onNavigate?: () => void
  /** Icon-only between md and lg (tablet rail); labels stay available to screen readers. */
  collapsible?: boolean
}

export function NavList({ items, onNavigate, collapsible = false }: NavListProps) {
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map(({ path, labelKey, icon: Icon }) => {
        const label = t(labelKey)
        return (
          <li key={path}>
            <NavLink
              to={path}
              end={path === '/'}
              onClick={onNavigate}
              title={collapsible ? label : undefined}
              className={({ isActive }) =>
                cn(
                  'focus-ring flex min-h-touch items-center gap-3 rounded-md px-3 text-sm transition-colors duration-(--duration-fast) md:min-h-10',
                  'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                  collapsible && 'md:max-lg:justify-center md:max-lg:px-0',
                  isActive
                    ? 'bg-sidebar-accent font-medium text-sidebar-primary'
                    : 'text-sidebar-foreground',
                )
              }
            >
              <Icon className="size-5 shrink-0 lg:size-4" aria-hidden="true" />
              <span className={cn(collapsible && 'md:max-lg:sr-only')}>{label}</span>
            </NavLink>
          </li>
        )
      })}
    </ul>
  )
}

export interface SidebarProps {
  items: readonly ShellNavItem[]
  className?: string
}

/**
 * Persistent navigation from tablet up: icon rail at md, full sidebar at lg.
 * Hidden on phones (bottom navigation + drawer take over).
 */
export function Sidebar({ items, className }: SidebarProps) {
  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-(--z-index-header) hidden w-sidebar-rail flex-col gap-section overflow-y-auto border-r border-sidebar-border bg-sidebar py-4 md:flex lg:w-sidebar',
        className,
      )}
    >
      <Brand collapsible />
      <nav aria-label={t('nav.main')} className="px-2">
        <NavList items={items} collapsible />
      </nav>
    </aside>
  )
}
