import { createContext, useContext } from 'react'

export interface QuickEntryApi {
  /** Open the "+" menu (รายจ่าย / รายรับ / ชำระบิล / ชำระหนี้). */
  openMenu: () => void
  /** Open the Quick Expense form directly. */
  openExpense: () => void
  /** Open the same quick form for income. */
  openIncome: () => void
  /** Open the same quick form for a transfer, optionally from a given account. */
  openTransfer: (fromAccountId?: string) => void
}

export const QuickEntryContext = createContext<QuickEntryApi | null>(null)

export function useQuickEntry(): QuickEntryApi {
  const api = useContext(QuickEntryContext)
  if (!api) throw new Error('useQuickEntry must be used inside <QuickEntryProvider>')
  return api
}

/** Null outside the provider (e.g. a component rendered on its own in tests). */
export function useOptionalQuickEntry(): QuickEntryApi | null {
  return useContext(QuickEntryContext)
}
