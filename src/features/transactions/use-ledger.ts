import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import type { ISODate } from '@/domain/entities'
import { buildLedger, loadLedgerData, type LedgerFilters, type LedgerModel, type LedgerRawData } from './ledger-data'

export type LedgerState =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; model: LedgerModel }

type LoadResult = { ok: true; raw: LedgerRawData } | { ok: false }

/**
 * Live ledger: raw data is re-read whenever a transaction, account, category,
 * debt or attachment changes (create / edit / delete anywhere in the app);
 * filtering happens in memory, so typing in search never hits the database.
 */
export function useLedger(
  filters: LedgerFilters,
  today: ISODate,
  limit: number,
  load: () => Promise<LedgerRawData> = loadLedgerData,
): LedgerState {
  const [attempt, setAttempt] = useState(0)
  const result = useLiveQuery<LoadResult>(
    () => load().then((raw) => ({ ok: true as const, raw }), () => ({ ok: false as const })),
    [load, attempt],
  )
  const model = useMemo(
    () => (result?.ok ? buildLedger(result.raw, filters, today, limit) : null),
    [result, filters, today, limit],
  )
  if (!result) return { status: 'loading' }
  if (!result.ok || !model) return { status: 'error', retry: () => setAttempt((n) => n + 1) }
  return { status: 'ready', model }
}
