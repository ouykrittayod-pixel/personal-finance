import { useId, useRef, useState, type FormEvent } from 'react'
import { PrimaryButton, SecondaryButton } from '@/components/actions/buttons'
import { useToast } from '@/components/feedback/toast-context'
import { AmountInput } from '@/components/forms/AmountInput'
import { Dialog } from '@/components/overlays/Dialog'
import type { ISODate } from '@/domain/entities'
import { formatMoney, tryParseBaht, type Satang } from '@/domain/money'
import { formatYearMonth } from '@/lib/dates'
import { formatTHB } from '@/lib/formatting'
import { APP_LOCALE, t } from '@/lib/i18n'
import { actionFailureMessage } from '../errors'

export interface EditAmountTarget {
  name: string
  dueDate: ISODate
  amountSatang: Satang
  income?: boolean
}

export interface EditAmountDialogProps {
  target: EditAmountTarget | null
  onClose: () => void
  /** Store the new planned amount for this one month. */
  onSave: (amountSatang: Satang) => Promise<unknown>
}

/**
 * "แก้ยอดเดือนนี้": the planned amount of ONE month (the bill arrived, or the
 * sheet says next month's card payment is 2,500). The rule's usual amount and
 * the other months stay as they are.
 */
export function EditAmountDialog({ target, onClose, onSave }: EditAmountDialogProps) {
  const formId = useId()
  const toast = useToast()
  const [text, setText] = useState('')
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const busy = useRef(false)
  // Reset when a different month opens (compared by value: callers may build the target inline).
  const targetKey = target ? `${target.name}|${target.dueDate}|${target.amountSatang}` : null
  const [shown, setShown] = useState<string | null>(null)
  if (shown !== targetKey) {
    setShown(targetKey)
    setText(target ? formatMoney(target.amountSatang, { locale: APP_LOCALE, symbol: false, trimZeroFraction: true }) : '')
    setError(undefined)
    setSaving(false)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!target || busy.current) return
    const amount = text.trim() === '' ? null : tryParseBaht(text)
    if (amount === null || amount <= 0) {
      setError(t(text.trim() === '' ? 'expense.error.amount_required' : 'expense.error.amount_must_be_positive'))
      return
    }
    busy.current = true
    setSaving(true)
    try {
      await onSave(amount)
      toast.show({ message: t('plan.toast.amountSet', { name: target.name, amount: formatTHB(amount, { trimZeroFraction: true }) }) })
      onClose()
    } catch (failure) {
      setError(actionFailureMessage(failure))
    } finally {
      busy.current = false
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
      title={target ? t('plan.editAmount.title', { name: target.name }) : ''}
      description={target ? t('plan.editAmount.hint', { month: formatYearMonth(target.dueDate.slice(0, 7)) }) : undefined}
      footer={
        <>
          <SecondaryButton onClick={onClose} disabled={saving}>
            {t('detail.cancel')}
          </SecondaryButton>
          <PrimaryButton type="submit" form={formId} loading={saving}>
            {t('plan.editAmount.save')}
          </PrimaryButton>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate>
        <AmountInput
          size="md"
          value={text}
          onValueChange={(next) => {
            setText(next)
            setError(undefined)
          }}
          error={error}
          disabled={saving}
          tone={target?.income ? 'income' : 'neutral'}
          autoFocus
        />
      </form>
    </Dialog>
  )
}
