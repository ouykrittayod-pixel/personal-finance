import { ArrowLeftRight, BarChart3, CalendarDays, CalendarRange, CreditCard, HandCoins, LayoutDashboard, PiggyBank, Receipt, Repeat, Settings, Wallet } from 'lucide-react'
import type { ShellNavItem } from '@/components/layout/types'

export type NavItem = ShellNavItem

/** Single source of truth for navigation order, labels, icons and bottom-bar membership. */
export const NAV_ITEMS: readonly NavItem[] = [
  { path: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard, bottomNav: true },
  // The monthly plan replaces budget in the bottom bar: planning next month's bills is the app's main job.
  { path: '/plan', labelKey: 'nav.plan', icon: CalendarRange, bottomNav: true },
  { path: '/expenses', labelKey: 'nav.expenses', icon: Receipt },
  { path: '/transactions', labelKey: 'nav.transactions', icon: ArrowLeftRight, bottomNav: true },
  { path: '/recurring', labelKey: 'nav.recurring', icon: Repeat },
  { path: '/debts', labelKey: 'nav.debts', icon: CreditCard },
  { path: '/income', labelKey: 'nav.income', icon: HandCoins },
  { path: '/accounts', labelKey: 'nav.accounts', icon: Wallet },
  { path: '/calendar', labelKey: 'nav.calendar', icon: CalendarDays },
  { path: '/budget', labelKey: 'nav.budget', icon: PiggyBank },
  { path: '/analytics', labelKey: 'nav.analytics', icon: BarChart3 },
  { path: '/settings', labelKey: 'nav.settings', icon: Settings },
]
