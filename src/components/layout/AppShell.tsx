import { X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { IconButton } from '@/components/actions/buttons'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { t } from '@/lib/i18n'
import { Header } from './Header'
import { MobileBottomNavigation } from './MobileBottomNavigation'
import { Brand, NavList, Sidebar } from './Sidebar'
import type { ShellNavItem, ShellQuickAction } from './types'

export interface AppShellProps {
  navItems: readonly ShellNavItem[]
  quickAction: ShellQuickAction
  /** Global actions in the tablet/desktop header (e.g. "+ บันทึกรายจ่าย"). */
  headerActions?: ReactNode
  /** Always-visible header status (sync state). */
  headerStatus?: ReactNode
  children: ReactNode
}

/**
 * Responsive application frame.
 *
 * | viewport        | navigation                         | header                  |
 * |-----------------|------------------------------------|-------------------------|
 * | < md (phone)    | bottom bar + central "+" + drawer  | compact, section name   |
 * | md–lg (tablet)  | icon rail                          | section name + "+" btn  |
 * | ≥ lg (desktop)  | full sidebar                       | section name + "+" btn  |
 *
 * Content is capped at --container-content and padded with --spacing-page-*.
 */
export function AppShell({ navItems, quickAction, headerActions, headerStatus, children }: AppShellProps) {
  const { pathname } = useLocation()
  // The drawer menu belongs to the route it was opened on, so any navigation
  // (link, back button, typed URL) closes it without extra effects.
  const [menuPath, setMenuPath] = useState<string | null>(null)
  const menuOpen = menuPath === pathname
  const setMenuOpen = (open: boolean) => setMenuPath(open ? pathname : null)

  // Close the phone menu if the viewport grows into the tablet/desktop layout.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(min-width: 48rem)')
    const onChange = () => {
      if (query.matches) setMenuPath(null)
    }
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  const current = navItems.find((item) => item.path === pathname)
  const title = current ? t(current.labelKey) : t('app.name')
  const bottomItems = navItems.filter((item) => item.bottomNav)

  return (
    <div className="min-h-svh bg-background">
      <a
        href="#main-content"
        onClick={(event) => {
          // Hash routing owns the URL fragment; move focus without navigating.
          event.preventDefault()
          document.getElementById('main-content')?.focus()
        }}
        className="focus-ring sr-only z-50 rounded-md bg-background px-3 py-2 text-sm focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {t('nav.skipToContent')}
      </a>

      <Sidebar items={navItems} />

      <div className="flex min-h-svh flex-col md:pl-sidebar-rail lg:pl-sidebar">
        <Header
          title={title}
          status={headerStatus}
          actions={headerActions ? <div className="hidden items-center gap-2 md:flex">{headerActions}</div> : undefined}
        />

        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-content flex-1 px-page-x pt-page-y pb-[calc(var(--spacing-bottom-nav)+env(safe-area-inset-bottom)+var(--spacing-page-y))] outline-none md:pb-page-y"
        >
          {/* Keyed by route: a short fade confirms navigation without slowing it. */}
          <div key={pathname} className="animate-in duration-(--duration-base) fade-in-0">
            {children}
          </div>
        </main>
      </div>

      <MobileBottomNavigation
        items={bottomItems}
        quickAction={quickAction}
        menuOpen={menuOpen}
        onOpenMenu={() => setMenuOpen(true)}
      />

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" showCloseButton={false} className="w-72 gap-0 bg-sidebar p-0">
          <SheetHeader className="flex-row items-center justify-between gap-2 pr-2 pb-2">
            <SheetTitle className="sr-only">{t('nav.menu')}</SheetTitle>
            <SheetDescription className="sr-only">{t('app.tagline')}</SheetDescription>
            <Brand />
            <SheetClose asChild>
              <IconButton label={t('common.close')} icon={<X />} />
            </SheetClose>
          </SheetHeader>
          <nav aria-label={t('nav.main')} className="overflow-y-auto px-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <NavList items={navItems} onNavigate={() => setMenuOpen(false)} />
          </nav>
        </SheetContent>
      </Sheet>
    </div>
  )
}
