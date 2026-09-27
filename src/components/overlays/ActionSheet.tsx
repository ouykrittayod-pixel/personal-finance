import type { LucideIcon } from 'lucide-react'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Drawer } from './Drawer'

export type ActionTone = 'expense' | 'income' | 'debt' | 'info' | 'neutral'

export interface ActionSheetItem {
  id: string
  label: string
  description?: string
  icon: LucideIcon
  tone: ActionTone
  onSelect?: () => void
  /** Shown but not selectable yet (e.g. a feature still to be built). */
  disabled?: boolean
}

const TONE: Record<ActionTone, string> = {
  expense: 'bg-expense-muted text-expense',
  income: 'bg-income-muted text-income',
  debt: 'bg-debt-muted text-debt',
  info: 'bg-info-muted text-info',
  neutral: 'bg-neutral-muted text-foreground',
}

export interface ActionSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  items: readonly ActionSheetItem[]
}

/** A short list of big, thumb-friendly choices (e.g. the "+" menu). */
export function ActionSheet({ open, onOpenChange, title, items }: ActionSheetProps) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} title={title}>
      <ul className="grid grid-cols-2 gap-2">
        {items.map(({ id, label, description, icon: Icon, tone, onSelect, disabled }) => (
          <li key={id}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                onOpenChange(false)
                onSelect?.()
              }}
              className={cn(
                'focus-ring flex min-h-24 w-full flex-col items-start gap-2 rounded-lg border p-3 text-left transition-colors duration-(--duration-fast)',
                'hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent',
              )}
            >
              <span aria-hidden="true" className={cn('flex size-9 items-center justify-center rounded-full', TONE[tone])}>
                <Icon className="size-5" />
              </span>
              <span className="flex flex-col">
                <span className="font-medium">{label}</span>
                {(description || disabled) && (
                  <span className="text-xs text-muted-foreground">{disabled ? t('common.comingSoon') : description}</span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Drawer>
  )
}
