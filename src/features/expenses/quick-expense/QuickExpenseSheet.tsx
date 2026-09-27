import { useLiveQuery } from 'dexie-react-hooks'
import { useId, useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import { PrimaryButton, SecondaryButton } from '@/components/actions/buttons'
import { EmptyState } from '@/components/feedback/EmptyState'
import { accountClassOf } from '@/domain/transactions'
import { ErrorState } from '@/components/feedback/ErrorState'
import { LoadingState } from '@/components/feedback/LoadingState'
import { useToast } from '@/components/feedback/toast-context'
import { Drawer } from '@/components/overlays/Drawer'
import type { ISODate } from '@/domain/entities'
import { formatTHB } from '@/lib/formatting'
import { t } from '@/lib/i18n'
import { newId } from '@/lib/ids'
import { ExpenseSetup } from './ExpenseSetup'
import { loadQuickExpenseData, type QuickExpenseData } from './quick-expense-data'
import { AMOUNT_INPUT_ID, TransactionForm } from '@/features/transaction-form'
import { saveExpense, saveIncome, saveTransfer, type SaveExpense, type SaveIncome } from './save-expense'

export interface QuickExpenseSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  today: ISODate
  /** One sheet and shared form: expense, income (into an account) or transfer (between two accounts). */
  type?: 'expense' | 'income' | 'transfer'
  /** Preselected source account (e.g. "โอนจากบัญชีนี้"). */
  defaultAccountId?: string
  /** Injected in tests. */
  load?: (today: ISODate, type: 'expense' | 'income' | 'transfer') => Promise<QuickExpenseData>
  save?: SaveExpense
  saveIncomeTx?: SaveIncome
  saveTransferTx?: SaveIncome
}

type LoadResult = { ok: true; data: QuickExpenseData } | { ok: false } | null

/**
 * The Quick Expense flow: full-screen on phones (the sheet follows the visible
 * viewport, so the Save footer stays above the keyboard), right-side panel on
 * larger screens. Categories, accounts and suggestions load live from IndexedDB.
 */
export function QuickExpenseSheet({
  open,
  onOpenChange,
  today,
  type = 'expense',
  load = loadQuickExpenseData,
  save = saveExpense,
  saveIncomeTx = saveIncome,
  saveTransferTx = saveTransfer,
  defaultAccountId,
}: QuickExpenseSheetProps) {
  const income = type === 'income'
  const transfer = type === 'transfer'
  const formId = useId()
  const toast = useToast()
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  // One transaction id per opening: a retry after a failure reuses it, so a record is never created twice.
  const [transactionId, setTransactionId] = useState(newId)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setTransactionId(newId())
      setSaving(false)
    }
  }

  const result = useLiveQuery<LoadResult>(
    () => (open ? load(today, type).then((data) => ({ ok: true as const, data }), () => ({ ok: false as const })) : null),
    [open, today, type, load, attempt],
  )

  const ready = result?.ok ? result.data : null
  const transferAccounts = ready ? ready.accounts.filter((a) => accountClassOf(a.kind) === 'asset') : []
  const showForm = ready !== null && (transfer ? transferAccounts.length >= 2 : ready.categories.length > 0 && ready.accounts.length > 0)

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!saving) onOpenChange(next)
      }}
      title={t(transfer ? 'transfer.title' : income ? 'income.sheetTitle' : 'expense.title')}
      description={transfer ? t('transfer.hint') : undefined}
      size="full"
      onOpenAutoFocus={(event) => {
        // Straight to the amount (opens the numeric keypad on phones) when the form is ready.
        const amount = document.getElementById(AMOUNT_INPUT_ID)
        if (amount) {
          event.preventDefault()
          amount.focus()
        }
      }}
      footer={
        showForm ? (
          <PrimaryButton type="submit" form={formId} size="lg" loading={saving}>
            {t(transfer ? 'transfer.save' : income ? 'income.save' : 'expense.save')}
          </PrimaryButton>
        ) : undefined
      }
    >
      {open && result === undefined && <LoadingState />}
      {result && !result.ok && <ErrorState onRetry={() => setAttempt((n) => n + 1)} />}
      {ready && !showForm && transfer && (
        <EmptyState
          icon={ArrowLeftRight}
          title={t('transfer.needAccounts')}
          className="border-none"
          action={
            <SecondaryButton
              onClick={() => {
                onOpenChange(false)
                window.location.hash = '#/accounts'
              }}
            >
              {t('transfer.goAccounts')}
            </SecondaryButton>
          }
        />
      )}
      {ready && !showForm && !transfer && (
        <ExpenseSetup hasCategories={ready.categories.length > 0} hasAccounts={ready.accounts.length > 0} today={today} kind={type} />
      )}
      {ready && showForm && (
        <TransactionForm
          key={transactionId}
          formId={formId}
          type={type}
          data={transfer && defaultAccountId && ready.accounts.some((a) => a.id === defaultAccountId) ? { ...ready, defaultAccountId } : ready}
          // The accounts are the point of a transfer: show them straight away.
          detailsInitiallyOpen={transfer}
          today={today}
          onSavingChange={setSaving}
          onSubmit={async (draft, attachments) => {
            if (transfer) await saveTransferTx(draft, attachments.add, transactionId)
            else if (income) await saveIncomeTx(draft, attachments.add, transactionId)
            else await save({ ...draft, categoryId: draft.categoryId }, attachments.add, transactionId)
            toast.show({ message: t(transfer ? 'transfer.saved' : income ? 'income.saved' : 'expense.saved', { amount: formatTHB(draft.amountSatang!, { trimZeroFraction: true }) }) })
            setSaving(false)
            onOpenChange(false)
          }}
        />
      )}
    </Drawer>
  )
}
