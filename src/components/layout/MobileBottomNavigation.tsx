import { Menu, Plus } from 'lucide-react'
import { NavLink } from 'react-router'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { ShellNavItem, ShellQuickAction } from './types'
import { useSoftKeyboardOpen } from './use-soft-keyboard'

export interface MobileBottomNavigationProps {
  /** Up to 3 destinations; the "+" goes in the middle and "เพิ่มเติม" last. */
  items: readonly ShellNavItem[]
  quickAction: ShellQuickAction
  onOpenMenu: () => void
  menuOpen?: boolean
  className?: string
}

const slotClass =
  'focus-ring flex min-h-touch flex-1 flex-col items-center justify-center gap-0.5 rounded-md text-[0.6875rem] leading-tight transition-colors duration-(--duration-fast)'

/**
 * Phone navigation in the thumb zone: 5 equal slots with a raised central "+"
 * for the most frequent task (recording an expense). Hidden while typing.
 */
export function MobileBottomNavigation({ items, quickAction, onOpenMenu, menuOpen = false, className }: MobileBottomNavigationProps) {
  const keyboardOpen = useSoftKeyboardOpen()
  const half = Math.ceil(items.length / 2)
  const left = items.slice(0, half)
  const right = items.slice(half)

  const renderItem = ({ path, labelKey, icon: Icon }: ShellNavItem) => (
    <NavLink
      key={path}
      to={path}
      end={path === '/'}
      className={({ isActive }) => cn(slotClass, isActive ? 'font-medium text-primary' : 'text-muted-foreground')}
    >
      <Icon className="size-5" aria-hidden="true" />
      <span>{t(labelKey)}</span>
    </NavLink>
  )

  return (
    <nav
      aria-label={t('nav.mobile')}
      hidden={keyboardOpen}
      className={cn(
        'fixed inset-x-0 bottom-0 z-(--z-index-bottom-nav) border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden',
        className,
      )}
    >
      <div className="mx-auto flex h-bottom-nav max-w-lg items-stretch gap-1 px-2">
        {left.map(renderItem)}

        <div className="flex flex-1 items-start justify-center">
          <button
            type="button"
            onClick={quickAction.onSelect}
            aria-haspopup="dialog"
            aria-label={t(quickAction.labelKey)}
            title={t(quickAction.labelKey)}
            className={cn(
              'focus-ring -mt-4 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md',
              'transition-transform duration-(--duration-fast) active:scale-95',
            )}
          >
            <Plus className="size-7" aria-hidden="true" />
          </button>
        </div>

        {right.map(renderItem)}

        <button
          type="button"
          onClick={onOpenMenu}
          aria-expanded={menuOpen}
          aria-haspopup="dialog"
          className={cn(slotClass, 'text-muted-foreground')}
        >
          <Menu className="size-5" aria-hidden="true" />
          <span>{t('nav.more')}</span>
        </button>
      </div>
    </nav>
  )
}
