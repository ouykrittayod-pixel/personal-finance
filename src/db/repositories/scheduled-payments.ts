import Dexie from 'dexie'
import type { ID, ISODate, ScheduledPayment, Transaction } from '@/domain/entities'
import { debtScheduleSource } from '@/domain/debts'
import { isObligationActive, paymentTypeFor, planMissingOccurrences } from '@/domain/scheduling'
import type { TransactionDraft } from '@/domain/transactions'
import type { FinanceDatabase } from '../dexie'
import { rethrowStorage } from '../errors'
import { occurrenceRecords } from './recurring-obligations'
import { createTransactionsRepository, ExpenseValidationError, type NewAttachment } from './transactions'

export class ScheduledPaymentNotFoundError extends Error {
  constructor(id: ID) {
    super(`Scheduled payment ${id} not found`)
    this.name = 'ScheduledPaymentNotFoundError'
  }
}

/** The occurrence was already paid (by another transaction) or skipped. */
export class PaymentAlreadySettledError extends Error {
  readonly status: 'paid' | 'skipped'
  constructor(status: 'paid' | 'skipped') {
    super(`Scheduled payment already ${status}`)
    this.name = 'PaymentAlreadySettledError'
    this.status = status
  }
}

const KNOWN = [ScheduledPaymentNotFoundError, PaymentAlreadySettledError, ExpenseValidationError]

/** Re-exported: the rule lives in domain/scheduling. */
export { paymentTypeFor }

export interface MarkPaidMeta {
  /** Transaction id, fixed per payment dialog: a repeated confirm can never create a second transaction. */
  transactionId: ID
  now: string
  newId: () => ID
}

export type MarkPaidResult = { status: 'paid' | 'already_paid'; payment: ScheduledPayment; transaction: Transaction }

