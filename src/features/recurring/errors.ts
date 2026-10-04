import { StorageError } from '@/db/errors'
import { ObligationNotFoundError, ObligationValidationError, PaymentAlreadySettledError, PlannedAmountError } from '@/db/repositories'
import type { ObligationIssue } from '@/domain/scheduling'
import { t, type MessageKey } from '@/lib/i18n'

export type ObligationField = 'name' | 'amount' | 'category' | 'account' | 'toAccount' | 'debt' | 'schedule' | 'startDate' | 'endDate'

export interface ObligationErrors {
  fields: Partial<Record<ObligationField, string>>
  form?: string
}

const FIELD_OF: Record<ObligationIssue, [ObligationField, MessageKey]> = {
  name_required: ['name', 'recurring.error.name_required'],
  amount_required: ['amount', 'expense.error.amount_required'],
  amount_not_integer: ['amount', 'expense.error.amount_invalid'],
  amount_must_be_positive: ['amount', 'expense.error.amount_must_be_positive'],
  category_required: ['category', 'expense.error.category_required'],
  category_not_expense: ['category', 'expense.error.category_required'],
  category_not_income: ['category', 'txForm.error.category_not_income'],
  account_required: ['account', 'expense.error.account_required'],
  unknown_account: ['account', 'expense.error.account_required'],
  pay_from_liability: ['account', 'txForm.error.pay_from_liability'],
  debt_not_found: ['debt', 'recurring.error.debt_not_found'],
  debt_has_own_schedule: ['debt', 'recurring.error.debt_has_own_schedule'],
  to_account_required: ['toAccount', 'recurring.error.to_account_required'],
  unknown_to_account: ['toAccount', 'recurring.error.to_account_required'],
  same_account: ['toAccount', 'recurring.error.same_account'],
  frequency_invalid: ['schedule', 'recurring.error.interval_invalid'],
  interval_invalid: ['schedule', 'recurring.error.interval_invalid'],
  day_of_month_invalid: ['schedule', 'recurring.error.day_of_month_invalid'],
  month_invalid: ['schedule', 'recurring.error.month_invalid'],
  day_of_week_invalid: ['schedule', 'recurring.error.day_of_week_invalid'],
  count_invalid: ['schedule', 'recurring.error.interval_invalid'],
  start_date_invalid: ['startDate', 'recurring.error.start_date_invalid'],
  end_date_invalid: ['endDate', 'recurring.error.end_date_invalid'],
  end_before_start: ['endDate', 'recurring.error.end_before_start'],
}

/** Any failure → Thai messages. Raw errors are never shown. */
export function obligationFailureToErrors(error: unknown): ObligationErrors {
  if (error instanceof ObligationValidationError) {
    const errors: ObligationErrors = { fields: {} }
    for (const issue of error.issues) {
      const [field, key] = FIELD_OF[issue]
      errors.fields[field] ??= t(key)
    }
    return errors
  }
  if (error instanceof ObligationNotFoundError) return { fields: {}, form: t('recurring.error.not_found') }
  if (error instanceof StorageError) return { fields: {}, form: t(`expense.error.${error.kind}`) }
  return { fields: {}, form: t('expense.error.database') }
}

/** Message for a paid/skipped/pause/delete action that failed. */
export function actionFailureMessage(error: unknown): string {
  if (error instanceof PaymentAlreadySettledError) return t(error.status === 'paid' ? 'recurring.pay.alreadyPaid' : 'recurring.pay.alreadySkipped')
  if (error instanceof ObligationNotFoundError) return t('recurring.error.not_found')
  if (error instanceof PlannedAmountError) return t(error.reason === 'amount_invalid' ? 'expense.error.amount_must_be_positive' : 'plan.error.not_planned')
  if (error instanceof StorageError) return t(`expense.error.${error.kind}`)
  return t('recurring.toast.failed')
}
