import type { Account, CardStatement, Debt, ID, ISODate, PrincipalAdjustment } from '@/domain/entities'
import {
  addPrincipalAdjustment,
  buildDebt,
  debtScheduleSource,
  isRevolving,
  statementExpectedAmount,
  validateStatement,
  type AdjustmentIssue,
  type DebtDraft,
  type DebtIssue,
  type StatementIssue,
} from '@/domain/debts'
import { negate, ZERO, type Satang } from '@/domain/money'
import { planMissingOccurrences, planRuleChange, unpaidToRemove } from '@/domain/scheduling'
import type { FinanceDatabase } from '../dexie'
import { rethrowStorage } from '../errors'
import { occurrenceRecords } from './recurring-obligations'

export type DebtWriteIssue = DebtIssue | AdjustmentIssue | StatementIssue | 'statement_exists' | 'statement_paid' | 'card_name_required'

/** Domain validation failed; nothing was written. */
export class DebtValidationError extends Error {
  readonly issues: DebtWriteIssue[]
  constructor(issues: DebtWriteIssue[]) {
    super(`Invalid debt: ${issues.join(', ')}`)
    this.name = 'DebtValidationError'
    this.issues = issues
  }
}

export class DebtNotFoundError extends Error {
  constructor(id: ID) {
    super(`Debt ${id} not found`)
    this.name = 'DebtNotFoundError'
  }
}

export interface DebtMeta {
  now: string
  today: ISODate
  /** Ids for generated scheduled payments. */
  newId: () => ID
}

/** A credit-card account created together with its debt (one atomic write). */
export interface NewCardAccount {
  id: ID
  name: string
  /** What is owed on the card today (stored as the account's negative opening balance). */
  owedSatang?: Satang
}

const KNOWN = [DebtValidationError, DebtNotFoundError]

/**
 * Debts (the master records). Every write keeps the debt's own scheduled
 * payments (loan installments, card statements) in line in the same
 * IndexedDB transaction. Transactions — the payment history — are never
 * modified here: archiving hides a debt, it never deletes what was paid.
 */
