import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronDown, CreditCard } from 'lucide-react'
import { createElement, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { AttachmentPreview } from '@/components/data/AttachmentPreview'
import { ACCOUNT_KIND_VISUALS } from '@/components/finance/account-visuals'
import { MoneyDisplay } from '@/components/finance/MoneyDisplay'
import { AccountSelector } from '@/components/forms/AccountSelector'
import { AmountInput, type AmountTone } from '@/components/forms/AmountInput'
import { CategorySelector } from '@/components/forms/CategorySelector'
import { DateInput } from '@/components/forms/DateInput'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Account, Attachment, Category, Debt, ID, ISODate, Transaction } from '@/domain/entities'
import { formatMoney, sum, tryParseBaht, type Satang } from '@/domain/money'
import type { FrequentExpense } from '@/domain/suggestions'
import { dailyInterestSplit, hasDailyInterest } from '@/domain/loan-interest'
import { formatBpsAsPercent } from '@/domain/debts'
import { accountClassOf, type EditableType, type TransactionDraft } from '@/domain/transactions'
import { transactionsRepository } from '@/db/repositories'
import { AttachmentPicker, type PendingAttachment } from '@/features/attachments'
import { addDaysISO } from '@/lib/dates'
import { formatDate } from '@/lib/formatting'
import { APP_LOCALE, t } from '@/lib/i18n'
import { formatTHB } from '@/lib/formatting'
import { cn } from '@/lib/utils'
import { saveFailureToErrors, type FormErrors } from './errors'

export const AMOUNT_INPUT_ID = 'transaction-form-amount'

export interface TransactionFormData {
  /** Categories for this type (expense or income), in display order. */
  categories: Category[]
  /** Selectable accounts (open ones, plus the one an edited record already uses). */
  accounts: Account[]
  debts?: Debt[]
  /** Suggestions (Quick Expense only). */
  frequent?: FrequentExpense[]
  defaultAccountId?: ID
}

export interface ExistingAttachment {
  attachment: Attachment
  /** Loaded by the detail view; shown as a thumbnail when present. */
  blob?: Blob
}

export interface AttachmentEdits {
  add: PendingAttachment[]
  remove: ID[]
}

export interface TransactionFormProps {
  /** Lets a submit button outside the form (a sticky footer) submit it. */
  formId: string
  type: EditableType
  data: TransactionFormData
  /** Edit mode: the stored transaction (its id and type are never changed). */
  initial?: Transaction
  /** Create mode: prefilled values (e.g. paying a scheduled payment). */
  defaults?: Partial<
    Pick<
      Transaction,
      | 'amountSatang'
      | 'categoryId'
      | 'accountId'
      | 'toAccountId'
      | 'debtId'
      | 'principalSatang'
      | 'interestSatang'
      | 'feeSatang'
      | 'date'
      | 'description'
      | 'note'
    >
  >
  existingAttachments?: readonly ExistingAttachment[]
  /** Show the details section (account, date, note…) expanded from the start. */
  detailsInitiallyOpen?: boolean
  /**
   * Settling a scheduled payment: the date it really happened goes right under
   * the amount ("วันที่จ่ายจริง"), so a payment made earlier is easy to back-date;
   * a past due date is offered as a one-tap choice.
   */
  payment?: { dueDate: ISODate; income?: boolean }
  today: ISODate
  /** Persist. Rejects with a repository/storage error on failure; the form then shows a Thai message. */
  onSubmit: (draft: TransactionDraft, attachments: AttachmentEdits) => Promise<void>
  onSavingChange?: (saving: boolean) => void
}

const grouped = (amount: Satang) => formatMoney(amount, { locale: APP_LOCALE, symbol: false, trimZeroFraction: true })
const TONE: Record<EditableType, AmountTone> = { expense: 'expense', income: 'income', debt_payment: 'debt', transfer: 'neutral' }

function parseOptional(text: string): Satang | null | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  return tryParseBaht(trimmed)
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p role="alert" className="text-xs text-destructive">
      {message}
    </p>
  )
}

function AllocationSum({ amountText, parts }: { amountText: string; parts: readonly string[] }) {
  const amount = tryParseBaht(amountText.trim())
  const values = parts.map((text) => (text.trim() === '' ? 0 : tryParseBaht(text.trim())))
  if (amount === null || values.some((v) => v === null)) return null
  const total = sum(values as Satang[])
  return (
    <p aria-live="polite" className={cn('text-xs tabular-nums', total === amount ? 'text-income' : 'text-muted-foreground')}>
      {t('txForm.allocationSum', { sum: formatTHB(total), amount: formatTHB(amount) })}
    </p>
  )
}

