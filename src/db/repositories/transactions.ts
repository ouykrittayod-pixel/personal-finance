import type { Attachment, AttachmentBlob, Debt, ID, ISODate, Transaction } from '@/domain/entities'
import type { Satang } from '@/domain/money'
import { accountBalances } from '@/domain/reporting'
import { isRevolving, validateLoanTimeline } from '@/domain/debts'
import { buildTransaction, latestExpenseDate, type DraftIssue, type ExpenseDraft, type TransactionDraft } from '@/domain/transactions'
import type { FinanceDatabase } from '../dexie'
import { StorageError, toStorageError } from '../errors'

/** A file ready to store (already compressed if it was a large image). */
export interface NewAttachment {
  blob: Blob
  fileName: string
  mimeType: string
  width?: number
  height?: number
}

/** Domain validation failed; nothing was written. */
export class ExpenseValidationError extends Error {
  readonly issues: DraftIssue[]
  constructor(issues: DraftIssue[]) {
    super(`Invalid transaction: ${issues.join(', ')}`)
    this.name = 'ExpenseValidationError'
    this.issues = issues
  }
}
export { ExpenseValidationError as TransactionValidationError }

/** The transaction to edit or delete no longer exists (e.g. deleted in another tab). */
export class TransactionNotFoundError extends Error {
  constructor(id: ID) {
    super(`Transaction ${id} not found`)
    this.name = 'TransactionNotFoundError'
  }
}

export interface CreateExpenseMeta {
  /** Transaction id, generated once per form session: saving twice with it creates one record. */
  id: ID
  now: string
  newId: () => ID
}

export type CreateExpenseResult = { status: 'created' | 'already_saved'; transaction: Transaction }

export interface AttachmentChanges {
  add: readonly NewAttachment[]
  /** Existing attachment ids (of this transaction) to remove. */
  remove: readonly ID[]
}

const KNOWN_ERRORS = [ExpenseValidationError, StorageError, TransactionNotFoundError]
const isKnown = (error: unknown) => KNOWN_ERRORS.some((type) => error instanceof type)

/** Dexie wraps errors thrown inside a transaction callback; surface ours, map the rest. */
function rethrow(error: unknown): never {
  const inner = (error as { inner?: unknown } | null)?.inner
  const cause = isKnown(inner) ? inner : error
  if (isKnown(cause)) throw cause
  throw toStorageError(cause)
}

