import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { STARTER_EXPENSE_CATEGORIES } from '@/features/expenses/quick-expense/starter-categories'
import { FinanceDatabase } from '../dexie'
import { CategoryValidationError, createCategoriesRepository } from './categories'

const now = '2026-09-26T03:00:00.000Z'
let database: FinanceDatabase
let categories: ReturnType<typeof createCategoriesRepository>
let n = 0
let id = 0
const newId = () => `cat-${++id}`

beforeEach(() => {
  database = new FinanceDatabase(`categories-${++n}`)
  categories = createCategoriesRepository(database)
})
afterEach(async () => {
  database.close()
  await database.delete()
})

const issuesOf = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (error) {
    if (error instanceof CategoryValidationError) return error.issues
    throw error
  }
  return []
}

describe('categories repository', () => {
  it('creates a personal category (trimmed, next sort order), icon optional', async () => {
    await categories.create({ kind: 'expense', name: 'อาหาร', icon: '🍚' }, { id: 'food', now })
    const pet = await categories.create({ kind: 'expense', name: '  ค่าใช้จ่าย   ส่วนตัว ' }, { id: 'personal', now })
    expect(pet).toMatchObject({ id: 'personal', kind: 'expense', name: 'ค่าใช้จ่าย ส่วนตัว', sortOrder: 1 })
    expect(pet).not.toHaveProperty('icon')
  })

  it('refuses empty names and duplicates of the same kind (case and spacing ignored); the same name as the other kind is fine', async () => {
    await categories.create({ kind: 'expense', name: 'Food' }, { id: 'food', now })
    expect(await issuesOf(categories.create({ kind: 'expense', name: '  ' }, { id: 'x', now }))).toEqual(['name_required'])
    expect(await issuesOf(categories.create({ kind: 'expense', name: ' food ' }, { id: 'x', now }))).toEqual(['duplicate'])
    await expect(categories.create({ kind: 'income', name: 'Food' }, { id: 'y', now })).resolves.toMatchObject({ kind: 'income' })
    expect(await database.categories.count()).toBe(2)
  })

  it('renames and changes the icon; the kind never changes; renaming to another open name is refused', async () => {
    await categories.create({ kind: 'expense', name: 'อาหาร' }, { id: 'food', now })
    await categories.create({ kind: 'expense', name: 'เดินทาง' }, { id: 'travel', now })
    await expect(categories.update('food', { kind: 'expense', name: 'อาหารและเครื่องดื่ม', icon: '🍜' }, { now })).resolves.toMatchObject({
      name: 'อาหารและเครื่องดื่ม',
      icon: '🍜',
    })
    expect(await issuesOf(categories.update('food', { kind: 'income', name: 'อาหาร' }, { now }))).toEqual(['kind_change_not_allowed'])
    expect(await issuesOf(categories.update('travel', { kind: 'expense', name: 'อาหารและเครื่องดื่ม' }, { now }))).toEqual(['duplicate'])
  })

  it('archives instead of deleting, and restores (unless an open category now uses the name)', async () => {
    await categories.create({ kind: 'expense', name: 'ของเล่น' }, { id: 'toy', now })
    await categories.archive('toy', { now })
    expect((await database.categories.get('toy'))?.archivedAt).toBe(now)
    await categories.create({ kind: 'expense', name: 'ของเล่น' }, { id: 'toy2', now })
    expect(await issuesOf(categories.restore('toy', { now }))).toEqual(['duplicate'])
    await categories.archive('toy2', { now })
    await expect(categories.restore('toy', { now })).resolves.not.toHaveProperty('archivedAt')
    expect(await database.categories.count()).toBe(2)
  })

  it('the starter set is created once — asking again creates nothing', async () => {
    expect(await categories.createStarterSet('expense', STARTER_EXPENSE_CATEGORIES, { now, newId })).toBe(STARTER_EXPENSE_CATEGORIES.length)
    expect(await categories.createStarterSet('expense', STARTER_EXPENSE_CATEGORIES, { now, newId })).toBe(0)
    expect(await database.categories.count()).toBe(STARTER_EXPENSE_CATEGORIES.length)
  })
})
