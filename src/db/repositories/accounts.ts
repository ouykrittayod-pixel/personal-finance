import { buildAccount, isAccountActiveAtDate, type AccountDraft, type AccountIssue } from '@/domain/accounts'
import { isDebtActive } from '@/domain/debts'
import type { Account, ID, ISODate } from '@/domain/entities'
import type { FinanceDatabase } from '../dexie'
import { rethrowStorage } from '../errors'

export type AccountWriteIssue = AccountIssue | 'linked_to_debt'

/** Domain validation failed; nothing was written. */
export class AccountValidationError extends Error {
  readonly issues: AccountWriteIssue[]
  constructor(issues: AccountWriteIssue[]) {
    super(`Invalid account: ${issues.join(', ')}`)
    this.name = 'AccountValidationError'
    this.issues = issues
  }
}

export class AccountNotFoundError extends Error {
  constructor(id: ID) {
    super(`Account ${id} not found`)
    this.name = 'AccountNotFoundError'
  }
}

const KNOWN = [AccountValidationError, AccountNotFoundError]

/**
 * Accounts. Only the account record is ever written here: balances are derived
 * from the opening balance + transactions, so no write here creates, edits or
 * deletes a transaction, and an account with history is archived, never deleted.
 */
export function createAccountsRepository(database: FinanceDatabase) {
  const tables = [database.accounts, database.transactions, database.debts]

  async function write<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await database.transaction('rw', tables, work)
    } catch (error) {
      return rethrowStorage(error, KNOWN)
    }
  }

  async function mustGet(id: ID): Promise<Account> {
    const account = await database.accounts.get(id)
    if (!account) throw new AccountNotFoundError(id)
    return account
  }

  async function historyOf(id: ID) {
    const [from, to] = await Promise.all([database.transactions.where('accountId').equals(id).toArray(), database.transactions.where('toAccountId').equals(id).toArray()])
    return [...from, ...to]
  }

  const linkedToDebt = async (id: ID) => (await database.debts.where('linkedAccountId').equals(id).toArray()).some(isDebtActive)

  return {
    /** All accounts (including archived — history still references them), in display order. */
    listAll(): Promise<Account[]> {
      return database.accounts.orderBy('sortOrder').toArray()
    },

    /** Accounts that can be chosen for new transactions, transfers and rules. */
    async listActive(): Promise<Account[]> {
      return (await database.accounts.orderBy('sortOrder').toArray()).filter((a) => !a.archivedAt)
    },

    /** Accounts that existed on a date (opened on or before it), archived ones included for history. */
    async listForDate(date: ISODate): Promise<Account[]> {
      return (await database.accounts.orderBy('sortOrder').toArray()).filter((a) => isAccountActiveAtDate(a, date))
    },

    get(id: ID): Promise<Account | undefined> {
      return database.accounts.get(id)
    },

    /**
     * Create one account the user asked for, placed last. Idempotent on
     * `meta.id` (a double tap creates one account). The opening balance is the
     * starting state — no transaction is created.
     */
    create(draft: AccountDraft, meta: { id: ID; now: string }): Promise<Account> {
      return write(async () => {
        const stored = await database.accounts.get(meta.id)
        if (stored) return stored
        const last = await database.accounts.orderBy('sortOrder').last()
        const result = buildAccount(
          draft,
          { accounts: await database.accounts.toArray(), transactions: [], linkedToDebt: false },
          { id: meta.id, now: meta.now, sortOrder: (last?.sortOrder ?? -1) + 1 },
        )
        if (!result.ok) throw new AccountValidationError(result.issues)
        await database.accounts.add(result.account)
        return result.account
      })
    },

    /** Edit in place (same id). Never touches transactions; derived balances follow the new opening balance. */
    update(id: ID, draft: AccountDraft, meta: { now: string }): Promise<Account> {
      return write(async () => {
        const existing = await mustGet(id)
        const result = buildAccount(
          draft,
          { accounts: await database.accounts.toArray(), transactions: await historyOf(id), linkedToDebt: await linkedToDebt(id) },
          { id, now: meta.now, sortOrder: existing.sortOrder, existing },
        )
        if (!result.ok) throw new AccountValidationError(result.issues)
        await database.accounts.put(result.account)
        return result.account
      })
    },

    /**
     * Archive: kept with all its history, no longer selectable, not counted in
     * available money. A card that a live debt tracks must keep its account
     * (archive the debt first).
     */
    archive(id: ID, meta: { now: string }): Promise<Account> {
      return write(async () => {
        const existing = await mustGet(id)
        if (existing.archivedAt) return existing
        if (await linkedToDebt(id)) throw new AccountValidationError(['linked_to_debt'])
        const archived: Account = { ...existing, archivedAt: meta.now, updatedAt: meta.now }
        await database.accounts.put(archived)
        return archived
      })
    },

    restore(id: ID, meta: { now: string }): Promise<Account> {
      return write(async () => {
        const existing = await mustGet(id)
        if (!existing.archivedAt) return existing
        const restored: Account = { ...existing, updatedAt: meta.now }
        delete restored.archivedAt
        await database.accounts.put(restored)
        return restored
      })
    },
  }
}
