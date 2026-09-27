import type { ID, ISODate, RecurringObligation, ScheduledPayment } from '@/domain/entities'
import {
  buildObligation,
  planMissingOccurrences,
  planRuleChange,
  unpaidToRemove,
  type NewOccurrence,
  type ObligationDraft,
  type ObligationIssue,
} from '@/domain/scheduling'
import type { FinanceDatabase } from '../dexie'
import { rethrowStorage } from '../errors'

export class ObligationValidationError extends Error {
  readonly issues: ObligationIssue[]
  constructor(issues: ObligationIssue[]) {
    super(`Invalid recurring obligation: ${issues.join(', ')}`)
    this.name = 'ObligationValidationError'
    this.issues = issues
  }
}

export class ObligationNotFoundError extends Error {
  constructor(id: ID) {
    super(`Recurring obligation ${id} not found`)
    this.name = 'ObligationNotFoundError'
  }
}

export interface ObligationMeta {
  now: string
  today: ISODate
  newId: () => ID
}

const KNOWN = [ObligationValidationError, ObligationNotFoundError]

/** Scheduled-payment records for new occurrences of an obligation. */
export function occurrenceRecords(
  sourceId: ID,
  occurrences: readonly NewOccurrence[],
  meta: Pick<ObligationMeta, 'now' | 'newId'>,
  sourceType: ScheduledPayment['sourceType'] = 'obligation',
): ScheduledPayment[] {
  return occurrences.map((occurrence) => ({
    id: meta.newId(),
    sourceType,
    sourceId,
    dueDate: occurrence.dueDate,
    expectedAmountSatang: occurrence.expectedAmountSatang,
    status: 'pending',
    createdAt: meta.now,
    updatedAt: meta.now,
  }))
}

/**
 * Recurring obligations (the rules). Every write also brings the rule's
 * scheduled payments in line — in the same IndexedDB transaction — so rules
 * and occurrences can never disagree. Paid and skipped occurrences (history)
 * and transactions are never modified here.
 */
export function createRecurringObligationsRepository(database: FinanceDatabase) {
  const tables = [database.recurringObligations, database.scheduledPayments, database.accounts, database.categories, database.debts]

  async function context() {
    const [accounts, categories, debts] = await Promise.all([database.accounts.toArray(), database.categories.toArray(), database.debts.toArray()])
    return {
      accounts: new Map(accounts.map((a) => [a.id, a])),
      categories: new Map(categories.filter((c) => !c.archivedAt).map((c) => [c.id, c])),
      debts: new Map(debts.map((d) => [d.id, d])),
    }
  }

  const paymentsOf = (id: ID) => database.scheduledPayments.where('[sourceType+sourceId]').equals(['obligation', id]).toArray()

  async function mustGet(id: ID): Promise<RecurringObligation> {
    const obligation = await database.recurringObligations.get(id)
    if (!obligation || obligation.archivedAt) throw new ObligationNotFoundError(id)
    return obligation
  }

  async function write<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await database.transaction('rw', tables, work)
    } catch (error) {
      return rethrowStorage(error, KNOWN)
    }
  }

  return {
    /** Every obligation, including paused and deleted (history needs their names). */
    listAll(): Promise<RecurringObligation[]> {
      return database.recurringObligations.toArray()
    },

    get(id: ID): Promise<RecurringObligation | undefined> {
      return database.recurringObligations.get(id)
    },

    /** Validate, store, and create its scheduled payments (this month → horizon). Idempotent on `meta.id`. */
    create(draft: ObligationDraft, meta: ObligationMeta & { id: ID }): Promise<RecurringObligation> {
      return write(async () => {
        const stored = await database.recurringObligations.get(meta.id)
        if (stored) return stored
        const result = buildObligation(draft, await context(), { id: meta.id, now: meta.now, today: meta.today })
        if (!result.ok) throw new ObligationValidationError(result.issues)
        await database.recurringObligations.add(result.obligation)
        await database.scheduledPayments.bulkAdd(occurrenceRecords(meta.id, planMissingOccurrences(result.obligation, [], meta.today), meta))
        return result.obligation
      })
    },

    /**
     * Edit the rule. Future unpaid occurrences follow the new rule (amount,
     * dates); paid, skipped and past occurrences are history and stay as they were.
     */
    update(id: ID, draft: ObligationDraft, meta: ObligationMeta): Promise<RecurringObligation> {
      return write(async () => {
        const existing = await mustGet(id)
        const result = buildObligation(draft, await context(), { id, now: meta.now, today: meta.today, existing })
        if (!result.ok) throw new ObligationValidationError(result.issues)
        await database.recurringObligations.put(result.obligation)

        const plan = planRuleChange(result.obligation, await paymentsOf(id), meta.today)
        await database.scheduledPayments.bulkDelete(plan.remove)
        for (const change of plan.update) {
          await database.scheduledPayments.update(change.id, { expectedAmountSatang: change.expectedAmountSatang, updatedAt: meta.now })
        }
        await database.scheduledPayments.bulkAdd(occurrenceRecords(id, plan.create, meta))
        return result.obligation
      })
    },

    /** Stop generating. Future unpaid occurrences are removed; overdue, paid and skipped stay. */
    pause(id: ID, meta: ObligationMeta): Promise<RecurringObligation> {
      return write(async () => {
        const existing = await mustGet(id)
        if (existing.pausedAt) return existing
        const paused = { ...existing, pausedAt: meta.now, updatedAt: meta.now }
        await database.recurringObligations.put(paused)
        await database.scheduledPayments.bulkDelete(unpaidToRemove(await paymentsOf(id), meta.today, 'future'))
        return paused
      })
    },

    /** Generate again from today on — the paused period is not back-filled; existing occurrences are kept. */
    resume(id: ID, meta: ObligationMeta): Promise<RecurringObligation> {
      return write(async () => {
        const existing = await mustGet(id)
        if (!existing.pausedAt) return existing
        const resumed: RecurringObligation = { ...existing, scheduleFrom: meta.today, updatedAt: meta.now }
        delete resumed.pausedAt
        await database.recurringObligations.put(resumed)
        await database.scheduledPayments.bulkAdd(occurrenceRecords(id, planMissingOccurrences(resumed, await paymentsOf(id), meta.today), meta))
        return resumed
      })
    },

    /**
     * Delete the rule (kept as an archived record so history keeps its name).
     * All its unpaid occurrences are removed; paid and skipped occurrences,
     * their transactions and attachments are kept.
     */
    archive(id: ID, meta: Pick<ObligationMeta, 'now' | 'today'>): Promise<{ removedUnpaid: number }> {
      return write(async () => {
        const existing = await mustGet(id)
        await database.recurringObligations.put({ ...existing, archivedAt: meta.now, updatedAt: meta.now })
        const remove = unpaidToRemove(await paymentsOf(id), meta.today, 'all')
        await database.scheduledPayments.bulkDelete(remove)
        return { removedUnpaid: remove.length }
      })
    },
  }
}
