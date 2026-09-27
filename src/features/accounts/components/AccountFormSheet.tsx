import { useId, useRef, useState, type FormEvent } from 'react'
import { PrimaryButton } from '@/components/actions/buttons'
import { useToast } from '@/components/feedback/toast-context'
import { ACCOUNT_KIND_VISUALS } from '@/components/finance/account-visuals'
import { AmountInput } from '@/components/forms/AmountInput'
import { DateInput } from '@/components/forms/DateInput'
import { SelectField } from '@/components/forms/SelectField'
import { Drawer } from '@/components/overlays/Drawer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CREATABLE_ACCOUNT_KINDS, openingAmountOf } from '@/domain/accounts'
import type { Account, AccountKind, ISODate } from '@/domain/entities'
import { formatMoney, tryParseBaht } from '@/domain/money'
import { accountClassOf } from '@/domain/transactions'
import { APP_LOCALE, t } from '@/lib/i18n'
import { newId } from '@/lib/ids'
import { accountFailureToErrors, type AccountErrors, type AccountsOps } from '../accounts-ops'

export const ACCOUNT_NAME_ID = 'account-form-name'

function FieldError({ message }: { message?: string }) {
  return message ? (
    <p role="alert" className="text-xs text-destructive">
      {message}
    </p>
  ) : null
}

function AccountForm({
  formId,
  existing,
  historyCount,
  today,
  onSubmit,
  onSavingChange,
}: {
  formId: string
  existing?: Account
  historyCount: number
  today: ISODate
  onSubmit: (draft: Parameters<AccountsOps['create']>[0]) => Promise<void>
  onSavingChange: (saving: boolean) => void
}) {
  const [name, setName] = useState(existing?.name ?? '')
  const [kind, setKind] = useState<AccountKind>(existing?.kind ?? 'bank')
  const [openingText, setOpeningText] = useState(existing ? formatMoney(openingAmountOf(existing), { locale: APP_LOCALE, symbol: false, trimZeroFraction: true }) : '')
  const [openingDate, setOpeningDate] = useState<ISODate>(existing?.openingDate ?? today)
  const [note, setNote] = useState(existing?.note ?? '')
  const [errors, setErrors] = useState<AccountErrors>({ fields: {} })
  const [saving, setSaving] = useState(false)
  const submitting = useRef(false)
  const noteId = useId()

  const liability = accountClassOf(kind) === 'liability'
  // An edit may change the kind only within its class (the balance sign would flip otherwise).
  const kinds = existing ? [...new Set([existing.kind, ...CREATABLE_ACCOUNT_KINDS])].filter((k) => accountClassOf(k) === accountClassOf(existing.kind)) : CREATABLE_ACCOUNT_KINDS

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (submitting.current) return
    const trimmed = openingText.trim()
    const opening = trimmed === '' ? null : tryParseBaht(trimmed)
    if (trimmed !== '' && opening === null) {
      setErrors({ fields: { opening: t('expense.error.amount_invalid') } })
      return
    }
    submitting.current = true
    setSaving(true)
    onSavingChange(true)
    setErrors({ fields: {} })
    try {
      await onSubmit({ name, kind, openingAmountSatang: opening, openingDate, note })
    } catch (error) {
      setErrors(accountFailureToErrors(error))
      submitting.current = false
      setSaving(false)
      onSavingChange(false)
    }
  }

  return (
    <form id={formId} onSubmit={handleSubmit} noValidate aria-busy={saving || undefined} className="flex flex-col gap-section">
      {errors.form && (
        <p role="alert" className="rounded-md border border-expense/30 bg-expense-muted px-3 py-2 text-sm">
          {errors.form}
        </p>
      )}
      {existing && historyCount > 0 && <p className="rounded-md bg-info-muted px-3 py-2 text-sm">{t('accounts.form.historyWarning', { count: historyCount })}</p>}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ACCOUNT_NAME_ID}>{t('accounts.form.name')}</Label>
        <Input
          id={ACCOUNT_NAME_ID}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('accounts.form.namePlaceholder')}
          maxLength={60}
          autoComplete="off"
          aria-invalid={errors.fields.name ? true : undefined}
          disabled={saving}
        />
        <FieldError message={errors.fields.name} />
      </div>

      <SelectField
        label={t('accounts.form.kind')}
        value={kind}
        onValueChange={(value) => setKind(value as AccountKind)}
        options={kinds.map((k) => ({ value: k, label: t(ACCOUNT_KIND_VISUALS[k].labelKey) }))}
        hint={existing ? t('accounts.form.kindLocked') : undefined}
        error={errors.fields.kind}
        disabled={saving}
      />

      <div className="flex flex-col gap-1.5">
        <AmountInput
          size="md"
          label={liability ? t('accounts.form.openingOwed') : t('accounts.form.opening')}
          value={openingText}
          onValueChange={(text) => setOpeningText(text)}
          error={errors.fields.opening}
          tone={liability ? 'debt' : 'neutral'}
          disabled={saving}
        />
        <p className="text-xs text-muted-foreground">{liability ? t('accounts.form.openingOwedHint') : t('accounts.form.openingHint')}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <DateInput label={t('accounts.form.openingDate')} shortcuts={false} today={today} value={openingDate} onValueChange={setOpeningDate} />
        <p className="text-xs text-muted-foreground">{t('accounts.form.openingDateHint')}</p>
        <FieldError message={errors.fields.openingDate} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={noteId}>
          {t('accounts.form.note')} <span className="font-normal text-muted-foreground">({t('common.optional')})</span>
        </Label>
        <textarea
          id={noteId}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={500}
          disabled={saving}
          className="min-h-touch w-full rounded-md border border-input bg-transparent px-2.5 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
        />
      </div>
    </form>
  )
}

