import type { Account, Category, Debt, ID, Transaction } from '@/domain/entities'
import {
  accountsRepository,
  attachmentsRepository,
  categoriesRepository,
  debtsRepository,
  recurringObligationsRepository,
  scheduledPaymentsRepository,
  transactionsRepository,
} from '@/db/repositories'
import type { ExistingAttachment, TransactionFormData } from '@/features/transaction-form'

export interface TransactionDetail {
  transaction: Transaction
  category?: Category
  account?: Account
  toAccount?: Account
  debt?: Debt
  /** Set when this transaction paid a recurring obligation's scheduled payment. */
  recurring?: { obligationId: ID; name: string; dueDate: string }
  /** Metadata + blobs — loaded only when the detail view is open. */
  attachments: ExistingAttachment[]
  /** What the edit form may offer for this transaction. */
  formData: TransactionFormData
}

/** Everything the detail view and its edit form need; null when the transaction no longer exists. */
export async function loadTransactionDetail(id: ID): Promise<TransactionDetail | null> {
  const transaction = await transactionsRepository.get(id)
  if (!transaction) return null

  const [accounts, categories, debts, attachmentRows] = await Promise.all([
    accountsRepository.listAll(),
    categoriesRepository.listAll(),
    debtsRepository.listAll(),
    attachmentsRepository.listForTransaction(id),
  ])
  const attachments = await Promise.all(
    attachmentRows.map(async (attachment) => ({ attachment, blob: await attachmentsRepository.getBlob(attachment.id) })),
  )

  const scheduled = transaction.scheduledPaymentId ? await scheduledPaymentsRepository.get(transaction.scheduledPaymentId) : undefined
  const obligation = scheduled?.sourceType === 'obligation' ? await recurringObligationsRepository.get(scheduled.sourceId) : undefined

  const used = new Set([transaction.accountId, transaction.toAccountId, transaction.categoryId].filter(Boolean))
  const kind = transaction.type === 'income' ? 'income' : 'expense'

  return {
    transaction,
    category: categories.find((c) => c.id === transaction.categoryId),
    account: accounts.find((a) => a.id === transaction.accountId),
    toAccount: accounts.find((a) => a.id === transaction.toAccountId),
    debt: debts.find((d) => d.id === transaction.debtId),
    recurring: scheduled && obligation ? { obligationId: obligation.id, name: obligation.name, dueDate: scheduled.dueDate } : undefined,
    attachments,
    formData: {
      // Open items, plus archived ones this record already uses (so editing never silently changes them).
      categories: categories.filter((c) => c.kind === kind && (!c.archivedAt || used.has(c.id))),
      accounts: accounts.filter((a) => !a.archivedAt || used.has(a.id)),
      debts,
    },
  }
}
