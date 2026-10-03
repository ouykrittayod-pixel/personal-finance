/**
 * Natural identities → deterministic ids (see lib/ids/deterministic).
 *
 * - Scheduled occurrence: sourceType + sourceId + dueDate (already unique in the
 *   database). Every device generating "rent, 2026-10-06" makes the same id.
 * - Starter category: kind + template name. Two devices creating the starter set
 *   before they ever sync create identical records instead of duplicates.
 * - Budget: month + categoryId is unique, but existing random ids are kept; a
 *   later sync merges budgets by that natural key (documented in README).
 */
import { uuidV5 } from '@/lib/ids/deterministic'
import type { CategoryKind, ID, ISODate, ScheduledPaymentSource } from './entities'

export const occurrenceId = (sourceType: ScheduledPaymentSource, sourceId: ID, dueDate: ISODate): ID =>
  uuidV5(`occurrence:${sourceType}:${sourceId}:${dueDate}`)

export const starterCategoryId = (kind: CategoryKind, name: string): ID => uuidV5(`starter-category:${kind}:${name}`)

/** Old id → deterministic id for occurrences whose id is not yet deterministic (migration / restore of older data). */
export function planOccurrenceIdMigration(payments: readonly { id: ID; sourceType: ScheduledPaymentSource; sourceId: ID; dueDate: ISODate }[]): Map<ID, ID> {
  const renames = new Map<ID, ID>()
  for (const p of payments) {
    const next = occurrenceId(p.sourceType, p.sourceId, p.dueDate)
    if (next !== p.id) renames.set(p.id, next)
  }
  return renames
}
