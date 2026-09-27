import { createElement, useId, useRef, useState, type FormEvent } from 'react'
import { PrimaryButton } from '@/components/actions/buttons'
import { useToast } from '@/components/feedback/toast-context'
import { ACCOUNT_KIND_VISUALS } from '@/components/finance/account-visuals'
import { AccountSelector } from '@/components/forms/AccountSelector'
import { AmountInput } from '@/components/forms/AmountInput'
import { CategorySelector } from '@/components/forms/CategorySelector'
import { ChoiceGroup } from '@/components/forms/ChoiceGroup'
import { DateInput } from '@/components/forms/DateInput'
import { SelectField } from '@/components/forms/SelectField'
import { Drawer } from '@/components/overlays/Drawer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Account, Category, Debt, ID, ISODate, RecurringObligation } from '@/domain/entities'
import { formatMoney, tryParseBaht } from '@/domain/money'
import { MAX_INTERVAL, nextOccurrenceOnOrAfter, weekdayOf, type DayOfWeek, type RecurrenceFrequency, type RecurrenceRule } from '@/domain/recurrence'
import { hasOwnSchedule } from '@/domain/debts'
import type { ObligationDraft } from '@/domain/scheduling'
import { accountClassOf } from '@/domain/transactions'
import { formatDate } from '@/lib/formatting'
import { monthName, weekdayName } from '@/lib/dates'
import { APP_LOCALE, t } from '@/lib/i18n'
import { newId } from '@/lib/ids'
import { obligationFailureToErrors, type ObligationErrors } from '../errors'
import type { RecurringOps } from '../recurring-ops'

export const OBLIGATION_NAME_ID = 'recurring-form-name'

export interface RecurringFormData {
  categories: Category[]
  accounts: Account[]
  debts: Debt[]
}

type Kind = 'bill' | 'debt'

const FREQUENCIES: readonly RecurrenceFrequency[] = ['monthly', 'weekly', 'yearly']
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

function FieldError({ message }: { message?: string }) {
  return message ? (
    <p role="alert" className="text-xs text-destructive">
      {message}
    </p>
  ) : null
}

