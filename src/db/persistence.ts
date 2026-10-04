/**
 * Browser storage persistence.
 *
 * Without persistent storage the browser may evict IndexedDB data under
 * storage pressure (and Safari may clear it after 7 days without a visit).
 * Backups remain the real safety net; this only lowers the risk.
 */

export type PersistenceStatus = 'persisted' | 'not_persisted' | 'unsupported'

export interface StorageEstimate {
  usageBytes: number
  quotaBytes: number
}

function storageManager(): StorageManager | undefined {
  return typeof navigator !== 'undefined' ? navigator.storage : undefined
}

/** Ask the browser to keep our data. Safe to call repeatedly. */
export async function requestPersistentStorage(): Promise<PersistenceStatus> {
  const storage = storageManager()
  if (!storage?.persist || !storage.persisted) return 'unsupported'
  if (await storage.persisted()) return 'persisted'
  try {
    return (await storage.persist()) ? 'persisted' : 'not_persisted'
  } catch {
    return 'not_persisted'
  }
}

export async function getStorageEstimate(): Promise<StorageEstimate | null> {
  const storage = storageManager()
  if (!storage?.estimate) return null
  const { usage = 0, quota = 0 } = await storage.estimate()
  return { usageBytes: usage, quotaBytes: quota }
}