export function createScheduledPaymentsRepository(database: FinanceDatabase) {
  const transactions = createTransactionsRepository(database)
  const payTables = [
    database.scheduledPayments,
    database.recurringObligations,
    database.transactions,
    database.attachments,
    database.attachmentBlobs,
    database.accounts,
    database.categories,
    database.debts,
  ]

  async function mustGet(id: ID): Promise<ScheduledPayment> {
    const payment = await database.scheduledPayments.get(id)
    if (!payment) throw new ScheduledPaymentNotFoundError(id)
    return payment
  }

  return {
    get(id: ID): Promise<ScheduledPayment | undefined> {
      return database.scheduledPayments.get(id)
    },

    /** Unpaid payments due on or before `until` (includes overdue), via the [status+dueDate] index. */
    listPendingDueBy(until: ISODate): Promise<ScheduledPayment[]> {
      return database.scheduledPayments.where('[status+dueDate]').between(['pending', Dexie.minKey], ['pending', until], true, true).toArray()
    },

    /** Every occurrence of one obligation or debt. */
    listForSource(sourceType: ScheduledPayment['sourceType'], sourceId: ID): Promise<ScheduledPayment[]> {
      return database.scheduledPayments.where('[sourceType+sourceId]').equals([sourceType, sourceId]).toArray()
    },

    /** Occurrences due in a date range, any status — the query a calendar needs. */
    listBetween(start: ISODate, end: ISODate): Promise<ScheduledPayment[]> {
      return database.scheduledPayments.where('dueDate').between(start, end, true, true).toArray()
    },

    listAll(): Promise<ScheduledPayment[]> {
      return database.scheduledPayments.toArray()
    },

    /**
     * Create occurrences that should exist (this month → horizon) for every
     * active obligation and every loan with its own installment schedule. Safe to run on every app start and in several tabs:
     * the plan skips existing dates, IndexedDB serialises read-write
     * transactions, and the unique [sourceType+sourceId+dueDate] index rejects
     * any duplicate. Returns how many were created.
     */
    async generateMissing(today: ISODate, meta: { now: string; newId: () => ID }): Promise<number> {
      try {
        return await database.transaction('rw', [database.recurringObligations, database.debts, database.scheduledPayments], async () => {
          let created = 0
          for (const obligation of await database.recurringObligations.toArray()) {
            if (!isObligationActive(obligation)) continue
            const existing = await database.scheduledPayments.where('[sourceType+sourceId]').equals(['obligation', obligation.id]).toArray()
            const records = occurrenceRecords(obligation.id, planMissingOccurrences(obligation, existing, today), meta)
            await database.scheduledPayments.bulkAdd(records)
            created += records.length
          }
          for (const debt of await database.debts.toArray()) {
            const source = debtScheduleSource(debt)
            if (!source || !isObligationActive(source)) continue
            const existing = await database.scheduledPayments.where('[sourceType+sourceId]').equals(['debt', debt.id]).toArray()
            const records = occurrenceRecords(debt.id, planMissingOccurrences(source, existing, today), meta, 'debt')
            await database.scheduledPayments.bulkAdd(records)
            created += records.length
          }
          return created
        })
      } catch (error) {
        return rethrowStorage(error, KNOWN)
      }
    },

    /**
     * Pay an occurrence: create the real transaction (with the actual date,
     * amount, account and any receipts), link it, and mark the occurrence paid
     * — all in one IndexedDB transaction. Refuses an occurrence that is
     * already paid or skipped; a repeat of the same confirmation returns the
     * existing result instead of creating anything.
     */
    async markPaid(paymentId: ID, draft: TransactionDraft, attachments: readonly NewAttachment[], meta: MarkPaidMeta): Promise<MarkPaidResult> {
      try {
        return await database.transaction('rw', payTables, async (): Promise<MarkPaidResult> => {
          const payment = await mustGet(paymentId)
          if (payment.status === 'paid') {
            const linked = payment.transactionId ? await database.transactions.get(payment.transactionId) : undefined
            if (payment.transactionId === meta.transactionId && linked) return { status: 'already_paid', payment, transaction: linked }
            throw new PaymentAlreadySettledError('paid')
          }
          if (payment.status === 'skipped') throw new PaymentAlreadySettledError('skipped')

          const obligation = payment.sourceType === 'obligation' ? await database.recurringObligations.get(payment.sourceId) : undefined
          const { type, debtId } = paymentTypeFor(payment, obligation)
          const { transaction } = await transactions.create(
            {
              ...draft,
              type,
              ...(debtId ? { debtId, categoryId: undefined } : { debtId: undefined }),
              scheduledPaymentId: payment.id,
            },
            attachments,
            { id: meta.transactionId, now: meta.now, newId: meta.newId },
          )

          const paid: ScheduledPayment = { ...payment, status: 'paid', transactionId: transaction.id, paidDate: transaction.date, updatedAt: meta.now }
          await database.scheduledPayments.put(paid)
          return { status: 'paid', payment: paid, transaction }
        })
      } catch (error) {
        return rethrowStorage(error, KNOWN)
      }
    },

    /** Skip an unpaid occurrence: no transaction; the rule continues. */
    async markSkipped(paymentId: ID, meta: { now: string }): Promise<ScheduledPayment> {
      try {
        return await database.transaction('rw', database.scheduledPayments, async () => {
          const payment = await mustGet(paymentId)
          if (payment.status === 'skipped') return payment
          if (payment.status === 'paid') throw new PaymentAlreadySettledError('paid')
          const skipped: ScheduledPayment = { ...payment, status: 'skipped', updatedAt: meta.now }
          await database.scheduledPayments.put(skipped)
          return skipped
        })
      } catch (error) {
        return rethrowStorage(error, KNOWN)
      }
    },

    /** Undo a skip (back to unpaid). Paid occurrences are undone by deleting their transaction instead. */
    async markUnskipped(paymentId: ID, meta: { now: string }): Promise<ScheduledPayment> {
      try {
        return await database.transaction('rw', database.scheduledPayments, async () => {
          const payment = await mustGet(paymentId)
          if (payment.status !== 'skipped') return payment
          const unpaid: ScheduledPayment = { ...payment, status: 'pending', updatedAt: meta.now }
          await database.scheduledPayments.put(unpaid)
          return unpaid
        })
      } catch (error) {
        return rethrowStorage(error, KNOWN)
      }
    },
  }
}