/**
 * The one form for creating and editing transactions.
 * Primary fields first (amount, then category or accounts); everything else
 * in "รายละเอียดเพิ่มเติม" (collapsed when creating, open when editing).
 * All validation is the domain's (buildTransaction), surfaced as Thai messages.
 */
export function TransactionForm({
  formId,
  type,
  data,
  initial: stored,
  defaults,
  existingAttachments = [],
  detailsInitiallyOpen = false,
  payment,
  today,
  onSubmit,
  onSavingChange,
}: TransactionFormProps) {
  const editing = stored !== undefined
  // Edit mode starts from the stored record; create mode from any defaults.
  const initial = stored ?? defaults
  const [amountText, setAmountText] = useState(initial?.amountSatang !== undefined ? grouped(initial.amountSatang) : '')
  const [categoryId, setCategoryId] = useState<ID | undefined>(initial?.categoryId)
  const [description, setDescription] = useState(initial?.description ?? '')
  // Never preselect an account this type cannot use (e.g. a credit card as a transfer's source).
  const allowedFrom = (id: ID | undefined) =>
    id && (editing || type === 'expense' || type === 'income' || data.accounts.some((a) => a.id === id && accountClassOf(a.kind) === 'asset')) ? id : undefined
  const [accountId, setAccountId] = useState<ID | undefined>(allowedFrom(initial?.accountId ?? data.defaultAccountId))
  const hasAccount = accountId !== undefined
  const [toAccountId, setToAccountId] = useState<ID | undefined>(initial?.toAccountId)
  const moneyText = (value: Satang | undefined) => (value !== undefined ? grouped(value) : '')
  const [principalText, setPrincipalText] = useState(moneyText(initial?.principalSatang))
  const [interestText, setInterestText] = useState(moneyText(initial?.interestSatang))
  const [feeText, setFeeText] = useState(moneyText(initial?.feeSatang))
  // A stored loan payment without principal was saved as "not split yet".
  const [unallocated, setUnallocated] = useState(stored?.type === 'debt_payment' && stored.principalSatang === undefined)
  // New loan payments split themselves (daily interest) until the user types a split of their own.
  const [autoSplit, setAutoSplit] = useState(!editing)
  const [date, setDate] = useState<ISODate>(initial?.date ?? today)
  const [note, setNote] = useState(initial?.note ?? '')
  const [newFiles, setNewFiles] = useState<PendingAttachment[]>([])
  const [removed, setRemoved] = useState<ReadonlySet<ID>>(new Set())
  const [detailsOpen, setDetailsOpen] = useState(editing || detailsInitiallyOpen || !hasAccount)
  const [errors, setErrors] = useState<FormErrors>({ fields: {} })
  const [saving, setSaving] = useState(false)
  // Synchronous guard: a second tap can arrive before React re-renders the disabled button.
  const submitting = useRef(false)

  const detailsId = useId()
  const descriptionId = useId()
  const noteId = useId()
  const unallocatedId = useId()

  // Focus the amount when the form appears (the sheet may open before data has loaded).
  useEffect(() => {
    document.getElementById(AMOUNT_INPUT_ID)?.focus()
  }, [])

  const accountsById = new Map(data.accounts.map((a) => [a.id, a]))
  const categoriesById = new Map(data.categories.map((c) => [c.id, c]))
  const debt = type === 'debt_payment' ? data.debts?.find((d) => d.id === initial?.debtId) : undefined
  // Loans need an explicit principal / interest / fee split; card payments never have one.
  const isLoanPayment = debt !== undefined && debt.kind !== 'credit_card'
  const computable = debt !== undefined && hasDailyInterest(debt)
  const debtPayments = useLiveQuery(() => (computable && debt ? transactionsRepository.listForDebt(debt.id) : undefined), [computable, debt?.id])
  const enteredAmount = tryParseBaht(amountText.trim())
  const suggested =
    computable && debt && debtPayments && enteredAmount !== null
      ? dailyInterestSplit(debt, debtPayments, { date, amountSatang: enteredAmount, excludeId: stored?.id })
      : null
  const autoActive = autoSplit && suggested !== null && !unallocated
  // What the three split fields show: the computed split while it is automatic, otherwise what was typed.
  const shownPrincipal = autoActive ? grouped(suggested.principal) : principalText
  const shownInterest = autoActive ? grouped(suggested.interest) : interestText
  const shownFee = autoActive ? '0' : feeText
  const account = accountId ? accountsById.get(accountId) : undefined
  const toAccount = toAccountId ? accountsById.get(toAccountId) : undefined
  const frequent = !editing && type === 'expense' ? (data.frequent ?? []) : []

  const accountOption = (a: Account) => ({ value: a.id, label: a.name, icon: createElement(ACCOUNT_KIND_VISUALS[a.kind].icon) })
  // Debts are paid from money you have, not from another liability.
  // Transfers move money between asset accounts only (a card is paid with ชำระหนี้).
  const sourceAccounts = type === 'debt_payment' || type === 'transfer' ? data.accounts.filter((a) => accountClassOf(a.kind) === 'asset') : data.accounts

  const clearFieldError = (field: keyof FormErrors['fields']) =>
    setErrors((current) => (current.fields[field] ? { ...current, fields: { ...current.fields, [field]: undefined } } : current))

  function applyFrequent(item: FrequentExpense) {
    setAmountText(grouped(item.amountSatang))
    setCategoryId(item.categoryId)
    setDescription(item.description)
    if (item.accountId && accountsById.has(item.accountId)) setAccountId(item.accountId)
    setErrors({ fields: {} })
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (submitting.current) return

    const trimmed = amountText.trim()
    const amountSatang = trimmed === '' ? null : tryParseBaht(trimmed)
    if (trimmed !== '' && amountSatang === null) {
      setErrors({ fields: { amount: t('expense.error.amount_invalid') } })
      return
    }
    const split = [shownPrincipal, shownInterest, shownFee].map(parseOptional)
    if (isLoanPayment && !unallocated && split.some((value) => value === null)) {
      setErrors({ fields: { breakdown: t('txForm.error.breakdown_invalid') } })
      return
    }
    const [principalSatang, interestSatang, feeSatang] = split
    const allocation = isLoanPayment
      ? unallocated
        ? { allocation: 'unallocated' as const }
        : { allocation: 'split' as const, principalSatang, interestSatang, feeSatang }
      : {}

    const draft: TransactionDraft = {
      type,
      amountSatang,
      accountId,
      date,
      description,
      note,
      ...(type === 'expense' || type === 'income' ? { categoryId } : {}),
      ...(type === 'transfer' ? { toAccountId } : {}),
      ...(type === 'debt_payment' ? { debtId: initial?.debtId, toAccountId: initial?.toAccountId, ...allocation } : {}),
    }

    submitting.current = true
    setSaving(true)
    onSavingChange?.(true)
    setErrors({ fields: {} })
    try {
      await onSubmit(draft, { add: newFiles, remove: [...removed] })
      // Success: the parent closes or switches view; keep the guard set so late taps do nothing.
    } catch (error) {
      const next = saveFailureToErrors(error)
      setErrors(next)
      if (next.fields.account || next.fields.toAccount || next.fields.date) setDetailsOpen(true)
      if (next.fields.amount) document.getElementById(AMOUNT_INPUT_ID)?.focus()
      submitting.current = false
      setSaving(false)
      onSavingChange?.(false)
    }
  }

  const dateLabel = formatDate(date, 'medium')
  const summary =
    type === 'transfer'
      ? t('txForm.summaryTransfer', { from: account?.name ?? '—', to: toAccount?.name ?? '—', date: dateLabel })
      : !account
        ? t('expense.summaryNoAccount', { date: dateLabel })
        : type === 'income'
          ? t('txForm.summaryIncome', { account: account.name, date: dateLabel })
          : t('expense.summary', { account: account.name, date: dateLabel })

  const visibleExisting = existingAttachments.filter((item) => !removed.has(item.attachment.id))

  const dueShortcut =
    payment && payment.dueDate < today && payment.dueDate !== addDaysISO(today, -1)
      ? [{ label: t('txForm.dueDateShortcut', { date: formatDate(payment.dueDate) }), date: payment.dueDate }]
      : []
  const dateField = (
    <div className="flex flex-col gap-1.5">
      <DateInput
        label={payment ? t(payment.income ? 'txForm.receivedOn' : 'txForm.paidOn') : undefined}
        value={date}
        today={today}
        max={date > today ? date : today}
        extraShortcuts={dueShortcut}
        onValueChange={(next) => {
          setDate(next)
          clearFieldError('date')
        }}
      />
      <FieldError message={errors.fields.date} />
    </div>
  )

  return (
    <form id={formId} onSubmit={handleSubmit} noValidate aria-busy={saving || undefined} className="flex flex-col gap-section">
      {errors.form && (
        <p role="alert" className="rounded-md border border-expense/30 bg-expense-muted px-3 py-2 text-sm text-foreground">
          {errors.form}
        </p>
      )}

      <AmountInput
        id={AMOUNT_INPUT_ID}
        value={amountText}
        onValueChange={(text) => {
          setAmountText(text)
          clearFieldError('amount')
        }}
        tone={TONE[type]}
        error={errors.fields.amount}
        disabled={saving}
        enterKeyHint="done"
        onKeyDown={(event) => {
          // Enter with no category yet: close the keyboard so the category grid is visible.
          if (event.key === 'Enter' && type === 'expense' && !categoryId) {
            event.preventDefault()
            event.currentTarget.blur()
          }
        }}
      />

      {payment && dateField}

      {debt && (
        <div className="flex items-center gap-3 rounded-md border px-3 py-2.5">
          <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-full bg-debt-muted text-debt">
            <CreditCard className="size-5" />
          </span>
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">{t('txForm.debt')}</span>
            <span className="font-medium">{debt.name}</span>
          </div>
        </div>
      )}

      {debt && !isLoanPayment && <p className="text-sm text-muted-foreground">{t('guide.cardPayment')}</p>}
      {isLoanPayment && <p className="text-sm text-muted-foreground">{t('guide.loanPayment')}</p>}

      {isLoanPayment && (
        <fieldset className="flex flex-col gap-stack rounded-md border px-3 py-3" aria-describedby={`${formId}-allocation-hint`}>
          <legend className="px-1 text-sm font-medium">{t('txForm.allocation')}</legend>
          {!unallocated && (
            <>
              <div className="grid gap-stack sm:grid-cols-3">
                {(
                  [
                    ['txForm.principal', shownPrincipal, setPrincipalText],
                    ['txForm.interest', shownInterest, setInterestText],
                    ['txForm.fee', shownFee, setFeeText],
                  ] as const
                ).map(([label, value, setValue]) => (
                  <AmountInput
                    key={label}
                    size="md"
                    label={t(label)}
                    value={value}
                    required
                    aria-invalid={errors.fields.breakdown ? true : undefined}
                    onValueChange={(text) => {
                      if (autoActive) {
                        // Typing over the computed split: keep the other two as they were shown.
                        setPrincipalText(shownPrincipal)
                        setInterestText(shownInterest)
                        setFeeText(shownFee)
                        setAutoSplit(false)
                      }
                      setValue(text)
                      clearFieldError('breakdown')
                    }}
                    disabled={saving}
                  />
                ))}
              </div>
              <AllocationSum amountText={amountText} parts={[shownPrincipal, shownInterest, shownFee]} />
              {suggested && debt && (
                <div className="flex flex-col gap-1 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                  <p className="tabular-nums">
                    {t('txForm.dailyInterest', {
                      base: formatTHB(suggested.base),
                      rate: formatBpsAsPercent(debt.annualInterestRateBps!),
                      days: suggested.days,
                      year: suggested.daysInYear,
                      from: formatDate(suggested.from, 'short'),
                      interest: formatTHB(suggested.interest),
                    })}
                  </p>
                  {autoActive ? (
                    <p>{t('txForm.dailyInterestAuto')}</p>
                  ) : (
                    <button
                      type="button"
                      className="min-h-touch self-start font-medium text-primary underline-offset-2 hover:underline md:min-h-8"
                      disabled={saving}
                      onClick={() => {
                        setAutoSplit(true)
                        clearFieldError('breakdown')
                      }}
                    >
                      {t('txForm.dailyInterestApply')}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
          <p id={`${formId}-allocation-hint`} className="text-xs text-muted-foreground">
            {t('txForm.allocationHint')}
          </p>
          <label htmlFor={unallocatedId} className="flex min-h-touch items-center gap-3 text-sm md:min-h-10">
            <input
              id={unallocatedId}
              type="checkbox"
              checked={unallocated}
              disabled={saving}
              onChange={(event) => {
                setUnallocated(event.target.checked)
                clearFieldError('breakdown')
              }}
              className="size-5 accent-primary"
            />
            {t('txForm.allocationUnknown')}
          </label>
          <FieldError message={errors.fields.breakdown} />
        </fieldset>
      )}

      {frequent.length > 0 && (
        <section aria-labelledby={`${formId}-frequent`} className="flex flex-col gap-2">
          <h3 id={`${formId}-frequent`} className="text-sm font-medium">
            {t('expense.frequent')}
          </h3>
          <ul className="-mx-card flex gap-2 overflow-x-auto px-card pb-1 [scrollbar-width:none]">
            {frequent.map((item) => {
              const category = categoriesById.get(item.categoryId)
              return (
                <li key={`${item.description}|${item.categoryId}|${item.amountSatang}`} className="shrink-0">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => applyFrequent(item)}
                    aria-label={t('expense.frequentUse', { description: item.description, amount: `฿${grouped(item.amountSatang)}` })}
                    className="focus-ring flex min-h-touch items-center gap-2 rounded-md border bg-background px-3 text-sm transition-colors duration-(--duration-fast) hover:bg-muted md:min-h-9"
                  >
                    {category?.icon && <span aria-hidden="true">{category.icon}</span>}
                    <span className="whitespace-nowrap">{item.description}</span>
                    <MoneyDisplay amount={item.amountSatang} size="sm" className="text-muted-foreground" />
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {(type === 'expense' || type === 'income') && (
        <div className="flex flex-col gap-1.5">
          <CategorySelector
            label={type === 'income' ? t('txForm.incomeCategory') : undefined}
            options={data.categories.map((c) => ({ value: c.id, label: c.name, icon: c.icon }))}
            value={categoryId}
            onValueChange={(id) => {
              setCategoryId(id)
              clearFieldError('category')
            }}
          />
          <FieldError message={errors.fields.category} />
        </div>
      )}

      <section className="flex flex-col gap-stack">
        <button
          type="button"
          aria-expanded={detailsOpen}
          aria-controls={detailsId}
          onClick={() => setDetailsOpen((open) => !open)}
          className="focus-ring -mx-2 flex min-h-touch items-center justify-between gap-2 rounded-md px-2 text-left md:min-h-10"
        >
          <span className="flex min-w-0 flex-col">
            <span className="text-sm font-medium">{t('expense.details')}</span>
            <span className={cn('truncate text-xs', errors.fields.account ? 'text-destructive' : 'text-muted-foreground')}>{summary}</span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn('size-5 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast)', detailsOpen && 'rotate-180')}
          />
        </button>

        <div id={detailsId} hidden={!detailsOpen} className="flex flex-col gap-section">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={descriptionId}>
              {t('expense.description')} <span className="font-normal text-muted-foreground">({t('common.optional')})</span>
            </Label>
            <Input
              id={descriptionId}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t(
                type === 'transfer' ? 'transfer.descriptionPlaceholder' : type === 'income' ? 'income.form.namePlaceholder' : 'expense.descriptionPlaceholder',
              )}
              maxLength={120}
              enterKeyHint="done"
              autoComplete="off"
              disabled={saving}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <AccountSelector
              label={type === 'income' ? t('txForm.receivedTo') : type === 'transfer' ? t('txForm.fromAccount') : t('expense.paidFrom')}
              options={sourceAccounts.map(accountOption)}
              value={accountId}
              onValueChange={(id) => {
                setAccountId(id)
                clearFieldError('account')
              }}
            />
            <FieldError message={errors.fields.account} />
          </div>

          {type === 'transfer' && (
            <div className="flex flex-col gap-1.5">
              <AccountSelector
                label={t('txForm.toAccount')}
                name={`${formId}-to`}
                options={sourceAccounts.filter((a) => a.id !== accountId || a.id === toAccountId).map(accountOption)}
                value={toAccountId}
                onValueChange={(id) => {
                  setToAccountId(id)
                  clearFieldError('toAccount')
                }}
              />
              <FieldError message={errors.fields.toAccount} />
            </div>
          )}

          {!payment && dateField}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={noteId}>
              {t('expense.note')} <span className="font-normal text-muted-foreground">({t('common.optional')})</span>
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

          {visibleExisting.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">{t('txForm.existingAttachments')}</h3>
              <ul className="grid gap-2 sm:grid-cols-2">
                {visibleExisting.map(({ attachment, blob }) => (
                  <li key={attachment.id}>
                    <AttachmentPreview
                      fileName={attachment.fileName}
                      mimeType={attachment.mimeType}
                      sizeBytes={attachment.sizeBytes}
                      blob={blob}
                      onRemove={saving ? undefined : () => setRemoved((current) => new Set(current).add(attachment.id))}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <AttachmentPicker value={newFiles} onChange={setNewFiles} disabled={saving} />
        </div>
      </section>
    </form>
  )
}
