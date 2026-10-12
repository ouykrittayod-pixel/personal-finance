import { useId, useRef, useState, type FormEvent } from 'react'
import { PrimaryButton, SecondaryButton } from '@/components/actions/buttons'
import { useToast } from '@/components/feedback/toast-context'
import { AmountInput } from '@/components/forms/AmountInput'
import { ChoiceGroup } from '@/components/forms/ChoiceGroup'
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
  /** Investment: the "balance" is the portfolio's market value; the adjustment is a gain or loss. */
  investment?: boolean
  onClose: () => void
  reconcile: AccountsOps['reconcile']
}

const money = (amount: Satang) => formatTHB(amount, { trimZeroFraction: true })

/**
 * "ปรับยอดให้ตรง": type the balance the bank (or card) really shows; the
 * difference is recorded as one adjustment today — never an expense or income.
 * For a card or loan the user types what is owed.
 *
 * Credit cards / credit lines ("อัปเดตตามแอปเจ้าหนี้"): type what is owed, or
 * the remaining limit the lender's app shows (owed = limit − remaining). When
 * the lender shows more owed, the difference is its interest / fees: recorded
 * as one expense (ดอกเบี้ย/ค่าธรรมเนียม) unless the user unticks it.
 */
export function ReconcileDialog({ account, balance, liability, investment = false, onClose, reconcile }: ReconcileDialogProps) {
  const formId = useId()
  const toast = useToast()
  const [text, setText] = useState('')
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const busy = useRef(false)
  const card = account?.kind === 'credit_card'
  const limit = card ? account?.creditLimitSatang : undefined
  const [mode, setMode] = useState<'remaining' | 'owed'>('owed')
  const [charges, setCharges] = useState(true)
  const chargesId = useId()
  const [shown, setShown] = useState<string | null>(null)
  if (shown !== (account?.id ?? null)) {
    setShown(account?.id ?? null)
    setText('')
    setError(undefined)
    setSaving(false)
    setMode(account?.kind === 'credit_card' && account.creditLimitSatang ? 'remaining' : 'owed')
    setCharges(true)
  }

  const typed = text.trim() === '' ? null : tryParseBaht(text)
  const byRemaining = mode === 'remaining' && limit !== undefined
  const remainingTooHigh = limit !== undefined && byRemaining && typed !== null && typed > limit
  // What is owed according to the lender (positive), when typed as the remaining limit.
  const owedFromRemaining = limit !== undefined && byRemaining && typed !== null && typed <= limit ? ((limit - typed) as Satang) : null
  const actual = typed === null || remainingTooHigh ? null : owedFromRemaining !== null ? negate(owedFromRemaining) : liability ? negate(typed) : typed
  const difference = actual === null ? null : ((actual - balance) as Satang)
  const asCharges = card && charges && difference !== null && difference < 0

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!account || busy.current) return
    if (remainingTooHigh) {
      setError(t('accounts.reconcile.remainingTooHigh', { limit: money(limit!) }))
      return
    }
    if (actual === null || (typed !== null && typed < 0)) {
      setError(t(text.trim() === '' ? 'expense.error.amount_required' : 'expense.error.amount_invalid'))
      return
    }
    busy.current = true
    setSaving(true)
    try {
      await (card ? reconcile(account.id, actual, { chargesAsExpense: charges }) : reconcile(account.id, actual))
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
      title={t(card ? 'accounts.reconcile.titleCard' : investment ? 'accounts.reconcile.titleValue' : 'accounts.reconcile.title')}
      description={t(card ? 'accounts.reconcile.hintCard' : liability ? 'accounts.reconcile.hintOwed' : investment ? 'accounts.reconcile.hintValue' : 'accounts.reconcile.hint', {
        current: money(liability ? negate(balance) : balance),
      })}
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
        {limit !== undefined && (
          <ChoiceGroup
            legend={t('accounts.reconcile.enterAs')}
            layout="scroll"
            name={`${formId}-mode`}
            options={[
              { value: 'remaining', label: t('accounts.reconcile.byRemaining') },
              { value: 'owed', label: t('accounts.reconcile.byOwed') },
            ]}
            value={mode}
            onValueChange={(value) => {
              setMode(value as 'remaining' | 'owed')
              setError(undefined)
            }}
          />
        )}
        <AmountInput
          size="md"
          label={t(byRemaining ? 'accounts.reconcile.actualRemaining' : liability ? 'accounts.reconcile.actualOwed' : investment ? 'accounts.reconcile.actualValue' : 'accounts.reconcile.actual')}
          value={text}
          onValueChange={(next) => {
            setText(next)
            setError(undefined)
          }}
          error={error}
          disabled={saving}
          autoFocus
        />
        {owedFromRemaining !== null && (
          <p className="text-sm tabular-nums" aria-live="polite">
            {t('accounts.reconcile.owedFromRemaining', { limit: money(limit!), remaining: money(typed!), owed: money(owedFromRemaining) })}
          </p>
        )}
        {difference !== null && difference !== 0 && (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {asCharges
              ? t('accounts.reconcile.diffCharges', { amount: money(negate(difference)) })
              : t(difference > 0 ? 'accounts.reconcile.diffUp' : 'accounts.reconcile.diffDown', { amount: money((difference > 0 ? difference : negate(difference)) as Satang) })}
          </p>
        )}
        {card && (
          <label htmlFor={chargesId} className="flex min-h-touch items-start gap-3 text-sm md:min-h-10">
            <input
              id={chargesId}
              type="checkbox"
              checked={charges}
              disabled={saving}
              onChange={(event) => setCharges(event.target.checked)}
              className="mt-0.5 size-5 accent-primary"
            />
            <span>{t('accounts.reconcile.chargesOption')}</span>
          </label>
        )}
        <p className="text-xs text-muted-foreground">{t(card ? 'accounts.reconcile.noteCard' : investment ? 'accounts.reconcile.noteValue' : 'accounts.reconcile.note')}</p>
      </form>
    </Dialog>
  )
}
