/**
 * The write operations the Budget UI performs — thin wrappers over the
 * repository. Injectable for tests.
 */
import { StorageError } from '@/db/errors'
import { BudgetNotFoundError, BudgetValidationError, budgetsRepository } from '@/db/repositories'
import type { BudgetDraft, BudgetIssue } from '@/domain/budget'
import type { ID } from '@/domain/entities'
import { t, type MessageKey } from '@/lib/i18n'

const now = () => new Date().toISOString()

export interface BudgetOps {
  create: (draft: BudgetDraft, id: ID) => Promise<unknown>
  update: (id: ID, draft: BudgetDraft) => Promise<unknown>
  remove: (id: ID) => Promise<unknown>
}

export const defaultBudgetOps: BudgetOps = {
  create: (draft, id) => budgetsRepository.create(draft, { id, now: now() }),
  update: (id, draft) => budgetsRepository.update(id, draft, { now: now() }),
  remove: (id) => budgetsRepository.delete(id),
}

export type BudgetField = 'month' | 'category' | 'amount'

export interface BudgetErrors {
  fields: Partial<Record<BudgetField, string>>
  form?: string
  duplicate?: boolean
}

const FIELD_OF: Record<BudgetIssue, [BudgetField, MessageKey]> = {
  month_invalid: ['month', 'budget.error.month_invalid'],
  category_required: ['category', 'budget.error.category_required'],
  category_not_expense: ['category', 'budget.error.category_not_expense'],
  category_archived: ['category', 'budget.error.category_archived'],
  amount_required: ['amount', 'budget.error.amount_required'],
  amount_invalid: ['amount', 'budget.error.amount_invalid'],
  duplicate: ['category', 'budget.error.duplicate'],
}

/** Any failure → Thai messages. Raw errors are never shown. */
export function budgetFailureToErrors(error: unknown): BudgetErrors {
  if (error instanceof BudgetValidationError) {
    const errors: BudgetErrors = { fields: {}, duplicate: error.issues.includes('duplicate') }
    for (const issue of error.issues) {
      const [field, key] = FIELD_OF[issue]
      errors.fields[field] ??= t(key)
    }
    return errors
  }
  if (error instanceof BudgetNotFoundError) return { fields: {}, form: t('budget.error.not_found') }
  if (error instanceof StorageError) return { fields: {}, form: t(`expense.error.${error.kind}`) }
  return { fields: {}, form: t('budget.error.failed') }
}
