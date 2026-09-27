import { createElement, useId, useRef, useState, type FormEvent } from 'react'
import * as z from 'zod/mini'
import { PrimaryButton } from '@/components/actions/buttons'
import { useToast } from '@/components/feedback/toast-context'
import { ACCOUNT_KIND_VISUALS } from '@/components/finance/account-visuals'
import { AccountSelector } from '@/components/forms/AccountSelector'
import { AmountInput } from '@/components/forms/AmountInput'
import { ChoiceGroup } from '@/components/forms/ChoiceGroup'
import { DateInput } from '@/components/forms/DateInput'
import { SelectField } from '@/components/forms/SelectField'
import { Drawer } from '@/components/overlays/Drawer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { NewCardAccount } from '@/db/repositories'
import { formatBpsAsPercent, isRevolving, parsePercentToBps, type DebtDraft } from '@/domain/debts'
import type { Account, Debt, DebtKind, ID, ISODate, InterestMethod } from '@/domain/entities'
import { formatMoney, tryParseBaht, type Satang } from '@/domain/money'
import { APP_LOCALE, t, type MessageKey } from '@/lib/i18n'
import { newId } from '@/lib/ids'
import type { DebtsOps } from '../debts-ops'
import { debtFailureToErrors, type DebtErrors, type DebtField } from '../errors'

export const DEBT_NAME_ID = 'debt-form-name'

const KINDS: readonly DebtKind[] = ['mortgage', 'car_loan', 'personal_loan', 'installment', 'credit_card', 'student_loan', 'informal', 'other']
const METHODS: readonly InterestMethod[] = ['reducing_balance', 'flat', 'none', 'unknown']
const grouped = (amount: Satang | undefined) => (amount === undefined ? '' : formatMoney(amount, { locale: APP_LOCALE, symbol: false, trimZeroFraction: true }))
const toMoney = (text: string): Satang | null | undefined => (text.trim() === '' ? undefined : tryParseBaht(text.trim()))

/** Shape of the typed text (Zod); business rules stay in the domain (buildDebt). */
const moneyText = (key: MessageKey) => z.string().check(z.refine((text) => text.trim() === '' || tryParseBaht(text.trim()) !== null, { message: key }))
const FORM_TEXT = z.object({
  principal: moneyText('debts.error.principal_invalid'),
  opening: moneyText('debts.error.opening_invalid'),
  installment: moneyText('debts.error.installment_invalid'),
  cardOwed: moneyText('expense.error.amount_invalid'),
  rate: z.string().check(z.refine((text) => text.trim() === '' || parsePercentToBps(text) !== null, { message: 'debts.error.rate_invalid' })),
})
const TEXT_FIELD: Record<keyof z.infer<typeof FORM_TEXT>, DebtField> = { principal: 'principal', opening: 'opening', installment: 'installment', cardOwed: 'cardAccount', rate: 'rate' }

function FieldError({ message }: { message?: string }) {
  return message ? (
    <p role="alert" className="text-xs text-destructive">
      {message}
    </p>
  ) : null
}

function CheckRow({ checked, onChange, children, disabled }: { checked: boolean; onChange: (checked: boolean) => void; children: string; disabled?: boolean }) {
  return (
    <label className="flex min-h-touch items-center gap-3 text-sm md:min-h-9">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="focus-ring size-5 accent-(--primary)" />
      {children}
    </label>
  )
}

export interface DebtFormData {
  accounts: Account[]
  debts: Debt[]
}

