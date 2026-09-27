import type { PreviewRow } from '@/domain/import'

/** Preview filters: by status, plus possible duplicates (any status). */
export const FILTERS = ['all', 'ready', 'warning', 'error', 'duplicate', 'review'] as const
export type PreviewFilter = (typeof FILTERS)[number]

export function filterRows(rows: readonly PreviewRow[], filter: PreviewFilter): PreviewRow[] {
  switch (filter) {
    case 'all':
      return [...rows]
    case 'ready':
      return rows.filter((r) => r.status === 'ready')
    case 'duplicate':
      return rows.filter((r) => r.duplicates.length > 0)
    default:
      return rows.filter((r) => r.status === filter)
  }
}
