/**
 * The write operations the Debts UI performs — thin wrappers over the
 * repositories that supply today / now / ids. Injectable for tests.
 */
import { debtsRepository, scheduledPaymentsRepository, transactionsRepository, type NewAttachment, type NewCardAccount } from '@/db/repositories'
import type { DebtDraft } from '@/domain/debts'
import type { CardStatement, ID, PrincipalAdjustment } from '@/domain/entities'
import type { TransactionDraft } from '@/domain/transactions'
import { todayISO } from '@/lib/dates'
import { newId } from '@/lib/ids'

const stamp = () => ({ now: new Date().toISOString(), today: todayISO(), newId })

export interface DebtsOps {
  generate: () => Promise<number>
  create: (draft: DebtDraft, id: ID, newCard?: NewCardAccount) => Promise<unknown>
  update: (id: ID, draft: DebtDraft) => Promise<unknown>
  pauseSchedule: (id: ID) => Promise<unknown>
  resumeSchedule: (id: ID) => Promise<unknown>
  archive: (id: ID) => Promise<unknown>
  /** Pay a scheduled occurrence. `transactionId` is fixed per dialog, so repeated confirms create one transaction. */
  markPaid: (paymentId: ID, draft: TransactionDraft, attachments: readonly NewAttachment[], transactionId: ID) => Promise<unknown>
  /** An unscheduled (extra) repayment. Idempotent on `transactionId`. */
  pay: (draft: TransactionDraft, attachments: readonly NewAttachment[], transactionId: ID) => Promise<unknown>
  skip: (paymentId: ID) => Promise<unknown>
  addAdjustment: (id: ID, adjustment: Pick<PrincipalAdjustment, 'date' | 'amountSatang' | 'note'>, adjustmentId: ID) => Promise<unknown>
  addStatement: (id: ID, statement: Pick<CardStatement, 'statementDate' | 'balanceSatang' | 'minimumDueSatang' | 'dueDate'>, statementId: ID) => Promise<unknown>
  removeStatement: (id: ID, statementId: ID) => Promise<unknown>
}

export const defaultDebtsOps: DebtsOps = {
  generate: () => scheduledPaymentsRepository.generateMissing(todayISO(), stamp()),
  create: (draft, id, newCard) => debtsRepository.create(draft, { ...stamp(), id, newCard }),
  update: (id, draft) => debtsRepository.update(id, draft, stamp()),
  pauseSchedule: (id) => debtsRepository.pauseSchedule(id, stamp()),
  resumeSchedule: (id) => debtsRepository.resumeSchedule(id, stamp()),
  archive: (id) => debtsRepository.archive(id, stamp()),
  markPaid: (paymentId, draft, attachments, transactionId) =>
    scheduledPaymentsRepository.markPaid(paymentId, draft, attachments, { transactionId, now: new Date().toISOString(), newId }),
  pay: (draft, attachments, transactionId) => transactionsRepository.create(draft, attachments, { id: transactionId, now: new Date().toISOString(), newId }),
  skip: (paymentId) => scheduledPaymentsRepository.markSkipped(paymentId, { now: new Date().toISOString() }),
  addAdjustment: (id, adjustment, adjustmentId) => debtsRepository.addAdjustment(id, adjustment, { id: adjustmentId, now: new Date().toISOString() }),
  addStatement: (id, statement, statementId) => debtsRepository.addStatement(id, statement, { ...stamp(), id: statementId }),
  removeStatement: (id, statementId) => debtsRepository.removeStatement(id, statementId, { now: new Date().toISOString() }),
}