export function createDebtsRepository(database: FinanceDatabase) {
  const tables = [database.debts, database.scheduledPayments, database.accounts, database.recurringObligations, database.transactions]

  async function write<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await database.transaction('rw', tables, work)
    } catch (error) {
      return rethrowStorage(error, KNOWN)
    }
  }

  async function mustGet(id: ID): Promise<Debt> {
    const debt = await database.debts.get(id)
    if (!debt || debt.archivedAt) throw new DebtNotFoundError(id)
    return debt
  }

  async function context(debtId: ID) {
    const [accounts, debts, obligations, transactions] = await Promise.all([
      database.accounts.toArray(),
      database.debts.toArray(),
      database.recurringObligations.toArray(),
      database.transactions.where('debtId').equals(debtId).toArray(),
    ])
    return { accounts: new Map(accounts.map((a) => [a.id, a])), debts, obligations, transactions }
  }

  const paymentsOf = (id: ID) => database.scheduledPayments.where('[sourceType+sourceId]').equals(['debt', id]).toArray()

  /** Bring a loan's installment occurrences in line with its (possibly changed) schedule. Card statements are left alone. */
  async function syncSchedule(debt: Debt, meta: DebtMeta, previousAmount?: Satang) {
    if (isRevolving(debt)) return
    const existing = await paymentsOf(debt.id)
    const source = debtScheduleSource(debt)
    if (!source) {
      await database.scheduledPayments.bulkDelete(unpaidToRemove(existing, meta.today, 'future'))
      return
    }
    const plan = planRuleChange(source, existing, meta.today, previousAmount)
    await database.scheduledPayments.bulkDelete(plan.remove)
    for (const change of plan.update) {
      await database.scheduledPayments.update(change.id, { expectedAmountSatang: change.expectedAmountSatang, updatedAt: meta.now })
    }
    await database.scheduledPayments.bulkAdd(occurrenceRecords(debt.id, plan.create, meta, 'debt'))
  }

  return {
    /** Every debt, including archived (history still references them). */
    listAll(): Promise<Debt[]> {
      return database.debts.toArray()
    },

    get(id: ID): Promise<Debt | undefined> {
      return database.debts.get(id)
    },

    /**
     * Validate and store a new debt (optionally with a new credit-card account)
     * and create its installment occurrences. Idempotent on `meta.id`.
     */
    create(draft: DebtDraft, meta: DebtMeta & { id: ID; newCard?: NewCardAccount }): Promise<Debt> {
      return write(async () => {
        const stored = await database.debts.get(meta.id)
        if (stored) return stored

        let linkedAccountId = draft.linkedAccountId
        if (meta.newCard && isRevolving(draft)) {
          const name = meta.newCard.name.trim()
          if (!name) throw new DebtValidationError(['card_name_required'])
          if (!(await database.accounts.get(meta.newCard.id))) {
            const last = await database.accounts.orderBy('sortOrder').last()
            const account: Account = {
              id: meta.newCard.id,
              name,
              kind: 'credit_card',
              currency: 'THB',
              // Liabilities are negative balances: owing ฿X opens at −X.
              openingBalanceSatang: negate(meta.newCard.owedSatang ?? ZERO),
              openingDate: meta.today,
              sortOrder: (last?.sortOrder ?? -1) + 1,
              createdAt: meta.now,
              updatedAt: meta.now,
            }
            await database.accounts.add(account)
          }
          linkedAccountId = meta.newCard.id
        }

        const result = buildDebt({ ...draft, linkedAccountId }, await context(meta.id), meta)
        if (!result.ok) throw new DebtValidationError(result.issues)
        await database.debts.add(result.debt)
        // Like a new recurring obligation: this month's installment is created even if its day has passed.
        const source = debtScheduleSource(result.debt)
        if (source) await database.scheduledPayments.bulkAdd(occurrenceRecords(meta.id, planMissingOccurrences(source, [], meta.today), meta, 'debt'))
        return result.debt
      })
    },

    /**
     * Edit the master record. Future unpaid installments follow the new
     * schedule; paid, skipped and overdue occurrences and all payments stay.
     * Rejected if the new opening balance/date would make recorded principal
     * repayments exceed the principal.
     */
    update(id: ID, draft: DebtDraft, meta: DebtMeta): Promise<Debt> {
      return write(async () => {
        const existing = await mustGet(id)
        const result = buildDebt(draft, await context(id), { id, now: meta.now, today: meta.today, existing })
        if (!result.ok) throw new DebtValidationError(result.issues)
        await database.debts.put(result.debt)
        await syncSchedule(result.debt, meta, existing.scheduleEnabled ? existing.installmentSatang : undefined)
        return result.debt
      })
    },

    /** Stop generating installments; future unpaid ones are removed, history stays. */
    pauseSchedule(id: ID, meta: DebtMeta): Promise<Debt> {
      return write(async () => {
        const existing = await mustGet(id)
        if (existing.schedulePausedAt || !existing.scheduleEnabled) return existing
        const paused: Debt = { ...existing, schedulePausedAt: meta.now, updatedAt: meta.now }
        await database.debts.put(paused)
        await syncSchedule(paused, meta)
        return paused
      })
    },

    /** Generate again from today on (the paused period is not back-filled). */
    resumeSchedule(id: ID, meta: DebtMeta): Promise<Debt> {
      return write(async () => {
        const existing = await mustGet(id)
        if (!existing.schedulePausedAt) return existing
        const resumed: Debt = { ...existing, scheduleFrom: meta.today, updatedAt: meta.now }
        delete resumed.schedulePausedAt
        await database.debts.put(resumed)
        const source = debtScheduleSource(resumed)
        if (source) await database.scheduledPayments.bulkAdd(occurrenceRecords(id, planMissingOccurrences(source, await paymentsOf(id), meta.today), meta, 'debt'))
        return resumed
      })
    },

    /**
     * Archive: hidden from lists and totals. Unpaid occurrences (installments
     * and statements) are removed; payments, paid occurrences and receipts are kept.
     */
    archive(id: ID, meta: Pick<DebtMeta, 'now' | 'today'>): Promise<{ removedUnpaid: number }> {
      return write(async () => {
        const existing = await mustGet(id)
        await database.debts.put({ ...existing, archivedAt: meta.now, updatedAt: meta.now })
        const remove = unpaidToRemove(await paymentsOf(id), meta.today, 'all')
        await database.scheduledPayments.bulkDelete(remove)
        return { removedUnpaid: remove.length }
      })
    },

    /** Loans: a dated principal increase (e.g. a top-up) or correction. Not a payment. Idempotent on `meta.id`. */
    addAdjustment(id: ID, adjustment: Pick<PrincipalAdjustment, 'date' | 'amountSatang' | 'note'>, meta: { id: ID; now: string }): Promise<Debt> {
      return write(async () => {
        const existing = await mustGet(id)
        if (existing.principalAdjustments?.some((a) => a.id === meta.id)) return existing
        const { transactions } = await context(id)
        const result = addPrincipalAdjustment(existing, { ...adjustment, id: meta.id }, transactions, meta.now)
        if (!result.ok) throw new DebtValidationError(result.issues)
        await database.debts.put(result.debt)
        return result.debt
      })
    },

    /**
     * Cards: store a statement exactly as the user entered it and create one
     * unpaid occurrence due on its due date (minimum due if printed, else the
     * statement balance). The live card balance is never replaced by it.
     * Idempotent on `meta.id`.
     */
    addStatement(id: ID, statement: Pick<CardStatement, 'statementDate' | 'balanceSatang' | 'minimumDueSatang' | 'dueDate'>, meta: DebtMeta & { id: ID }): Promise<Debt> {
      return write(async () => {
        const existing = await mustGet(id)
        if (existing.statements?.some((s) => s.id === meta.id)) return existing
        const { obligations } = await context(id)
        const issues = validateStatement(existing, statement, obligations)
        if (issues.length > 0) throw new DebtValidationError(issues)
        if ((await paymentsOf(id)).some((p) => p.dueDate === statement.dueDate)) throw new DebtValidationError(['statement_exists'])

        const stored: CardStatement = { ...statement, id: meta.id, createdAt: meta.now }
        if (stored.minimumDueSatang === undefined) delete stored.minimumDueSatang
        const next: Debt = { ...existing, statements: [...(existing.statements ?? []), stored], updatedAt: meta.now }
        await database.debts.put(next)
        await database.scheduledPayments.bulkAdd(
          occurrenceRecords(id, [{ dueDate: statement.dueDate, expectedAmountSatang: statementExpectedAmount(statement) }], meta, 'debt'),
        )
        return next
      })
    },

    /** Remove a statement entered by mistake, with its occurrence if still unpaid. A paid statement stays (it is history). */
    removeStatement(id: ID, statementId: ID, meta: { now: string }): Promise<Debt> {
      return write(async () => {
        const existing = await mustGet(id)
        const statement = existing.statements?.find((s) => s.id === statementId)
        if (!statement) return existing
        const occurrence = (await paymentsOf(id)).find((p) => p.dueDate === statement.dueDate)
        if (occurrence?.status === 'paid') throw new DebtValidationError(['statement_paid'])
        if (occurrence) await database.scheduledPayments.delete(occurrence.id)
        const next: Debt = { ...existing, statements: (existing.statements ?? []).filter((s) => s.id !== statementId), updatedAt: meta.now }
        await database.debts.put(next)
        return next
      })
    },
  }
}
