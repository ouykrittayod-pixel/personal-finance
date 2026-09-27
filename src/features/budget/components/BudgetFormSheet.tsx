import { useId, useRef, useState, type FormEvent } from 'react'

import { PrimaryButton, SecondaryButton } from '@/components/actions/buttons'
import { MonthSelector } from '@/components/navigation/MonthSelector'
import { useToast } from '@/components/feedback/toast-context'
import { AmountInput } from '@/components/forms/AmountInput'
import { ChoiceGroup } from '@/components/forms/ChoiceGroup'
import { SelectField } from '@/components/forms/SelectField'
import { Drawer } from '@/components/overlays/Drawer'
import { OVERALL_BUDGET } from '@/domain/budget'
import type { Budget, Category } from '@/domain/entities'
import { formatMoney, tryParseBaht } from '@/domain/money'
import { formatYearMonth } from '@/lib/dates'
import { APP_LOCALE, t } from '@/lib/i18n'
import { newId } from '@/lib/ids'
import { budgetFailureToErrors, type BudgetErrors, type BudgetOps } from '../budget-ops'

export const BUDGET_AMOUNT_ID = 'budget-form-amount'

function FieldError({ message }: { message?: string }) {
  return message ? (
    <p role="alert" className="text-xs text-destructive">
      {message}
    </p>
  ) : null
}

type Scope = 'category' | 'overall'

