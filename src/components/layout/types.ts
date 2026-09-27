import type { LucideIcon } from 'lucide-react'
import type { MessageKey } from '@/lib/i18n'

export interface ShellNavItem {
  /** Route path inside the hash, e.g. "/expenses". */
  path: string
  labelKey: MessageKey
  icon: LucideIcon
  /** Also shown in the mobile bottom navigation (keep to 3 items; "+" and "เพิ่มเติม" are added). */
  bottomNav?: boolean
}

export interface ShellQuickAction {
  /** Accessible name of the central "+" button. */
  labelKey: MessageKey
  /** Called when "+" is pressed (opens the quick-entry menu). */
  onSelect: () => void
}