function RecurringForm({
  formId,
  data,
  existing,
  today,
  income,
  onSubmit,
  onSavingChange,
}: {
  income: boolean
  formId: string
  data: RecurringFormData
  existing?: RecurringObligation
  today: ISODate
  onSubmit: (draft: ObligationDraft) => Promise<void>
  onSavingChange: (saving: boolean) => void
}) {
  const rule = existing?.recurrence
  const openAccounts = data.accounts.filter((a) => !a.archivedAt || a.id === existing?.defaultAccountId)
  const categories = data.categories.filter((c) => c.kind === (income ? 'income' : 'expense') && (!c.archivedAt || c.id === existing?.categoryId))
  // One schedule owner per debt: debts with their own installments/statements are paid from #/debts.
  const payableDebts = data.debts.filter((d) => d.id === existing?.debtId || (!d.archivedAt && d.status === 'active' && !hasOwnSchedule(d)))
  const hasDebts = !income && payableDebts.length > 0

  const [name, setName] = useState(existing?.name ?? '')
  const [amountText, setAmountText] = useState(existing ? formatMoney(existing.expectedAmountSatang, { locale: APP_LOCALE, symbol: false, trimZeroFraction: true }) : '')
  const [kind, setKind] = useState<Kind>(existing?.debtId ? 'debt' : 'bill')
  const [categoryId, setCategoryId] = useState<ID | undefined>(existing?.categoryId)
  const [debtId, setDebtId] = useState<ID | undefined>(existing?.debtId)
  const [accountId, setAccountId] = useState<ID | undefined>(
    existing?.defaultAccountId ?? openAccounts.find((a) => !a.archivedAt && accountClassOf(a.kind) === 'asset')?.id,
  )
  const [frequency, setFrequency] = useState<RecurrenceFrequency>(rule?.frequency ?? 'monthly')
  const [interval, setInterval] = useState(String(rule?.interval ?? 1))
  const [startDate, setStartDate] = useState<ISODate>(rule?.startDate ?? today)
  const [dayOfMonth, setDayOfMonth] = useState(String(rule?.dayOfMonth ?? Number((rule?.startDate ?? today).slice(8, 10))))
  const [dayOfWeek, setDayOfWeek] = useState<DayOfWeek>(rule?.dayOfWeek ?? weekdayOf(rule?.startDate ?? today))
  const [monthOfYear, setMonthOfYear] = useState(String(rule?.monthOfYear ?? Number((rule?.startDate ?? today).slice(5, 7))))
  const [hasEnd, setHasEnd] = useState(Boolean(rule?.endDate))
  const [endDate, setEndDate] = useState<ISODate>(rule?.endDate ?? today)
  const [note, setNote] = useState(existing?.note ?? '')
  const [errors, setErrors] = useState<ObligationErrors>({ fields: {} })
  const [saving, setSaving] = useState(false)
  const submitting = useRef(false)
  const noteId = useId()

  const recurrence: RecurrenceRule = {
    frequency,
    interval: Number(interval),
    startDate,
    ...(hasEnd ? { endDate } : {}),
    ...(frequency === 'weekly' ? { dayOfWeek } : { dayOfMonth: Number(dayOfMonth) }),
    ...(frequency === 'yearly' ? { monthOfYear: Number(monthOfYear) } : {}),
  }
  // Mirrors where generation starts: a new rule from this month; an edit from today.
  const firstOfMonth = `${today.slice(0, 7)}-01`
  const previewFrom = existing ? today : startDate > firstOfMonth ? startDate : firstOfMonth
  const firstDue = nextOccurrenceOnOrAfter(recurrence, previewFrom)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (submitting.current) return
    const trimmed = amountText.trim()
    const amountSatang = trimmed === '' ? null : tryParseBaht(trimmed)
    if (trimmed !== '' && amountSatang === null) {
      setErrors({ fields: { amount: t('expense.error.amount_invalid') } })
      return
    }
    submitting.current = true
    setSaving(true)
    onSavingChange(true)
    setErrors({ fields: {} })
    try {
      await onSubmit({
        name,
        amountSatang,
        categoryId: income || kind === 'bill' ? categoryId : undefined,
        debtId: !income && kind === 'debt' ? debtId : undefined,
        ...(income ? { kind: 'income' as const } : {}),
        defaultAccountId: accountId,
        recurrence,
        note,
      })
    } catch (error) {
      setErrors(obligationFailureToErrors(error))
      submitting.current = false
      setSaving(false)
      onSavingChange(false)
    }
  }

  return (
    <form id={formId} onSubmit={handleSubmit} noValidate aria-busy={saving || undefined} className="flex flex-col gap-section">
      {existing && <p className="rounded-md bg-info-muted px-3 py-2 text-sm text-foreground">{t(income ? 'income.form.editHint' : 'recurring.form.editHint')}</p>}
      {errors.form && (
        <p role="alert" className="rounded-md border border-expense/30 bg-expense-muted px-3 py-2 text-sm">
          {errors.form}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={OBLIGATION_NAME_ID}>{t('recurring.form.name')}</Label>
        <Input
          id={OBLIGATION_NAME_ID}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t(income ? 'income.form.namePlaceholder' : 'recurring.form.namePlaceholder')}
          maxLength={80}
          autoComplete="off"
          aria-invalid={errors.fields.name ? true : undefined}
          disabled={saving}
        />
        <FieldError message={errors.fields.name} />
      </div>

      <AmountInput size="md" value={amountText} onValueChange={(text) => setAmountText(text)} error={errors.fields.amount} disabled={saving} tone={income ? 'income' : kind === 'debt' ? 'debt' : 'expense'} />

      {hasDebts && (
        <div className="flex flex-col gap-1.5">
          <ChoiceGroup
            legend={t('recurring.form.kind')}
            layout="scroll"
            name={`${formId}-kind`}
            options={[
              { value: 'bill', label: t('recurring.form.kindBill') },
              { value: 'debt', label: t('recurring.form.kindDebt') },
            ]}
            value={kind}
            onValueChange={(value) => setKind(value as Kind)}
          />
          {kind === 'debt' && <p className="text-xs text-muted-foreground">{t('recurring.form.kindDebtHint')}</p>}
        </div>
      )}

      {income || kind === 'bill' ? (
        <div className="flex flex-col gap-1.5">
          <CategorySelector
            label={income ? t('txForm.incomeCategory') : undefined}
            options={categories.map((c) => ({ value: c.id, label: c.name, icon: c.icon }))} value={categoryId} onValueChange={setCategoryId} />
          <FieldError message={errors.fields.category} />
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <ChoiceGroup
            legend={t('recurring.form.debt')}
            layout="scroll"
            name={`${formId}-debt`}
            options={payableDebts.map((d) => ({ value: d.id, label: d.name }))}
            value={debtId}
            onValueChange={setDebtId}
          />
          <FieldError message={errors.fields.debt} />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <AccountSelector
          label={t(income ? 'income.detail.account' : 'recurring.detail.account')}
          name={`${formId}-account`}
          options={openAccounts
            .filter((a) => (!income && kind === 'bill') || accountClassOf(a.kind) === 'asset')
            .map((a) => ({ value: a.id, label: a.name, icon: createElement(ACCOUNT_KIND_VISUALS[a.kind].icon) }))}
          value={accountId}
          onValueChange={setAccountId}
        />
        <FieldError message={errors.fields.account} />
      </div>

      <fieldset className="flex flex-col gap-stack">
        <legend className="mb-1.5 text-sm font-medium">{t('recurring.form.frequency')}</legend>
        <ChoiceGroup
          legend={t('recurring.form.frequency')}
          hideLegend
          layout="scroll"
          name={`${formId}-frequency`}
          options={FREQUENCIES.map((f) => ({ value: f, label: t(`freq.${f}`) }))}
          value={frequency}
          onValueChange={(value) => {
            const next = value as RecurrenceFrequency
            setFrequency(next)
            if (Number(interval) > MAX_INTERVAL[next]) setInterval('1')
          }}
        />
        <div className="grid grid-cols-2 gap-stack">
          <SelectField
            label={`${t('recurring.form.interval')} (${t(`recurring.form.intervalUnit.${frequency}`)})`}
            value={interval}
            onValueChange={setInterval}
            options={range(1, MAX_INTERVAL[frequency]).map((n) => ({ value: String(n), label: String(n) }))}
          />
          {frequency === 'yearly' && (
            <SelectField
              label={t('recurring.form.month')}
              value={monthOfYear}
              onValueChange={setMonthOfYear}
              options={range(1, 12).map((m) => ({ value: String(m), label: monthName(m) }))}
            />
          )}
        </div>
        {frequency === 'weekly' ? (
          <ChoiceGroup
            legend={t('recurring.form.weekday')}
            layout="scroll"
            name={`${formId}-weekday`}
            options={range(0, 6).map((d) => ({ value: String(d), label: weekdayName(d) }))}
            value={String(dayOfWeek)}
            onValueChange={(value) => setDayOfWeek(Number(value) as DayOfWeek)}
          />
        ) : (
          <SelectField
            label={t('recurring.form.day')}
            hint={t('recurring.form.dayHint')}
            value={dayOfMonth}
            onValueChange={setDayOfMonth}
            options={range(1, 31).map((d) => ({ value: String(d), label: String(d) }))}
          />
        )}
        <FieldError message={errors.fields.schedule} />
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <DateInput label={t('recurring.form.startDate')} shortcuts={false} today={today} value={startDate} onValueChange={setStartDate} />
        <FieldError message={errors.fields.startDate} />
      </div>

      <div className="flex flex-col gap-stack">
        <label className="flex min-h-touch items-center gap-3 text-sm md:min-h-9">
          <input type="checkbox" checked={hasEnd} onChange={(event) => setHasEnd(event.target.checked)} className="focus-ring size-5 accent-(--primary)" />
          {t('recurring.form.hasEnd')}
        </label>
        {hasEnd && <DateInput label={t('recurring.form.endDate')} shortcuts={false} today={today} value={endDate} onValueChange={setEndDate} />}
        <FieldError message={errors.fields.endDate} />
      </div>

      <p className="rounded-md border px-3 py-2 text-sm" aria-live="polite">
        {firstDue ? t(income ? 'income.form.preview' : 'recurring.form.preview', { date: formatDate(firstDue, 'long') }) : t('recurring.form.previewNone')}
      </p>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={noteId}>
          {t('recurring.form.note')} <span className="font-normal text-muted-foreground">({t('common.optional')})</span>
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

export interface RecurringFormSheetProps {
  /** null = closed; 'create' = new; otherwise the obligation being edited. */
  target: null | 'create' | RecurringObligation
  onClose: () => void
  data: RecurringFormData | null
  today: ISODate
  ops: Pick<RecurringOps, 'create' | 'update'>
  /** 'income' = expected income (salary…) instead of a payment. Editing follows the rule's own kind. */
  mode?: 'outgoing' | 'income'
}

/** Create / edit a recurring obligation: full-screen on phones, right panel on larger screens. */
export function RecurringFormSheet({ target, onClose, data, today, ops, mode = 'outgoing' }: RecurringFormSheetProps) {
  const formId = useId()
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  // One id per opening so a repeated submit can never create two obligations.
  const [createId, setCreateId] = useState(newId)
  const [shown, setShown] = useState(target)
  if (shown !== target) {
    setShown(target)
    setSaving(false)
    if (target === 'create') setCreateId(newId())
  }
  const existing = target && target !== 'create' ? target : undefined
  const income = existing ? existing.kind === 'income' : mode === 'income'

  return (
    <Drawer
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
      title={t(income ? (existing ? 'income.form.editTitle' : 'income.form.createTitle') : existing ? 'recurring.form.editTitle' : 'recurring.form.createTitle')}
      size="full"
      onOpenAutoFocus={(event) => {
        event.preventDefault()
        document.getElementById(OBLIGATION_NAME_ID)?.focus()
      }}
      footer={
        data && target !== null ? (
          <PrimaryButton type="submit" form={formId} size="lg" loading={saving}>
            {t('recurring.form.save')}
          </PrimaryButton>
        ) : undefined
      }
    >
      {data && target !== null && (
        <RecurringForm
          key={existing?.id ?? createId}
          formId={formId}
          data={data}
          existing={existing}
          today={today}
          income={income}
          onSavingChange={setSaving}
          onSubmit={async (draft) => {
            if (existing) {
              await ops.update(existing.id, draft)
              toast.show({ message: t('recurring.toast.updated') })
            } else {
              await ops.create(draft, createId)
              toast.show({ message: t('recurring.toast.created', { name: draft.name.trim() }) })
            }
            setSaving(false)
            onClose()
          }}
        />
      )}
    </Drawer>
  )
}