export function createTransactionsRepository(database: FinanceDatabase) {
  const writeTables = [
    database.transactions,
    database.attachments,
    database.attachmentBlobs,
    database.accounts,
    database.categories,
    database.debts,
    database.scheduledPayments,
  ]

  async function loadContext() {
    const [accounts, categories, debts] = await Promise.all([
      database.accounts.toArray(),
      database.categories.toArray(),
      database.debts.toArray(),
    ])
    return {
      // Archived accounts/categories stay valid for edits of old records that already use them.
      accounts: new Map(accounts.map((a) => [a.id, a])),
      openAccounts: new Map(accounts.filter((a) => !a.archivedAt).map((a) => [a.id, a])),
      categories: new Map(categories.map((c) => [c.id, c])),
      openCategories: new Map(categories.filter((c) => !c.archivedAt).map((c) => [c.id, c])),
      debts: new Map(debts.map((d) => [d.id, d])),
    }
  }

  /**
   * Loans: explicitly allocated principal may never exceed what is outstanding
   * at that point in the loan's history (no overpayment in this version).
   * Checked against the stored history with the candidate in place.
   */
  async function assertLoanIntegrity(candidate: Transaction, debts: ReadonlyMap<ID, Debt>) {
    if (candidate.type !== 'debt_payment' || !candidate.debtId) return
    const debt = debts.get(candidate.debtId)
    if (!debt || isRevolving(debt)) return
    const history = await database.transactions.where('debtId').equals(debt.id).toArray()
    const next = [...history.filter((tx) => tx.id !== candidate.id), candidate]
    if (!validateLoanTimeline(debt, next).ok) throw new ExpenseValidationError(['principal_exceeds_outstanding'])
  }

  async function addAttachments(transactionId: ID, files: readonly NewAttachment[], now: string, newId: () => ID) {
    if (files.length === 0) return
    const rows: Attachment[] = []
    const blobs: AttachmentBlob[] = []
    for (const file of files) {
      const id = newId()
      rows.push({
        id,
        transactionId,
        fileName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.blob.size,
        ...(file.width ? { width: file.width } : {}),
        ...(file.height ? { height: file.height } : {}),
        createdAt: now,
      })
      blobs.push({ id, blob: file.blob })
    }
    try {
      // Metadata and binary data in separate tables: lists never load blobs.
      await database.attachments.bulkAdd(rows)
      await database.attachmentBlobs.bulkAdd(blobs)
    } catch (error) {
      throw toStorageError(error, 'attachment')
    }
  }

  /**
   * Validate (domain rules) and store a new transaction of any editable type
   * with its attachments, in one IndexedDB transaction. Idempotent on
   * `meta.id`. When called inside a caller's transaction (e.g. paying a
   * scheduled payment) it joins that transaction, so all writes commit together.
   */
  async function create(draft: TransactionDraft, attachments: readonly NewAttachment[], meta: CreateExpenseMeta): Promise<CreateExpenseResult> {
    try {
      return await database.transaction('rw', writeTables, async (): Promise<CreateExpenseResult> => {
        const existing = await database.transactions.get(meta.id)
        if (existing) return { status: 'already_saved', transaction: existing }

        const context = await loadContext()
        const result = buildTransaction(
          draft,
          { accounts: context.openAccounts, categories: context.openCategories, debts: context.debts },
          { id: meta.id, now: meta.now, latestDate: latestExpenseDate(meta.now) },
        )
        if (!result.ok) throw new ExpenseValidationError(result.issues)
        await assertLoanIntegrity(result.transaction, context.debts)

        await database.transactions.add(result.transaction)
        await addAttachments(meta.id, attachments, meta.now, meta.newId)
        return { status: 'created', transaction: result.transaction }
      })
    } catch (error) {
      return rethrow(error)
    }
  }

  return {
    /**
     * Every transaction. Account balances need the full history; for a single
     * user this is a few thousand small records. Revisit with cached balances
     * if it ever becomes slow.
     */
    listAll(): Promise<Transaction[]> {
      return database.transactions.toArray()
    },

    get(id: ID): Promise<Transaction | undefined> {
      return database.transactions.get(id)
    },

    /** Payments of one debt, via the debtId index. */
    listForDebt(debtId: ID): Promise<Transaction[]> {
      return database.transactions.where('debtId').equals(debtId).toArray()
    },

    /** Transactions touching one account (as source or destination), via the indexes. */
    async listForAccount(accountId: ID): Promise<Transaction[]> {
      const [from, to] = await Promise.all([
        database.transactions.where('accountId').equals(accountId).toArray(),
        database.transactions.where('toAccountId').equals(accountId).toArray(),
      ])
      return [...from, ...to.filter((tx) => tx.accountId !== accountId)]
    },

    /** Transactions dated in a range (inclusive), optionally of one type — e.g. transfers. */
    listBetween(start: string, end: string, type?: Transaction['type']): Promise<Transaction[]> {
      return type
        ? database.transactions.where('[type+date]').between([type, start], [type, end], true, true).toArray()
        : database.transactions.where('date').between(start, end, true, true).toArray()
    },

    create,

    /** Quick Expense: an `expense` through the same path as every other create. */
    createExpense(draft: ExpenseDraft, attachments: readonly NewAttachment[], meta: CreateExpenseMeta): Promise<CreateExpenseResult> {
      return create({ ...draft, type: 'expense' }, attachments, meta)
    },

    /**
     * Edit a transaction in place (same id, same type, same creation time) and
     * apply attachment changes — all in one IndexedDB transaction, so a failure
     * leaves the previous version exactly as it was.
     */
    async update(id: ID, draft: TransactionDraft, attachments: AttachmentChanges, meta: { now: string; newId: () => ID }): Promise<Transaction> {
      try {
        return await database.transaction('rw', writeTables, async () => {
          const existing = await database.transactions.get(id)
          if (!existing) throw new TransactionNotFoundError(id)

          const context = await loadContext()
          const usable = new Map(context.openAccounts)
          for (const accountId of [existing.accountId, existing.toAccountId]) {
            const account = accountId ? context.accounts.get(accountId) : undefined
            if (account) usable.set(account.id, account)
          }
          const result = buildTransaction(
            draft,
            { accounts: usable, categories: context.categories, debts: context.debts },
            { id, now: meta.now, existing, latestDate: latestExpenseDate(meta.now) },
          )
          if (!result.ok) throw new ExpenseValidationError(result.issues)
          await assertLoanIntegrity(result.transaction, context.debts)

          await database.transactions.put(result.transaction)

          if (attachments.remove.length > 0) {
            const owned = await database.attachments.where('transactionId').equals(id).primaryKeys()
            const toRemove = attachments.remove.filter((attachmentId) => owned.includes(attachmentId))
            await database.attachments.bulkDelete(toRemove)
            await database.attachmentBlobs.bulkDelete(toRemove)
          }
          await addAttachments(id, attachments.add, meta.now, meta.newId)

          // A payment that settles a scheduled payment keeps its paid date in step.
          if (result.transaction.scheduledPaymentId && existing.date !== result.transaction.date) {
            await database.scheduledPayments.update(result.transaction.scheduledPaymentId, {
              paidDate: result.transaction.date,
              updatedAt: meta.now,
            })
          }
          return result.transaction
        })
      } catch (error) {
        return rethrow(error)
      }
    },

    /**
     * Bring an account to the balance it really has (e.g. what the bank app
     * shows): record the difference as one `adjustment` on `meta.date`. An
     * adjustment moves the balance only — it is never an expense or income, so
     * spending, budgets and reports are unchanged. Returns null when the
     * balance already matches. Idempotent on `meta.id`.
     */
    async reconcileBalance(accountId: ID, actualSatang: Satang, meta: { id: ID; now: string; date: ISODate; note?: string }): Promise<Transaction | null> {
      if (!Number.isSafeInteger(actualSatang)) throw new ExpenseValidationError(['amount_not_integer'])
      try {
        return await database.transaction('rw', [database.accounts, database.transactions], async () => {
          const stored = await database.transactions.get(meta.id)
          if (stored) return stored
          const account = await database.accounts.get(accountId)
          if (!account || account.archivedAt) throw new ExpenseValidationError(['unknown_account'])
          const [from, to] = await Promise.all([
            database.transactions.where('accountId').equals(accountId).toArray(),
            database.transactions.where('toAccountId').equals(accountId).toArray(),
          ])
          const current = accountBalances([account], [...from, ...to]).get(accountId) ?? account.openingBalanceSatang
          const difference = (actualSatang - current) as Satang
          if (difference === 0) return null
          const adjustment: Transaction = {
            id: meta.id,
            type: 'adjustment',
            date: meta.date,
            amountSatang: difference,
            accountId,
            description: 'ปรับยอดให้ตรงกับยอดจริง',
            ...(meta.note?.trim() ? { note: meta.note.trim() } : {}),
            createdAt: meta.now,
            updatedAt: meta.now,
          }
          await database.transactions.add(adjustment)
          return adjustment
        })
      } catch (error) {
        return rethrow(error)
      }
    },

    /**
     * Delete a transaction with its attachments. If it had settled a scheduled
     * payment, that payment becomes unpaid again. Balances, debt outstanding
     * and reports are derived from transactions, so they follow automatically.
     */
    async delete(id: ID, meta: { now: string }): Promise<Transaction> {
      try {
        return await database.transaction('rw', writeTables, async () => {
          const existing = await database.transactions.get(id)
          if (!existing) throw new TransactionNotFoundError(id)

          const attachmentIds = await database.attachments.where('transactionId').equals(id).primaryKeys()
          await database.attachments.bulkDelete(attachmentIds)
          await database.attachmentBlobs.bulkDelete(attachmentIds)

          if (existing.scheduledPaymentId) {
            const payment = await database.scheduledPayments.get(existing.scheduledPaymentId)
            if (payment?.transactionId === id) {
              const { transactionId: _t, paidDate: _p, ...rest } = payment
              await database.scheduledPayments.put({ ...rest, status: 'pending', updatedAt: meta.now })
            }
          }

          await database.transactions.delete(id)
          return existing
        })
      } catch (error) {
        return rethrow(error)
      }
    },
  }
}
