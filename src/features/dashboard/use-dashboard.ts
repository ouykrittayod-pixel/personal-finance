import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { buildDashboardModel, loadDashboardData, type DashboardModel, type DashboardPeriod, type DashboardRawData } from './dashboard-data'

export type DashboardState =
  | { status: 'loading' }
  | { status: 'error'; error: Error; retry: () => void }
  | { status: 'ready'; model: DashboardModel }

type LoadResult = { ok: true; model: DashboardModel } | { ok: false; error: Error }

/**
 * Live dashboard model: re-computes whenever any queried table changes
 * (Dexie liveQuery), so new entries appear without a reload.
 */
export function useDashboard(
  period: DashboardPeriod,
  load: (period: DashboardPeriod) => Promise<DashboardRawData> = loadDashboardData,
): DashboardState {
  const [attempt, setAttempt] = useState(0)

  const result = useLiveQuery<LoadResult>(
    async () => {
      try {
        const raw = await load(period)
        return { ok: true, model: buildDashboardModel(raw, period) }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error : new Error(String(error)) }
      }
    },
    [period.month, period.today, load, attempt],
  )

  if (!result) return { status: 'loading' }
  if (!result.ok) return { status: 'error', error: result.error, retry: () => setAttempt((n) => n + 1) }
  return { status: 'ready', model: result.model }
}