function DebtForm({
  formId,
  data,
  existing,
  today,
  onSubmit,
  onSavingChange,
}: {
  formId: string
  data: DebtFormData
  existing?: Debt
  today: ISODate
  onSubmit: (draft: DebtDraft, newCard?: Omit<NewCardAccount, 'id'>) => Promise<void>
  onSavingChange: (saving: boolean) => void
}) {
  // Card accounts not already tied to another live debt (plus this debt's own).
  const usedCards = new Set(data.debts.filter((d) => d.id !== existing?.id && !d.archivedAt && d.linkedAccountId).map((d) => d.linkedAccountId))
  const cardAccounts = data.accounts.filter((a) => a.kind === 'credit_card' && !usedCards.has(a.id) && (!a.archivedAt || a.id === existing?.linkedAccountId))

  const [kind, setKind] = useState<DebtKind>(existing?.kind ?? 'mortgage')
  const [name, setName] = useState(existing?.name ?? '')
  const [lender, setLender] = useState(existing?.lender ?? '')
  const [principalText, setPrincipalText] = useState(grouped(existing?.principalSatang || undefined))
  const [openingText, setOpeningText] = useState(existing && !isRevolving(existing) ? grouped(existing.openingBalanceSatang) : '')
  const [openingDate, setOpeningDate] = useState<ISODate>(existing?.openingDate ?? today)
  const [hasStart, setHasStart] = useState(Boolean(existing?.startDate))
  const [startDate, setStartDate] = useState<ISODate>(existing?.startDate ?? openingDate)
  const [hasMaturity, setHasMaturity] = useState(Boolean(existing?.maturityDate))
  const [maturityDate, setMaturityDate] = useState<ISODate>(existing?.maturityDate ?? today)
  const [rateText, setRateText] = useState(existing?.annualInterestRateBps !== undefined ? formatBpsAsPercent(existing.annualInterestRateBps) : '')
  const [method, setMethod] = useState<InterestMethod>(existing?.interestMethod ?? 'reducing_balance')
  const [installmentText, setInstallmentText] = useState(grouped(existing?.installmentSatang))
  const [dueDay, setDueDay] = useState(existing?.dueDay ? String(existing.dueDay) : '')
  const [scheduleEnabled, setScheduleEnabled] = useState(existing ? Boolean(existing.scheduleEnabled) : true)
  const [status, setStatus] = useState<Debt['status']>(existing?.status ?? 'active')
  const [cardMode, setCardMode] = useState<'existing' | 'new'>(existing || cardAccounts.length > 0 ? 'existing' : 'new')
  const [linkedAccountId, setLinkedAccountId] = useState<ID | undefined>(existing?.linkedAccountId ?? cardAccounts[0]?.id)
  const [cardName, setCardName] = useState('')
  const [cardOwedText, setCardOwedText] = useState('')
  const [note, setNote] = useState(existing?.note ?? '')
  const [errors, setErrors] = useState<DebtErrors>({ fields: {} })
  const [saving, setSaving] = useState(false)
  const submitting = useRef(false)
  const lenderId = useId()
  const rateId = useId()
  const noteId = useId()
  const cardNameId = useId()

  const card = kind === 'credit_card'
  // A debt's type (loan vs card) decides its balance model, so it cannot switch after creation.
  const kindOptions = existing ? KINDS.filter((k) => isRevolving({ kind: k }) === isRevolving(existing)) : KINDS

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (submitting.current) return
    const text = FORM_TEXT.safeParse({ principal: principalText, opening: openingText, installment: installmentText, cardOwed: cardOwedText, rate: rateText })
    if (!text.success) {
      const fields: DebtErrors['fields'] = {}
      for (const issue of text.error.issues) {
        const field = TEXT_FIELD[issue.path[0] as keyof typeof TEXT_FIELD]
        fields[field] ??= t(issue.message as MessageKey)
      }
      setErrors({ fields })
      return
    }

    const rate = rateText.trim() === '' ? null : parsePercentToBps(rateText)
    const draft: DebtDraft = {
      name,
      kind,
      lender,
      principalSatang: toMoney(principalText) ?? null,
      openingBalanceSatang: card ? null : (toMoney(openingText) ?? null),
      openingDate,
      startDate: !card && hasStart ? startDate : undefined,
      maturityDate: !card && hasMaturity ? maturityDate : undefined,
      interestMethod: method,
      annualInterestRateBps: method === 'none' ? null : rate,
      installmentSatang: card ? null : (toMoney(installmentText) ?? null),
      dueDay: !card && dueDay ? Number(dueDay) : undefined,
      scheduleEnabled: !card && scheduleEnabled,
      status: existing ? status : undefined,
      linkedAccountId: card && cardMode === 'existing' ? linkedAccountId : undefined,
      note,
    }
    const newCard = card && !existing && cardMode === 'new' ? { name: cardName || name, owedSatang: toMoney(cardOwedText) ?? undefined } : undefined

    submitting.current = true
    setSaving(true)
    onSavingChange(true)
    setErrors({ fields: {} })
    try {
      await onSubmit(draft, newCard)
    } catch (error) {
      setErrors(debtFailureToErrors(error))
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

      <SelectField
        label={t('debts.form.kind')}
        value={kind}
        onValueChange={(value) => {
          const next = value as DebtKind
          setKind(next)
          // Card terms are rarely known up front: do not presume a method.
          if (next === 'credit_card' && rateText.trim() === '') setMethod('unknown')
        }}
        options={kindOptions.map((k) => ({ value: k, label: t(`debts.kind.${k}`) }))}
        disabled={saving}
      />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={DEBT_NAME_ID}>{t('debts.form.name')}</Label>
        <Input
          id={DEBT_NAME_ID}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('debts.form.namePlaceholder')}
          maxLength={80}
          autoComplete="off"
          aria-invalid={errors.fields.name ? true : undefined}
          disabled={saving}
        />
        <FieldError message={errors.fields.name} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={lenderId}>{t('debts.form.creditor')}</Label>
        <Input id={lenderId} value={lender} onChange={(event) => setLender(event.target.value)} maxLength={80} autoComplete="off" disabled={saving} />
      </div>

      {card ? (
        <fieldset className="flex flex-col gap-stack">
          <legend className="mb-1.5 text-sm font-medium">{t('debts.form.cardAccount')}</legend>
          <p className="text-xs text-muted-foreground">{t('debts.form.cardAccountHint')}</p>
          {!existing && cardAccounts.length > 0 && (
            <ChoiceGroup
              legend={t('debts.form.cardAccount')}
              hideLegend
              layout="scroll"
              name={`${formId}-card-mode`}
              options={[
                { value: 'existing', label: t('debts.form.useExistingCard') },
                { value: 'new', label: t('debts.form.createCard') },
              ]}
              value={cardMode}
              onValueChange={(value) => setCardMode(value as 'existing' | 'new')}
            />
          )}
          {cardMode === 'existing' ? (
            <AccountSelector
              label={t('debts.form.cardAccount')}
              name={`${formId}-card`}
              options={cardAccounts.map((a) => ({ value: a.id, label: a.name, icon: createElement(ACCOUNT_KIND_VISUALS[a.kind].icon) }))}
              value={linkedAccountId}
              onValueChange={setLinkedAccountId}
            />
          ) : (
            <>
              {cardAccounts.length === 0 && <p className="rounded-md bg-info-muted px-3 py-2 text-sm">{t('debts.form.cardAccountNone')}</p>}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={cardNameId}>{t('debts.form.cardName')}</Label>
                <Input id={cardNameId} value={cardName} onChange={(event) => setCardName(event.target.value)} placeholder={name} maxLength={80} autoComplete="off" disabled={saving} />
              </div>
              <AmountInput size="md" label={t('debts.form.cardOwed')} value={cardOwedText} onValueChange={(value) => setCardOwedText(value)} tone="debt" disabled={saving} />
            </>
          )}
          <FieldError message={errors.fields.cardAccount} />
        </fieldset>
      ) : (
        <>
          <AmountInput
            size="md"
            label={t('debts.form.opening')}
            value={openingText}
            onValueChange={(value) => setOpeningText(value)}
            error={errors.fields.opening}
            tone="debt"
            required
            disabled={saving}
          />
          <div className="flex flex-col gap-1.5">
            <DateInput label={t('debts.form.openingDate')} shortcuts={false} today={today} max={today} value={openingDate} onValueChange={setOpeningDate} />
            <p className="text-xs text-muted-foreground">{t('debts.form.openingHint')}</p>
            <FieldError message={errors.fields.openingDate} />
          </div>
          <div className="flex flex-col gap-1.5">
            <AmountInput size="md" label={t('debts.form.original')} value={principalText} onValueChange={(value) => setPrincipalText(value)} error={errors.fields.principal} disabled={saving} />
            <p className="text-xs text-muted-foreground">{t('debts.form.originalHint')}</p>
          </div>
        </>
      )}

      <div className="grid gap-stack sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={rateId}>{t('debts.form.rate')}</Label>
          <Input
            id={rateId}
            value={rateText}
            onChange={(event) => setRateText(event.target.value)}
            inputMode="decimal"
            autoComplete="off"
            placeholder="—"
            aria-invalid={errors.fields.rate ? true : undefined}
            disabled={saving || method === 'none'}
          />
          <p className="text-xs text-muted-foreground">{t('debts.form.rateHint')}</p>
          <FieldError message={errors.fields.rate} />
        </div>
        <SelectField
          label={t('debts.form.basis')}
          value={method}
          onValueChange={(value) => setMethod(value as InterestMethod)}
          options={METHODS.map((m) => ({ value: m, label: t(`debts.detail.basis.${m}`) }))}
          disabled={saving}
        />
      </div>

      {!card && (
        <>
          <div className="grid gap-stack sm:grid-cols-2">
            <AmountInput size="md" label={t('debts.form.installment')} value={installmentText} onValueChange={(value) => setInstallmentText(value)} error={errors.fields.installment} disabled={saving} />
            <SelectField
              label={t('debts.form.dueDay')}
              value={dueDay}
              onValueChange={setDueDay}
              error={errors.fields.dueDay}
              options={[{ value: '', label: t('debts.form.dueDayNone') }, ...Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))]}
              disabled={saving}
            />
          </div>
          <div className="flex flex-col gap-1">
            <CheckRow checked={scheduleEnabled} onChange={setScheduleEnabled} disabled={saving}>
              {t('debts.form.schedule')}
            </CheckRow>
            <p className="text-xs text-muted-foreground">{t('debts.form.scheduleHint')}</p>
            <FieldError message={errors.fields.schedule} />
          </div>
          <div className="flex flex-col gap-stack">
            <CheckRow checked={hasStart} onChange={setHasStart} disabled={saving}>
              {t('debts.form.hasStart')}
            </CheckRow>
            {hasStart && <DateInput label={t('debts.form.startDate')} shortcuts={false} today={today} value={startDate} onValueChange={setStartDate} />}
            <FieldError message={errors.fields.startDate} />
            <CheckRow checked={hasMaturity} onChange={setHasMaturity} disabled={saving}>
              {t('debts.form.hasMaturity')}
            </CheckRow>
            {hasMaturity && <DateInput label={t('debts.form.maturity')} shortcuts={false} today={today} value={maturityDate} onValueChange={setMaturityDate} />}
            <FieldError message={errors.fields.maturity} />
          </div>
        </>
      )}

      {existing && (
        <SelectField
          label={t('debts.form.status')}
          value={status}
          onValueChange={(value) => setStatus(value as Debt['status'])}
          options={(['active', 'paid_off'] as const).map((s) => ({ value: s, label: t(`debts.status.${s}`) }))}
          disabled={saving}
        />
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={noteId}>
          {t('debts.form.note')} <span className="font-normal text-muted-foreground">({t('common.optional')})</span>
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

export interface DebtFormSheetProps {
  /** null = closed; 'create' = new; otherwise the debt being edited. */
  target: null | 'create' | Debt
  onClose: () => void
  data: DebtFormData | null
  today: ISODate
  ops: Pick<DebtsOps, 'create' | 'update'>
  /** Called with the new debt's id after creating it. */
  onCreated?: (id: ID) => void
}

/** Create / edit a debt: full-screen on phones, right panel on larger screens. */
export function DebtFormSheet({ target, onClose, data, today, ops, onCreated }: DebtFormSheetProps) {
  const formId = useId()
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  // One id per opening so a repeated submit can never create two debts (or two card accounts).
  const [createId, setCreateId] = useState(newId)
  const [cardId, setCardId] = useState(newId)
  const [shown, setShown] = useState(target)
  if (shown !== target) {
    setShown(target)
    setSaving(false)
    if (target === 'create') {
      setCreateId(newId())
      setCardId(newId())
    }
  }
  const existing = target && target !== 'create' ? target : undefined

  return (
    <Drawer
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
      title={existing ? t('debts.form.editTitle') : t('debts.form.createTitle')}
      size="full"
      onOpenAutoFocus={(event) => {
        event.preventDefault()
        document.getElementById(DEBT_NAME_ID)?.focus()
      }}
      footer={
        data && target !== null ? (
          <PrimaryButton type="submit" form={formId} size="lg" loading={saving}>
            {t('debts.form.save')}
          </PrimaryButton>
        ) : undefined
      }
    >
      {data && target !== null && (
        <DebtForm
          key={existing?.id ?? createId}
          formId={formId}
          data={data}
          existing={existing}
          today={today}
          onSavingChange={setSaving}
          onSubmit={async (draft, newCard) => {
            if (existing) {
              await ops.update(existing.id, draft)
              toast.show({ message: t('debts.toast.updated') })
            } else {
              await ops.create(draft, createId, newCard ? { ...newCard, id: cardId } : undefined)
              toast.show({ message: t('debts.toast.created', { name: draft.name.trim() }) })
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