export interface AccountFormSheetProps {
  /** null = closed; 'create' = new; otherwise the account being edited. */
  target: null | 'create' | Account
  /** Transactions already using the edited account (for the history warning). */
  historyCount?: number
  onClose: () => void
  today: ISODate
  ops: Pick<AccountsOps, 'create' | 'update'>
  onCreated?: (id: string) => void
}

/** Create / edit an account: full-screen on phones, right panel on larger screens. */
export function AccountFormSheet({ target, historyCount = 0, onClose, today, ops, onCreated }: AccountFormSheetProps) {
  const formId = useId()
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  // One id per opening: a double tap creates one account.
  const [createId, setCreateId] = useState(newId)
  const [shown, setShown] = useState(target)
  if (shown !== target) {
    setShown(target)
    setSaving(false)
    if (target === 'create') setCreateId(newId())
  }
  const existing = target && target !== 'create' ? target : undefined

  return (
    <Drawer
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
      title={existing ? t('accounts.form.editTitle') : t('accounts.form.createTitle')}
      size="full"
      onOpenAutoFocus={(event) => {
        event.preventDefault()
        document.getElementById(ACCOUNT_NAME_ID)?.focus()
      }}
      footer={
        target !== null ? (
          <PrimaryButton type="submit" form={formId} size="lg" loading={saving}>
            {t('accounts.form.save')}
          </PrimaryButton>
        ) : undefined
      }
    >
      {target !== null && (
        <AccountForm
          key={existing?.id ?? createId}
          formId={formId}
          existing={existing}
          historyCount={historyCount}
          today={today}
          onSavingChange={setSaving}
          onSubmit={async (draft) => {
            if (existing) {
              await ops.update(existing.id, draft)
              toast.show({ message: t('accounts.toast.updated') })
            } else {
              await ops.create(draft, createId)
              toast.show({ message: t('accounts.toast.created', { name: draft.name.trim() }) })
              onCreated?.(createId)
            }
            setSaving(false)
            onClose()
          }}
        />
      )}
    </Drawer>
  )
}
