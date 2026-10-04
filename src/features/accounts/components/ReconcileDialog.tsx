import { useId, useRef, useState, type FormEvent } from 'react'
import { PrimaryButton, SecondaryButton } from '@/components/actions/buttons'
import { useToast } from '@/components/feedback/toast-context'
import { AmountInput } from '@/components/forms/AmountInput'
import { Dialog } from '@/components/overlays/Dialog'
import type { Account } from '@/domain/entities'
import { negate, tryParseBaht, type Satang } from '@/domain/money'
import { formatTHB } from '@/lib/formatting'
import { t } from '@/lib/i18n'
import { accountActionFailureMessage, type AccountsOps } from '../accounts-ops'

export interface ReconcileDialogProps {
  account: Account | null
  /** The balance the app has now (liabilities negative). */
  balance: Satang
  liability: boolean
  onClose: () => void
  reconcile: AccountsOps['reconcile']
}

const money = (amount: Satang) => formatTHB(amount, { trimZeroFraction: true })

/**
 * "ปรับยอดให้ตรง": type the balance the bank (or card) really shows; the
 * difference is recorded as one adjustment today — never an expense or income.
 * For a card or loan the user types what is owed.
 */
export function ReconcileDialog({ account, balance, liability, onClose, reconcile }: ReconcileDialogProps) {
  const formId = useId()
  const toast = useToast()
  const [text, setText] = useState('')
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const busy = useRef(false)
  const [shown, setShown] = useState<string | null>(null)
  if (shown !== (account?.id ?? null)) {
    setShown(account?.id ?? null)
    setText('')
    setError(undefined)
    setSaving(false)
  }

  const typed = text.trim() === '' ? null : tryParseBaht(text)
  const actual = typed === null ? null : liability ? negate(typed) : typed
  const difference = actual === null ? null : ((actual - balance) as Satang)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!account || busy.current) return
    if (actual === null || (typed !== null && typed < 0)) {
      setError(t(text.trim() === '' ? 'expense.error.amount_required' : 'expense.error.amount_invalid'))
      return
    }
    busy.current = true
    setSaving(true)
    try {
      await reconcile(account.id, actual)
      toast.show({ message: difference === 0 ? t('accounts.reconcile.alreadyMatches') : t('accounts.reconcile.done', { name: account.name, amount: money(liability ? negate(actual) : actual) }) })
      onClose()
    } catch (failure) {
      setError(accountActionFailureMessage(failure))
    } finally {
      busy.current = false
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={account !== null}
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
      title={t('accounts.reconcile.title')}
      description={t(liability ? 'accounts.reconcile.hintOwed' : 'accounts.reconcile.hint', { current: money(liability ? negate(balance) : balance) })}
      footer={
        <>
          <SecondaryButton onClick={onClose} disabled={saving}>
            {t('detail.cancel')}
          </SecondaryButton>
          <PrimaryButton type="submit" form={formId} loading={saving}>
            {t('accounts.reconcile.save')}
          </PrimaryButton>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-stack">
        <AmountInput
          size="md"
          label={t(liability ? 'accounts.reconcile.actualOwed' : 'accounts.reconcile.actual')}
          value={text}
          onValueChange={(next) => {
            setText(next)
            setError(undefined)
          }}
          error={error}
          disabled={saving}
          autoFocus
        />
        {difference !== null && difference !== 0 && (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {t(difference > 0 ? 'accounts.reconcile.diffUp' : 'accounts.reconcile.diffDown', { amount: money((difference > 0 ? difference : negate(difference)) as Satang) })}
          </p>
        )}
        <p className="text-xs text-muted-foreground">{t('accounts.reconcile.note')}</p>
      </form>
    </Dialog>
  )
}
