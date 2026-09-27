import { Loader2 } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type BaseButtonProps = Omit<ComponentProps<typeof Button>, 'variant' | 'size'> & {
  /** `md` = 44px touch target on mobile, compact from tablet up. `lg` = 48px everywhere (form submit). */
  size?: 'md' | 'lg'
  /** Shows a spinner, disables the button and sets aria-busy. */
  loading?: boolean
}

/** With asChild the single child element is the button, so nothing may be prepended. */
function content(asChild: boolean | undefined, loading: boolean | undefined, children: ReactNode) {
  if (asChild) return children
  return (
    <>
      {loading && <Loader2 className="animate-spin" aria-hidden="true" />}
      {children}
    </>
  )
}

/** The main action on a screen. Use at most one per view. */
export function PrimaryButton({ size = 'md', loading, disabled, asChild, children, ...props }: BaseButtonProps) {
  return (
    <Button
      variant="default"
      size={size === 'lg' ? 'touch-lg' : 'touch'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      asChild={asChild}
      {...props}
    >
      {content(asChild, loading, children)}
    </Button>
  )
}

/** Supporting actions (cancel, filters, secondary choices). */
export function SecondaryButton({ size = 'md', loading, disabled, asChild, children, ...props }: BaseButtonProps) {
  return (
    <Button
      variant="outline"
      size={size === 'lg' ? 'touch-lg' : 'touch'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      asChild={asChild}
      {...props}
    >
      {content(asChild, loading, children)}
    </Button>
  )
}

export type IconButtonProps = Omit<ComponentProps<typeof Button>, 'size' | 'children' | 'aria-label'> & {
  /** Required accessible name — icon-only buttons have no visible text. */
  label: string
  icon: ReactNode
}

/** Icon-only button, 44×44 on touch screens. */
export function IconButton({ label, icon, variant = 'ghost', className, ...props }: IconButtonProps) {
  return (
    <Button variant={variant} size="icon-touch" aria-label={label} title={label} className={cn(className)} {...props}>
      {icon}
    </Button>
  )
}
