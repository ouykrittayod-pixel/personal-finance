import type { SetupItemKey } from '@/domain/setup'

/** Where each setup item is done — the existing pages (nothing new to learn). */
export const SETUP_LINKS: Record<Exclude<SetupItemKey, 'firstEntry'>, string> = {
  accounts: '/accounts',
  categories: '/settings',
  income: '/income',
  debts: '/debts',
  recurring: '/recurring',
  budget: '/budget',
}
