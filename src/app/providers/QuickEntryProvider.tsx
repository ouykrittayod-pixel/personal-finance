import { ArrowLeftRight, CreditCard, HandCoins, ReceiptText, TrendingDown } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ActionSheet, type ActionSheetItem } from '@/components/overlays/ActionSheet'
import { todayISO } from '@/lib/dates'
import { t } from '@/lib/i18n'
import { QuickEntryContext, type QuickEntryApi } from './quick-entry-context'

const loadSheet = () => import('@/features/expenses/quick-expense/QuickExpenseSheet')
const QuickExpenseSheet = lazy(() => loadSheet().then((module) => ({ default: module.QuickExpenseSheet })))

/**
 * App-wide quick entry: the "+" menu and the Quick Expense sheet, available on
 * every screen. The sheet's code is prefetched when the browser is idle so the
 * first tap opens it instantly.
 */
export function QuickEntryProvider({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [expenseOpen, setExpenseOpen] = useState(false)
  const [expenseToday, setExpenseToday] = useState(todayISO)
  const [sheetType, setSheetType] = useState<'expense' | 'income' | 'transfer'>('expense')
  const [fromAccountId, setFromAccountId] = useState<string | undefined>(undefined)
  const [sheetMounted, setSheetMounted] = useState(false)

  useEffect(() => {
    const prefetch = () => void loadSheet()
    if ('requestIdleCallback' in window) {
      const handle = window.requestIdleCallback(prefetch, { timeout: 3000 })
      return () => window.cancelIdleCallback(handle)
    }
    const timer = setTimeout(prefetch, 1500)
    return () => clearTimeout(timer)
  }, [])

  const api = useMemo<QuickEntryApi>(
    () => ({
      openMenu: () => setMenuOpen(true),
      openExpense: () => {
        setSheetType('expense')
        setExpenseToday(todayISO())
        setSheetMounted(true)
        setExpenseOpen(true)
      },
      openTransfer: (from) => {
        setSheetType('transfer')
        setFromAccountId(from)
        setExpenseToday(todayISO())
        setSheetMounted(true)
        setExpenseOpen(true)
      },
      openIncome: () => {
        setSheetType('income')
        setExpenseToday(todayISO())
        setSheetMounted(true)
        setExpenseOpen(true)
      },
    }),
    [],
  )

  const items: ActionSheetItem[] = [
    { id: 'expense', label: t('quickAdd.expense'), description: t('quickAdd.expenseHint'), icon: TrendingDown, tone: 'expense', onSelect: api.openExpense },
    { id: 'income', label: t('quickAdd.income'), description: t('quickAdd.incomeHint'), icon: HandCoins, tone: 'income', onSelect: api.openIncome },
    {
      id: 'transfer',
      label: t('quickAdd.transfer'),
      description: t('quickAdd.transferHint'),
      icon: ArrowLeftRight,
      tone: 'neutral',
      onSelect: () => api.openTransfer(),
    },
    { id: 'bill', label: t('quickAdd.bill'), icon: ReceiptText, tone: 'info', disabled: true },
    {
      id: 'debt',
      label: t('quickAdd.debt'),
      description: t('quickAdd.debtHint'),
      icon: CreditCard,
      tone: 'debt',
      onSelect: () => {
        setMenuOpen(false)
        window.location.hash = '#/debts'
      },
    },
  ]

  return (
    <QuickEntryContext value={api}>
      {children}
      <ActionSheet open={menuOpen} onOpenChange={setMenuOpen} title={t('quickAdd.title')} items={items} />
      {sheetMounted && (
        <Suspense fallback={null}>
          <QuickExpenseSheet
            open={expenseOpen}
            onOpenChange={setExpenseOpen}
            today={expenseToday}
            type={sheetType}
            defaultAccountId={sheetType === 'transfer' ? fromAccountId : undefined}
          />
        </Suspense>
      )}
    </QuickEntryContext>
  )
}
