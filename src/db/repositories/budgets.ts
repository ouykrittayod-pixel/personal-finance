import { buildBudget, type BudgetDraft, type BudgetIssue } from '@/domain/budget'
import type { Budget, ID } from '@/domain/entities'
import type { FinanceDatabase } from '../dexie'
import { rethrowStorage } from '../errors'

/** Domain validation failed; nothing was written. */
export class BudgetValidationError extends Error {
  readonly issues: BudgetIssue[]
  constructor(issues: BudgetIssue[]) {
    super(`Invalid budget: ${issues.join(', ')}`)
    this.name = 'BudgetValidationError'
    this.issues = issues
  }
}

export class BudgetNotFoundError extends Error {
  constructor(id: ID) {
    super(`Budget ${id} not found`)
    this.name = 'BudgetNotFoundError'
  }
}

const KNOWN = [BudgetValidationError, BudgetNotFoundError]

/**
 * Budgets are plans only. Nothing here reads or writes transactions or
 * balances; spending is derived from transactions by domain/budget.
 * One budget per (month, category) — checked by the domain and enforced by the
 * unique [month+categoryId] index.
 */
export function createBudgetsRepository(database: FinanceDatabase) {
  const tables = [database.budgets, database.categories]

  async function write<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await database.transaction('rw', tables, work)
    } catch (error) {
      return rethrowStorage(error, KNOWN)
    }
  }

  async function context() {
    const [categories, budgets] = await Promise.all([database.categories.toArray(), database.budgets.toArray()])
    return { categories: new Map(categories.map((c) => [c.id, c])), budgets }
  }

  return {
    listAll(): Promise<Budget[]> {
      return database.budgets.toArray()
    },

    listForMonth(month: string): Promise<Budget[]> {
      return database.budgets.where('month').equals(month).toArray()
    },

    get(id: ID): Promise<Budget | undefined> {
      return database.budgets.get(id)
    },

    /** Idempotent on `meta.id` (a double tap creates one budget). */
    create(draft: BudgetDraft, meta: { id: ID; now: string }): Promise<Budget> {
      return write(async () => {
        const stored = await database.budgets.get(meta.id)
        if (stored) return stored
        const result = buildBudget(draft, await context(), meta)
        if (!result.ok) throw new BudgetValidationError(result.issues)
        await database.budgets.add(result.budget)
        return result.budget
      })
    },

    /** Edit in place (same id, createdAt). Spending is unaffected — it comes from transactions. */
    update(id: ID, draft: BudgetDraft, meta: { now: string }): Promise<Budget> {
      return write(async () => {
        const existing = await database.budgets.get(id)
        if (!existing) throw new BudgetNotFoundError(id)
        const result = buildBudget(draft, await context(), { id, now: meta.now, existing })
        if (!result.ok) throw new BudgetValidationError(result.issues)
        await database.budgets.put(result.budget)
        return result.budget
      })
    },

    /** Remove the plan only. Transactions, balances and reports are untouched. */
    delete(id: ID): Promise<void> {
      return write(async () => {
        if (!(await database.budgets.get(id))) throw new BudgetNotFoundError(id)
        await database.budgets.delete(id)
      })
    },
  }
}
