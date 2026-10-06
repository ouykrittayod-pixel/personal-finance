import { useId, useRef, useState, type FormEvent } from 'react'
import { PrimaryButton, SecondaryButton } from '@/components/actions/buttons'
import { useToast } from '@/components/feedback/toast-context'
import { AmountInput } from '@/components/forms/AmountInput'
import { ChoiceGroup } from '@/components/forms/ChoiceGroup'
import { DateInput } from '@/components/forms/DateInput'
import { Dialog } from '@/components/overlays/Dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Debt, ISODate } from '@/domain/entities'
import { negate, tryParseBaht, type Satang } from '@/domain/money'
import { addDays } from '@/domain/recurrence'
import { t } from '@/lib/i18n'
import { newId } from '@/lib/ids'
import type { DebtsOps } from '../debts-ops'
import { debtFailureToErrors, type DebtErrors } from '../errors'

function FieldError({ message }: { message?: string }) {
  return message ? (
    <p role="alert" className="text-xs text-destructive">
      {message}
    </p>
  ) : null
}

/** Shared submit plumbing: one save at a time, Thai errors, fixed id per opening. */
function useRecordForm(onDone: () => void) {
  const [errors, setErrors] = useState<DebtErrors>({ fields: {} })
  const [saving, setSaving] = useState(false)
  const submitting = useRef(false)
  const [recordId, setRecordId] = useState(newId)
  async function save(work: (id: string) => Promise<unknown>, success: string, toast: ReturnType<typeof useToast>) {
    if (submitting.current) return
    submitting.current = true
    setSaving(true)
    setErrors({ fields: {} })
    try {
      await work(recordId)
      toast.show({ message: success })
      setRecordId(newId())
      onDone()
    } catch (error) {
      setErrors(debtFailureToErrors(error))
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }
  return { errors, setErrors, saving, save }
}

const parseRequired = (text: string): Satang | null => (text.trim() === '' ? null : tryParseBaht(text.trim()))

/** Loans: record a principal increase (top-up) or correction — not a payment. */
export function AdjustmentDialog({ debt, open, onClose, today, ops }: { debt: Debt; open: boolean; onClose: () => void; today: ISODate; ops: Pick<DebtsOps, 'addAdjustment'> }) {
  const toast = useToast()
  const formId = useId()
  const noteId = useId()
  const [direction, setDirection] = useState<'increase' | 'decrease'>('increase')
  const [amountText, setAmountText] = useState('')
  const [date, setDate] = useState<ISODate>(today)
  const [note, setNote] = useState('')
  const [noInterest, setNoInterest] = useState(false)
  const noInterestId = useId()
  const { errors, setErrors, saving, save } = useRecordForm(() => {
    setAmountText('')
    setNote('')
    setNoInterest(false)
    onClose()
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    const amount = parseRequired(amountText)
    if (amount === null || amount <= 0) {
      setErrors({ fields: { amount: t('debts.error.adjustment_invalid') } })
      return
    }
    void save((id) => ops.addAdjustment(
          debt.id,
          { date, amountSatang: direction === 'increase' ? amount : negate(amount), note, ...(direction === 'increase' && noInterest ? { interestBearing: false } : {}) },
          id,
        ), t('debts.toast.adjusted'), toast)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onClose()
      }}
      title={t('debts.adjust.title')}
      description={t('debts.adjust.hint')}
      footer={
        <>
          <SecondaryButton onClick={onClose} disabled={saving}>
            {t('detail.cancel')}
          </SecondaryButton>
          <PrimaryButton type="submit" form={formId} loading={saving}>
            {t('debts.form.save')}
          </PrimaryButton>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-stack">
        {errors.form && (
          <p role="alert" className="text-sm text-destructive">
            {errors.form}
          </p>
        )}
        <ChoiceGroup
          legend={t('debts.adjust.direction')}
          layout="scroll"
          name={`${formId}-direction`}
          options={[
            { value: 'increase', label: t('debts.adjust.increase') },
            { value: 'decrease', label: t('debts.adjust.decrease') },
          ]}
          value={direction}
          onValueChange={(value) => setDirection(value as 'increase' | 'decrease')}
        />
        <AmountInput size="md" label={t('form.amount')} value={amountText} onValueChange={(value) => setAmountText(value)} error={errors.fields.amount} tone="debt" disabled={saving} />
        <div className="flex flex-col gap-1.5">
          <DateInput label={t('debts.adjust.date')} today={today} max={today} value={date} onValueChange={setDate} />
          <FieldError message={errors.fields.date ?? errors.fields.opening} />
        </div>
        {direction === 'increase' && (
          <label htmlFor={noInterestId} className="flex min-h-touch items-start gap-3 text-sm md:min-h-10">
            <input
              id={noInterestId}
              type="checkbox"
              checked={noInterest}
              disabled={saving}
              onChange={(event) => setNoInterest(event.target.checked)}
              className="mt-0.5 size-5 accent-primary"
            />
            <span className="flex flex-col">
              {t('debts.adjust.noInterest')}
              <span className="text-xs text-muted-foreground">{t('debts.adjust.noInterestHint')}</span>
            </span>
          </label>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={noteId}>{t('debts.adjust.note')}</Label>
          <Input id={noteId} value={note} onChange={(event) => setNote(event.target.value)} maxLength={120} autoComplete="off" disabled={saving} />
        </div>
      </form>
    </Dialog>
  )
}

/** Cards: store a statement as printed and schedule its due payment. */
export function StatementDialog({ debt, open, onClose, today, ops }: { debt: Debt; open: boolean; onClose: () => void; today: ISODate; ops: Pick<DebtsOps, 'addStatement'> }) {
  const toast = useToast()
  const formId = useId()
  const [statementDate, setStatementDate] = useState<ISODate>(today)
  const [dueDate, setDueDate] = useState<ISODate>(addDays(today, 15))
  const [balanceText, setBalanceText] = useState('')
  const [minimumText, setMinimumText] = useState('')
  const { errors, setErrors, saving, save } = useRecordForm(() => {
    setBalanceText('')
    setMinimumText('')
    onClose()
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    const balance = parseRequired(balanceText)
    const minimum = minimumText.trim() === '' ? undefined : tryParseBaht(minimumText.trim())
    if (balance === null || minimum === null) {
      setErrors({ fields: { ...(balance === null ? { balance: t('debts.error.balance_invalid') } : {}), ...(minimum === null ? { minimum: t('debts.error.minimum_invalid') } : {}) } })
      return
    }
    void save((id) => ops.addStatement(debt.id, { statementDate, dueDate, balanceSatang: balance, minimumDueSatang: minimum }, id), t('debts.toast.statement'), toast)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onClose()
      }}
      title={t('debts.statement.title')}
      description={t('debts.statement.hint')}
      footer={
        <>
          <SecondaryButton onClick={onClose} disabled={saving}>
            {t('detail.cancel')}
          </SecondaryButton>
          <PrimaryButton type="submit" form={formId} loading={saving}>
            {t('debts.form.save')}
          </PrimaryButton>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-stack">
        {errors.form && (
          <p role="alert" className="text-sm text-destructive">
            {errors.form}
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <DateInput label={t('debts.statement.statementDate')} shortcuts={false} today={today} max={today} value={statementDate} onValueChange={setStatementDate} />
          <FieldError message={errors.fields.statementDate} />
        </div>
        <AmountInput size="md" label={t('debts.statement.balance')} value={balanceText} onValueChange={(value) => setBalanceText(value)} error={errors.fields.balance} tone="debt" disabled={saving} />
        <AmountInput size="md" label={t('debts.statement.minimum')} value={minimumText} onValueChange={(value) => setMinimumText(value)} error={errors.fields.minimum} disabled={saving} />
        <div className="flex flex-col gap-1.5">
          <DateInput label={t('debts.statement.dueDate')} shortcuts={false} today={today} value={dueDate} onValueChange={setDueDate} />
          <FieldError message={errors.fields.dueDate} />
        </div>
      </form>
    </Dialog>
  )
}
