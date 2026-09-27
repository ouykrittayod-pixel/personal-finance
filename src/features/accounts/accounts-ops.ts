/**
 * The write operations the Accounts UI performs — thin wrappers over the
 * repository that supply now / ids. Injectable for tests.
 */
import { AccountNotFoundError, AccountValidationError, accountsRepository, type AccountWriteIssue } from '@/db/repositories'
import { StorageError } from '@/db/errors'
import type { AccountDraft } from '@/domain/accounts'
import type { ID } from '@/domain/entities'
import { t, type MessageKey } from '@/lib/i18n'

const now = () => new Date().toISOString()

export interface AccountsOps {
  create: (draft: AccountDraft, id: ID) => Promise<unknown>
  update: (id: ID, draft: AccountDraft) => Promise<unknown>
  archive: (id: ID) => Promise<unknown>
  restore: (id: ID) => Promise<unknown>
}

export const defaultAccountsOps: AccountsOps = {
  create: (draft, id) => accountsRepository.create(draft, { id, now: now() }),
  update: (id, draft) => accountsRepository.update(id, draft, { now: now() }),
  archive: (id) => accountsRepository.archive(id, { now: now() }),
  restore: (id) => accountsRepository.restore(id, { now: now() }),
}

export type AccountField = 'name' | 'kind' | 'opening' | 'openingDate'

export interface AccountErrors {
  fields: Partial<Record<AccountField, string>>
  form?: string
}

const FIELD_OF: Record<AccountWriteIssue, [AccountField | null, MessageKey]> = {
  name_required: ['name', 'accounts.error.name_required'],
  name_taken: ['name', 'accounts.error.name_taken'],
  kind_invalid: ['kind', 'accounts.error.kind_invalid'],
  kind_change_not_allowed: ['kind', 'accounts.error.kind_change_not_allowed'],
  kind_linked_to_debt: ['kind', 'accounts.error.kind_linked_to_debt'],
  opening_invalid: ['opening', 'accounts.error.opening_invalid'],
  opening_date_invalid: ['openingDate', 'accounts.error.opening_date_invalid'],
  opening_after_transactions: ['openingDate', 'accounts.error.opening_after_transactions'],
  linked_to_debt: [null, 'accounts.error.linked_to_debt'],
}

/** Any failure → Thai messages. Raw errors are never shown. */
export function accountFailureToErrors(error: unknown): AccountErrors {
  if (error instanceof AccountValidationError) {
    const errors: AccountErrors = { fields: {} }
    for (const issue of error.issues) {
      const [field, key] = FIELD_OF[issue]
      if (field) errors.fields[field] ??= t(key)
      else errors.form ??= t(key)
    }
    return errors
  }
  if (error instanceof AccountNotFoundError) return { fields: {}, form: t('accounts.error.not_found') }
  if (error instanceof StorageError) return { fields: {}, form: t(`expense.error.${error.kind}`) }
  return { fields: {}, form: t('accounts.error.failed') }
}

/** One-line message for an action (archive / restore) that failed. */
export function accountActionFailureMessage(error: unknown): string {
  const errors = accountFailureToErrors(error)
  return errors.form ?? Object.values(errors.fields)[0] ?? t('accounts.error.failed')
}
