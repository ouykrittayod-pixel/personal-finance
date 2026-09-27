import { buildCategory, isDuplicateCategory, type CategoryDraft, type CategoryIssue } from '@/domain/categories'
import type { Category, CategoryKind, ID } from '@/domain/entities'
import type { FinanceDatabase } from '../dexie'
import { rethrowStorage } from '../errors'

export class CategoryValidationError extends Error {
  readonly issues: CategoryIssue[]
  constructor(issues: CategoryIssue[]) {
    super(`Invalid category: ${issues.join(', ')}`)
    this.name = 'CategoryValidationError'
    this.issues = issues
  }
}

export class CategoryNotFoundError extends Error {
  constructor(id: ID) {
    super(`Category ${id} not found`)
    this.name = 'CategoryNotFoundError'
  }
}

const KNOWN = [CategoryValidationError, CategoryNotFoundError]

export interface CategoryTemplate {
  name: string
  icon?: string
}

export function createCategoriesRepository(database: FinanceDatabase) {
  const write = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await database.transaction('rw', database.categories, run)
    } catch (error) {
      return rethrowStorage(error, KNOWN)
    }
  }
  return {
    listAll(): Promise<Category[]> {
      return database.categories.orderBy('sortOrder').toArray()
    },

    /**
     * Create a starter set of categories — only on the user's explicit request,
     * and only if they have none of that kind yet (safe to call twice).
     * Returns how many were created.
     */
    async createStarterSet(kind: CategoryKind, templates: readonly CategoryTemplate[], meta: { now: string; newId: () => string }): Promise<number> {
      return database.transaction('rw', database.categories, async () => {
        const existing = await database.categories.where('kind').equals(kind).count()
        if (existing > 0) return 0
        await database.categories.bulkAdd(
          templates.map((template, index): Category => ({
            id: meta.newId(),
            kind,
            name: template.name,
            ...(template.icon ? { icon: template.icon } : {}),
            sortOrder: index,
            createdAt: meta.now,
            updatedAt: meta.now,
          })),
        )
        return templates.length
      })
    },

    /** A new category (validated; a duplicate open name of the same kind is refused). */
    async create(draft: CategoryDraft, meta: { id: ID; now: string }): Promise<Category> {
      return write(async () => {
        const result = buildCategory(draft, await database.categories.toArray(), meta)
        if (!result.ok) throw new CategoryValidationError(result.issues)
        await database.categories.add(result.category)
        return result.category
      })
    },

    /** Rename / change the icon. The kind cannot change (existing transactions depend on it). */
    async update(id: ID, draft: CategoryDraft, meta: { now: string }): Promise<Category> {
      return write(async () => {
        const existing = await database.categories.get(id)
        if (!existing) throw new CategoryNotFoundError(id)
        const result = buildCategory(draft, await database.categories.toArray(), { id, now: meta.now, existing })
        if (!result.ok) throw new CategoryValidationError(result.issues)
        await database.categories.put(result.category)
        return result.category
      })
    },

    /** Hide from new entries; history keeps the name. */
    async archive(id: ID, meta: { now: string }): Promise<Category> {
      return write(async () => {
        const existing = await database.categories.get(id)
        if (!existing) throw new CategoryNotFoundError(id)
        const archived = { ...existing, archivedAt: existing.archivedAt ?? meta.now, updatedAt: meta.now }
        await database.categories.put(archived)
        return archived
      })
    },

    /** Bring back an archived category (refused if an open one now has the same name). */
    async restore(id: ID, meta: { now: string }): Promise<Category> {
      return write(async () => {
        const existing = await database.categories.get(id)
        if (!existing) throw new CategoryNotFoundError(id)
        if (isDuplicateCategory(existing.name, existing.kind, await database.categories.toArray(), id)) throw new CategoryValidationError(['duplicate'])
        const { archivedAt: _a, ...restored } = existing
        const next = { ...restored, updatedAt: meta.now }
        await database.categories.put(next)
        return next
      })
    },
  }
}