function BudgetForm({
  formId,
  existing,
  initialMonth,
  currentMonth,
  categories,
  budgets,
  onSubmit,
  onSavingChange,
  onEditExisting,
}: {
  formId: string
  existing?: Budget
  initialMonth: string
  currentMonth: string
  /** All categories (the form offers active expense ones, plus the edited budget's own). */
  categories: Category[]
  budgets: Budget[]
  onSubmit: (draft: Parameters<BudgetOps['create']>[0]) => Promise<void>
  onSavingChange: (saving: boolean) => void
  onEditExisting: (budget: Budget) => void
}) {
  const [month, setMonth] = useState(existing?.month ?? initialMonth)
  const [scope, setScope] = useState<Scope>(existing?.categoryId === OVERALL_BUDGET ? 'overall' : 'category')
  const [categoryId, setCategoryId] = useState(existing && existing.categoryId !== OVERALL_BUDGET ? existing.categoryId : '')
  const [amountText, setAmountText] = useState(existing ? formatMoney(existing.limitSatang, { locale: APP_LOCALE, symbol: false, trimZeroFraction: true }) : '')
  const [errors, setErrors] = useState<BudgetErrors>({ fields: {} })
  const [saving, setSaving] = useState(false)
  const submitting = useRef(false)

  // Active expense categories; an edited budget keeps its own (even if since archived). Taken ones are marked.
  const taken = new Set(budgets.filter((b) => b.month === month && b.id !== existing?.id).map((b) => b.categoryId))
  const choices = categories.filter((c) => c.kind === 'expense' && (!c.archivedAt || c.id === existing?.categoryId))
  const target = scope === 'overall' ? OVERALL_BUDGET : categoryId || undefined
  const duplicateOf = target ? budgets.find((b) => b.month === month && b.categoryId === target && b.id !== existing?.id) : undefined

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (submitting.current) return
    const trimmed = amountText.trim()
    const limit = trimmed === '' ? null : tryParseBaht(trimmed)
    if (trimmed !== '' && limit === null) {
      setErrors({ fields: { amount: t('expense.error.amount_invalid') } })
      return
    }
    submitting.current = true
    setSaving(true)
    onSavingChange(true)
    setErrors({ fields: {} })
    try {
      await onSubmit({ month, categoryId: target, limitSatang: limit })
    } catch (error) {
      setErrors(budgetFailureToErrors(error))
      submitting.current = false
      setSaving(false)
      onSavingChange(false)
    }
  }

  return (
    <form id={formId} onSubmit={handleSubmit} noValidate aria-busy={saving || undefined} className="flex flex-col gap-section">
      <p className="rounded-md bg-info-muted px-3 py-2 text-sm">{t('budget.form.hint')}</p>
      {errors.form && (
        <p role="alert" className="rounded-md border border-expense/30 bg-expense-muted px-3 py-2 text-sm">
          {errors.form}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium" id={`${formId}-month`}>
          {t('budget.form.month')}
        </span>
        <div role="group" aria-labelledby={`${formId}-month`} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-1">
          <span className="font-medium">{formatYearMonth(month)}</span>
          <MonthSelector value={month} onChange={setMonth} currentMonth={currentMonth} />
        </div>
        <FieldError message={errors.fields.month} />
      </div>

      <ChoiceGroup
        legend={t('budget.form.scope')}
        layout="scroll"
        name={`${formId}-scope`}
        options={[
          { value: 'category', label: t('budget.form.scopeCategory') },
          { value: 'overall', label: t('budget.form.scopeOverall') },
        ]}
        value={scope}
        onValueChange={(value) => setScope(value as Scope)}
      />

      {scope === 'category' ? (
        <SelectField
          label={t('budget.form.category')}
          value={categoryId}
          onValueChange={setCategoryId}
          error={errors.fields.category}
          options={[
            { value: '', label: t('budget.form.categoryPick') },
            ...choices.map((c) => ({
              value: c.id,
              label: `${c.icon ? `${c.icon} ` : ''}${c.name}${c.archivedAt ? ` ${t('budget.archivedCategory')}` : ''}${taken.has(c.id) ? ` · ${t('budget.error.duplicate')}` : ''}`,
            })),
          ]}
          disabled={saving}
        />
      ) : (
        <p className="text-xs text-muted-foreground">{t('budget.overall.hint')}</p>
      )}
      {scope === 'overall' && <FieldError message={errors.fields.category} />}
      {(errors.duplicate || duplicateOf) && duplicateOf && (
        <SecondaryButton className="self-start" onClick={() => onEditExisting(duplicateOf)}>
          {t('budget.form.openExisting')}
        </SecondaryButton>
      )}

      <AmountInput id={BUDGET_AMOUNT_ID} size="md" label={t('budget.form.amount')} value={amountText} onValueChange={(text) => setAmountText(text)} error={errors.fields.amount} disabled={saving} />
    </form>
  )
}

export interface BudgetFormSheetProps {
  /** null = closed; 'create' = new; otherwise the budget being edited. */
  target: null | 'create' | Budget
  month: string
  currentMonth: string
  categories: Category[]
  budgets: Budget[]
  onClose: () => void
  onEditExisting: (budget: Budget) => void
  ops: Pick<BudgetOps, 'create' | 'update'>
  nameOf: (budget: Pick<Budget, 'categoryId'>) => string
}

/** Create / edit a budget: full-screen on phones, right panel on larger screens. */
export function BudgetFormSheet({ target, month, currentMonth, categories, budgets, onClose, onEditExisting, ops, nameOf }: BudgetFormSheetProps) {
  const formId = useId()
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  // One id per opening: a double tap creates one budget.
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
      title={existing ? t('budget.form.editTitle') : t('budget.form.createTitle')}
      size="full"
      onOpenAutoFocus={(event) => {
        event.preventDefault()
        document.getElementById(BUDGET_AMOUNT_ID)?.focus()
      }}
      footer={
        target !== null ? (
          <PrimaryButton type="submit" form={formId} size="lg" loading={saving}>
            {t('budget.form.save')}
          </PrimaryButton>
        ) : undefined
      }
    >
      {target !== null && (
        <BudgetForm
          key={existing?.id ?? createId}
          formId={formId}
          existing={existing}
          initialMonth={month}
          currentMonth={currentMonth}
          categories={categories}
          budgets={budgets}
          onSavingChange={setSaving}
          onEditExisting={onEditExisting}
          onSubmit={async (draft) => {
            if (existing) {
              await ops.update(existing.id, draft)
              toast.show({ message: t('budget.toast.updated') })
            } else {
              await ops.create(draft, createId)
              toast.show({ message: t('budget.toast.created', { name: nameOf({ categoryId: draft.categoryId ?? '' }) }) })
            }
            setSaving(false)
            onClose()
          }}
        />
      )}
    </Drawer>
  )
}
