import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { IconButton } from '@/components/actions/buttons'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useIsWideScreen } from '@/hooks/use-media-query'
import { useVisualViewportHeight } from '@/hooks/use-visual-viewport'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export interface DrawerProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: ReactNode
  title: string
  description?: string
  children?: ReactNode
  /** Sticky action area (e.g. the save button) — stays above the keyboard and home indicator. */
  footer?: ReactNode
  /**
   * `auto`: bottom sheet sized to content (centred card on tablet/desktop).
   * `full`: full-screen form on phones (height follows the visible area, so the
   * footer stays above the keyboard); right-side panel on tablet/desktop.
   */
  size?: 'auto' | 'full'
  /** Element to focus when opened (default: first focusable). */
  onOpenAutoFocus?: (event: Event) => void
  className?: string
}

/**
 * Sheet for mobile-first forms and menus.
 * Built on the Radix dialog (focus trap, Escape, labelled) — no extra dependency.
 */
export function Drawer({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  footer,
  size = 'auto',
  onOpenAutoFocus,
  className,
}: DrawerProps) {
  const wide = useIsWideScreen()
  const visibleHeight = useVisualViewportHeight()
  const full = size === 'full'
  const side = full && wide ? 'right' : 'bottom'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {trigger && <SheetTrigger asChild>{trigger}</SheetTrigger>}
      <SheetContent
        side={side}
        showCloseButton={false}
        onOpenAutoFocus={onOpenAutoFocus}
        style={full && !wide && visibleHeight ? { height: visibleHeight, maxHeight: 'none' } : undefined}
        className={cn(
          'gap-0',
          !full && 'mx-auto max-h-[92dvh] w-full rounded-t-xl border-x md:bottom-4 md:max-w-form md:rounded-xl md:border',
          full && !wide && 'top-0 h-dvh max-h-none w-full rounded-none border-none',
          full && wide && 'w-full max-w-md sm:max-w-md',
          className,
        )}
      >
        {!full && <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/30 md:hidden" />}
        <header
          className={cn(
            'flex items-start justify-between gap-2 px-card pb-stack',
            full ? 'border-b pt-[calc(var(--spacing-stack)+env(safe-area-inset-top))]' : 'pt-2',
          )}
        >
          <div className={cn('flex flex-col gap-0.5', !full && 'pt-2', full && 'self-center')}>
            <SheetTitle className="text-base font-semibold">{title}</SheetTitle>
            <SheetDescription className={cn(!description && 'sr-only')}>{description ?? title}</SheetDescription>
          </div>
          <SheetClose asChild>
            <IconButton label={t('common.close')} icon={<X />} />
          </SheetClose>
        </header>
        <div className={cn('flex-1 overflow-y-auto overscroll-contain px-card pb-card', full && 'pt-card')}>{children}</div>
        {footer && (
          <footer className="flex gap-2 border-t bg-background px-card pt-stack pb-[calc(var(--spacing-stack)+env(safe-area-inset-bottom))] *:flex-1">
            {footer}
          </footer>
        )}
      </SheetContent>
    </Sheet>
  )
}
