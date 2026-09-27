import type { ReactNode } from 'react'
import {
  Dialog as DialogRoot,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

export interface DialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Element that opens the dialog (rendered with asChild). */
  trigger?: ReactNode
  title: string
  description?: string
  children?: ReactNode
  /** Action buttons; primary action last (right on desktop, bottom on mobile). */
  footer?: ReactNode
  className?: string
}

/**
 * Centred modal for short confirmations and small forms.
 * Focus trap, Escape to close, labelled by title/description (Radix).
 * For longer mobile forms prefer Drawer.
 */
export function Dialog({ open, onOpenChange, trigger, title, description, children, footer, className }: DialogProps) {
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className={cn('gap-section sm:max-w-md', className)}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
        </DialogHeader>
        {children}
        {footer && <DialogFooter className="gap-2">{footer}</DialogFooter>}
      </DialogContent>
    </DialogRoot>
  )
}

export { DialogClose } from '@/components/ui/dialog'
