import type { WrappedKeyStore } from '@/lib/crypto/vault'
import type { FinanceDatabase } from './dexie'

/**
 * This device's wrapped encryption key in IndexedDB (`keyring`). One key per
 * device in Phase 19. Not part of backups (backups list their tables
 * explicitly) and not tracked for sync.
 */
export function createKeyringStore(database: FinanceDatabase): WrappedKeyStore {
  return {
    load: async () => (await database.keyring.toArray())[0],
    save: async (wrapped) => {
      await database.keyring.add(wrapped)
    },
    remove: async () => {
      await database.keyring.clear()
    },
  }
}
