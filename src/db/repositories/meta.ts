import type { FinanceDatabase } from '../dexie'

/** Well-known meta keys. Add new keys here so usages stay discoverable. */
export const META_KEYS = {
  lastBackupAt: 'lastBackupAt',
  installedAt: 'installedAt',
  /** The user closed the first-run setup card (it can be shown again from Settings). */
  setupDismissedAt: 'setupDismissedAt',
  /** This device's link to the user's Google Drive (account, last synced version). Device-local. */
  drive: 'drive',
} as const

export type MetaKey = (typeof META_KEYS)[keyof typeof META_KEYS]

export function createMetaRepository(database: FinanceDatabase) {
  return {
    async get<T>(key: MetaKey): Promise<T | undefined> {
      const entry = await database.meta.get(key)
      return entry?.value as T | undefined
    },

    async set(key: MetaKey, value: unknown): Promise<void> {
      await database.meta.put({ key, value, updatedAt: new Date().toISOString() })
    },

    async remove(key: MetaKey): Promise<void> {
      await database.meta.delete(key)
    },
  }
}

export type MetaRepository = ReturnType<typeof createMetaRepository>
