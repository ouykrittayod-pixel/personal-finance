/**
 * The write operations the Recurring UI performs — thin wrappers over the
 * repositories that supply today / now / ids. Injectable for tests.
 */
import { recurringObligationsRepository, scheduledPaymentsRepository, type NewAttachment, type OccurrenceRef } from '@/db/repositories'
import type { ID } from '@/domain/entities'
import type { Satang } from '@/domain/money'
import type { ObligationDraft } from '@/domain/scheduling'
import type { TransactionDraft } from '@/domain/transactions'
import { todayISO } from '@/lib/dates'
import { newId } from '@/lib/ids'

const stamp = () => ({ now: new Date().toISOString(), today: todayISO(), newId })

export interface RecurringOps {
  generate: () => Promise<number>
  create: (draft: ObligationDraft, id: ID) => Promise<unknown>
  update: (id: ID, draft: ObligationDraft) => Promise<unknown>
  pause: (id: ID) => Promise<unknown>
  resume: (id: ID) => Promise<unknown>
  archive: (id: ID) => Promise<unknown>
  /** `transactionId` is fixed per payment dialog, so repeated confirms create one transaction. */
  markPaid: (paymentId: ID, draft: TransactionDraft, attachments: readonly NewAttachment[], transactionId: ID) => Promise<unknown>
  skip: (paymentId: ID) => Promise<unknown>
  unskip: (paymentId: ID) => Promise<unknown>
  /** Plan one month's amount (an unpaid occurrence, or a month not generated yet). */
  setAmount: (ref: OccurrenceRef, amountSatang: Satang) => Promise<unknown>
}

export const defaultRecurringOps: RecurringOps = {
  generate: () => scheduledPaymentsRepository.generateMissing(todayISO(), stamp()),
  create: (draft, id) => recurringObligationsRepository.create(draft, { ...stamp(), id }),
  update: (id, draft) => recurringObligationsRepository.update(id, draft, stamp()),
  pause: (id) => recurringObligationsRepository.pause(id, stamp()),
  resume: (id) => recurringObligationsRepository.resume(id, stamp()),
  archive: (id) => recurringObligationsRepository.archive(id, stamp()),
  markPaid: (paymentId, draft, attachments, transactionId) =>
    scheduledPaymentsRepository.markPaid(paymentId, draft, attachments, { transactionId, now: new Date().toISOString(), newId }),
  skip: (paymentId) => scheduledPaymentsRepository.markSkipped(paymentId, { now: new Date().toISOString() }),
  unskip: (paymentId) => scheduledPaymentsRepository.markUnskipped(paymentId, { now: new Date().toISOString() }),
  setAmount: (ref, amountSatang) => scheduledPaymentsRepository.setExpectedAmount(ref, amountSatang, stamp()),
}
