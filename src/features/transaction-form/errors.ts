import { StorageError } from '@/db/errors'
import { ExpenseValidationError, TransactionNotFoundError } from '@/db/repositories'
import type { DraftIssue } from '@/domain/transactions'
import { t, type MessageKey } from '@/lib/i18n'

export type FormField = 'amount' | 'category' | 'account' | 'toAccount' | 'breakdown' | 'date'

export interface FormErrors {
  fields: Partial<Record<FormField, string>>
  /** Message for the whole form (storage / unexpected problems). */
  form?: string
}

const FIELD_OF: Partial<Record<DraftIssue, [FormField, MessageKey]>> = {
  amount_required: ['amount', 'expense.error.amount_required'],
  amount_must_be_positive: ['amount', 'expense.error.amount_must_be_positive'],
  amount_not_integer: ['amount', 'expense.error.amount_invalid'],
  category_required: ['category', 'expense.error.category_required'],
  category_not_expense: ['category', 'expense.error.category_required'],
  category_not_income: ['category', 'txForm.error.category_not_income'],
  account_required: ['account', 'expense.error.account_required'],
  unknown_account: ['account', 'expense.error.account_required'],
  debt_payment_from_liability: ['account', 'txForm.error.pay_from_liability'],
  to_account_required: ['toAccount', 'txForm.error.to_account_required'],
  transfer_requires_to_account: ['toAccount', 'txForm.error.to_account_required'],
  unknown_to_account: ['toAccount', 'txForm.error.to_account_required'],
  same_account: ['toAccount', 'txForm.error.same_account'],
  transfer_liability_not_allowed: ['toAccount', 'txForm.error.transfer_liability_not_allowed'],
  breakdown_invalid: ['breakdown', 'txForm.error.breakdown_invalid'],
  breakdown_exceeds_amount: ['breakdown', 'txForm.error.breakdown_exceeds_amount'],
  breakdown_not_allowed: ['breakdown', 'txForm.error.breakdown_not_allowed'],
  allocation_required: ['breakdown', 'txForm.error.allocation_required'],
  allocation_mismatch: ['breakdown', 'txForm.error.allocation_mismatch'],
  principal_exceeds_outstanding: ['breakdown', 'txForm.error.principal_exceeds_outstanding'],
  payment_before_opening: ['date', 'txForm.error.payment_before_opening'],
  date_invalid: ['date', 'expense.error.date_invalid'],
}

/** Domain issues → Thai field messages. Unmapped issues become a general message. */
export function issuesToErrors(issues: readonly DraftIssue[]): FormErrors {
  const errors: FormErrors = { fields: {} }
  for (const issue of issues) {
    const mapped = FIELD_OF[issue]
    if (mapped) errors.fields[mapped[0]] ??= t(mapped[1])
    else errors.form = t('expense.error.invalid')
  }
  return errors
}

/** Any save failure → user-facing Thai message. Never exposes raw errors. */
export function saveFailureToErrors(error: unknown): FormErrors {
  if (error instanceof ExpenseValidationError) return issuesToErrors(error.issues)
  if (error instanceof TransactionNotFoundError) return { fields: {}, form: t('txForm.error.not_found') }
  if (error instanceof StorageError) return { fields: {}, form: t(`expense.error.${error.kind}`) }
  return { fields: {}, form: t('expense.error.database') }
}
