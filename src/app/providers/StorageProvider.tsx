import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { db } from '@/db/dexie'
import { requestPersistentStorage, type PersistenceStatus } from '@/db/persistence'
import { todayISO } from '@/lib/dates'
import { newId } from '@/lib/ids'
import { t } from '@/lib/i18n'
import { StorageContext, type StorageState } from './storage-context'

type OpenState = { status: 'opening' } | { status: 'ready' } | { status: 'error'; message: string }

/**
 * Opens IndexedDB before rendering the app and asks for persistent storage.
 * If IndexedDB is unavailable the app shows an explanation instead of failing silently.
 */
export function StorageProvider({ children }: { children: ReactNode }) {
  const [openState, setOpenState] = useState<OpenState>({ status: 'opening' })
  const [persistence, setPersistence] = useState<PersistenceStatus | 'checking'>('checking')

  useEffect(() => {
    let cancelled = false
    db.open()
      .then(() => {
        if (!cancelled) setOpenState({ status: 'ready' })
        // Bring recurring bills' scheduled payments up to date (idempotent; never creates transactions).
        // Loaded on demand so the scheduling code stays out of the initial bundle.
        import('@/db/repositories')
          .then(({ scheduledPaymentsRepository }) => scheduledPaymentsRepository.generateMissing(todayISO(), { now: new Date().toISOString(), newId }))
          .catch(() => {
            // Not fatal: the Recurring page runs generation again when opened.
          })
      })
      .catch((error: unknown) => {
        if (!cancelled) setOpenState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      })
    requestPersistentStorage()
      .then((status) => {
        if (!cancelled) setPersistence(status)
      })
      .catch(() => {
        if (!cancelled) setPersistence('unsupported')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const requestPersistence = useCallback(async () => {
    setPersistence(await requestPersistentStorage())
  }, [])

  const value = useMemo<StorageState>(() => ({ persistence, requestPersistence }), [persistence, requestPersistence])

  if (openState.status === 'opening') {
    return (
      <div className="flex min-h-svh items-center justify-center text-muted-foreground" role="status">
        {t('storage.opening')}
      </div>
    )
  }

  if (openState.status === 'error') {
    return (
      <div className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-3 p-6" role="alert">
        <h1 className="text-lg font-semibold">{t('storage.error.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('storage.error.hint')}</p>
        <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{openState.message}</pre>
      </div>
    )
  }

  return <StorageContext value={value}>{children}</StorageContext>
}
