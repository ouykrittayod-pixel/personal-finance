import { StorageError } from '@/db/errors'
import { DebtNotFoundError, DebtValidationError, PaymentAlreadySettledError, type DebtWriteIssue } from '@/db/repositories'
import { t, type MessageKey } from '@/lib/i18n'

export type DebtField =
  | 'name'
  | 'opening'
  | 'openingDate'
  | 'principal'
  | 'startDate'
  | 'maturity'
  | 'rate'
  | 'installment'
  | 'dueDay'
  | 'schedule'
  | 'cardAccount'
  | 'amount'
  | 'date'
  | 'statementDate'
  | 'dueDate'
  | 'balance'
  | 'minimum'

export interface DebtErrors {
  fields: Partial<Record<DebtField, string>>
  form?: string
}

const FIELD_OF: Record<DebtWriteIssue, [DebtField | null, MessageKey]> = {
  name_required: ['name', 'debts.error.name_required'],
  opening_required: ['opening', 'debts.error.opening_required'],
  opening_invalid: ['opening', 'debts.error.opening_invalid'],
  opening_date_invalid: ['openingDate', 'debts.error.opening_date_invalid'],
  principal_invalid: ['principal', 'debts.error.principal_invalid'],
  start_date_invalid: ['startDate', 'debts.error.start_date_invalid'],
  maturity_invalid: ['maturity', 'debts.error.maturity_invalid'],
  maturity_before_start: ['maturity', 'debts.error.maturity_before_start'],
  rate_invalid: ['rate', 'debts.error.rate_invalid'],
  installment_invalid: ['installment', 'debts.error.installment_invalid'],
  due_day_invalid: ['dueDay', 'debts.error.due_day_invalid'],
  schedule_incomplete: ['schedule', 'debts.error.schedule_incomplete'],
  schedule_owned_by_obligation: ['schedule', 'debts.error.schedule_owned_by_obligation'],
  card_account_required: ['cardAccount', 'debts.error.card_account_required'],
  card_account_invalid: ['cardAccount', 'debts.error.card_account_invalid'],
  card_account_in_use: ['cardAccount', 'debts.error.card_account_in_use'],
  card_name_required: ['cardAccount', 'debts.error.card_name_required'],
  opening_below_repaid: ['opening', 'debts.error.opening_below_repaid'],
  adjustment_invalid: ['amount', 'debts.error.adjustment_invalid'],
  adjustment_date_invalid: ['date', 'debts.error.adjustment_date_invalid'],
  adjustment_before_opening: ['date', 'debts.error.adjustment_before_opening'],
  not_a_loan: [null, 'debts.error.not_a_loan'],
  not_a_card: [null, 'debts.error.not_a_card'],
  statement_date_invalid: ['statementDate', 'debts.error.statement_date_invalid'],
  due_date_invalid: ['dueDate', 'debts.error.due_date_invalid'],
  due_before_statement: ['dueDate', 'debts.error.due_before_statement'],
  balance_invalid: ['balance', 'debts.error.balance_invalid'],
  minimum_invalid: ['minimum', 'debts.error.minimum_invalid'],
  statement_exists: ['dueDate', 'debts.error.statement_exists'],
  statement_paid: [null, 'debts.error.statement_paid'],
}

/** Issues → Thai messages per field (unmapped ones become a form message). */
export function debtIssuesToErrors(issues: readonly DebtWriteIssue[]): DebtErrors {
  const errors: DebtErrors = { fields: {} }
  for (const issue of issues) {
    const [field, key] = FIELD_OF[issue]
    if (field) errors.fields[field] ??= t(key)
    else errors.form ??= t(key)
  }
  return errors
}

/** Any failure → Thai messages. Raw errors are never shown. */
export function debtFailureToErrors(error: unknown): DebtErrors {
  if (error instanceof DebtValidationError) return debtIssuesToErrors(error.issues)
  if (error instanceof DebtNotFoundError) return { fields: {}, form: t('debts.error.not_found') }
  if (error instanceof StorageError) return { fields: {}, form: t(`expense.error.${error.kind}`) }
  return { fields: {}, form: t('expense.error.database') }
}

/** Message for a one-tap action (pause, archive, skip…) that failed. */
export function debtActionFailureMessage(error: unknown): string {
  if (error instanceof PaymentAlreadySettledError) return t(error.status === 'paid' ? 'recurring.pay.alreadyPaid' : 'recurring.pay.alreadySkipped')
  if (error instanceof DebtValidationError) return debtIssuesToErrors(error.issues).form ?? Object.values(debtIssuesToErrors(error.issues).fields)[0] ?? t('debts.toast.failed')
  if (error instanceof DebtNotFoundError) return t('debts.error.not_found')
  if (error instanceof StorageError) return t(`expense.error.${error.kind}`)
  return t('debts.toast.failed')
}
