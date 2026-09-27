import { createContext, useContext } from 'react'
import type { PersistenceStatus } from '@/db/persistence'

export interface StorageState {
  persistence: PersistenceStatus | 'checking'
  /** Re-request persistent storage (e.g. from a settings button, which counts as a user gesture). */
  requestPersistence: () => Promise<void>
}

export const StorageContext = createContext<StorageState | null>(null)

export function useStorage(): StorageState {
  const value = useContext(StorageContext)
  if (!value) throw new Error('useStorage must be used inside <StorageProvider>')
  return value
}
