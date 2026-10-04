/**
 * Repositories wrap Dexie tables with domain-level operations
 * (timestamps, validation, multi-table transactions). UI code should use
 * repositories or feature hooks instead of touching `db` tables directly.
 *
 * Each repository is a factory taking a FinanceDatabase so tests can use an
 * isolated database.
 */
import { db } from '../dexie'
import { createAccountsRepository } from './accounts'
import { createAttachmentsRepository } from './attachments'
import { createBudgetsRepository } from './budgets'
import { createCategoriesRepository } from './categories'
import { createDebtsRepository } from './debts'
import { createMetaRepository } from './meta'
import { createRecurringObligationsRepository } from './recurring-obligations'
import { createScheduledPaymentsRepository } from './scheduled-payments'
import { createTransactionsRepository } from './transactions'

export { META_KEYS, createMetaRepository, type MetaKey, type MetaRepository } from './meta'
export { AccountNotFoundError, AccountValidationError, createAccountsRepository, type AccountWriteIssue } from './accounts'
export { createAttachmentsRepository } from './attachments'
export { BudgetNotFoundError, BudgetValidationError, createBudgetsRepository } from './budgets'
export { CategoryNotFoundError, CategoryValidationError, createCategoriesRepository } from './categories'
export { createDebtsRepository, DebtNotFoundError, DebtValidationError, type DebtMeta, type DebtWriteIssue, type NewCardAccount } from './debts'
export {
  createRecurringObligationsRepository,
  ObligationNotFoundError,
  ObligationValidationError,
  type ObligationMeta,
} from './recurring-obligations'
export {
  createScheduledPaymentsRepository,
  PaymentAlreadySettledError,
  paymentTypeFor,
  PlannedAmountError,
  ScheduledPaymentNotFoundError,
  type MarkPaidMeta,
  type OccurrenceRef,
  type MarkPaidResult,
} from './scheduled-payments'
export {
  createTransactionsRepository,
  ExpenseValidationError,
  TransactionNotFoundError,
  TransactionValidationError,
  type AttachmentChanges,
  type CreateExpenseMeta,
  type CreateExpenseResult,
  type NewAttachment,
} from './transactions'
export type { CategoryTemplate } from './categories'

export const metaRepository = createMetaRepository(db)
export const accountsRepository = createAccountsRepository(db)
export const attachmentsRepository = createAttachmentsRepository(db)
export const categoriesRepository = createCategoriesRepository(db)
export const budgetsRepository = createBudgetsRepository(db)
export const debtsRepository = createDebtsRepository(db)
export const recurringObligationsRepository = createRecurringObligationsRepository(db)
export const scheduledPaymentsRepository = createScheduledPaymentsRepository(db)
export const transactionsRepository = createTransactionsRepository(db)
