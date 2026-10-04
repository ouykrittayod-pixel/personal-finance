/**
 * Record schemas for backup format v1 — the exact stored shape of each entity
 * (domain/entities.ts). Strict: an unknown field is rejected, never dropped,
 * so a restore can neither lose data nor import something unexpected.
 */
import { z } from 'zod'
import { ACCOUNT_KINDS, DEBT_KINDS, TRANSACTION_TYPES } from '@/domain/entities'
import { RECURRENCE_FREQUENCIES } from '@/domain/recurrence'
import { isISODate, isYearMonth } from '@/lib/dates'

/** Integer satang (may be negative: liabilities, adjustments). Rejects 1.5, "27500", NaN, Infinity. */
const money = z.number().int().refine(Number.isSafeInteger, 'unsafe_integer')
const id = z.string().min(1).max(200)
const text = z.string()
const date = z.string().refine(isISODate, 'invalid_date')
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/
const timestamp = z.string().refine((value) => TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value)), 'invalid_timestamp')
const dayOfMonth = z.number().int().min(1).max(31)
const count = z.number().int().nonnegative()

export const accountSchema = z.strictObject({
  id,
  name: text,
  kind: z.enum(ACCOUNT_KINDS),
  currency: z.literal('THB'),
  openingBalanceSatang: money,
  openingDate: date,
  creditLimitSatang: money.optional(),
  statementDay: dayOfMonth.optional(),
  paymentDueDay: dayOfMonth.optional(),
  sortOrder: z.number().finite(),
  archivedAt: timestamp.optional(),
  note: text.optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
})

export const categorySchema = z.strictObject({
  id,
  kind: z.enum(['expense', 'income']),
  name: text,
  parentId: id.optional(),
  icon: text.optional(),
  color: text.optional(),
  sortOrder: z.number().finite(),
  archivedAt: timestamp.optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
})

export const transactionSchema = z
  .strictObject({
    id,
    type: z.enum(TRANSACTION_TYPES),
    date,
    amountSatang: money,
    accountId: id,
    toAccountId: id.optional(),
    categoryId: id.optional(),
    debtId: id.optional(),
    principalSatang: money.optional(),
    interestSatang: money.optional(),
    feeSatang: money.optional(),
    scheduledPaymentId: id.optional(),
    description: text.optional(),
    payee: text.optional(),
    note: text.optional(),
    tags: z.array(text).optional(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .refine((tx) => (tx.type === 'adjustment' ? tx.amountSatang !== 0 : tx.amountSatang > 0), { message: 'invalid_amount', path: ['amountSatang'] })
  .refine((tx) => tx.type !== 'transfer' || tx.toAccountId !== undefined, { message: 'transfer_requires_to_account', path: ['toAccountId'] })
  .refine((tx) => tx.type !== 'debt_payment' || tx.debtId !== undefined, { message: 'debt_payment_requires_debt', path: ['debtId'] })

const recurrenceSchema = z.strictObject({
  frequency: z.enum(RECURRENCE_FREQUENCIES as [string, ...string[]]),
  interval: z.number().int().positive(),
  startDate: date,
  endDate: date.optional(),
  dayOfMonth: dayOfMonth.optional(),
  monthOfYear: z.number().int().min(1).max(12).optional(),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  count: z.number().int().positive().optional(),
})

export const recurringObligationSchema = z.strictObject({
  id,
  name: text,
  expectedAmountSatang: money,
  variableAmount: z.boolean(),
  recurrence: recurrenceSchema,
  defaultAccountId: id.optional(),
  categoryId: id.optional(),
  reminderDaysBefore: count.optional(),
  debtId: id.optional(),
  kind: z.enum(['income', 'transfer']).optional(),
  toAccountId: id.optional(),
  scheduleFrom: date.optional(),
  pausedAt: timestamp.optional(),
  archivedAt: timestamp.optional(),
  note: text.optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
})

export const scheduledPaymentSchema = z.strictObject({
  id,
  sourceType: z.enum(['obligation', 'debt']),
  sourceId: id,
  dueDate: date,
  expectedAmountSatang: money,
  status: z.enum(['pending', 'paid', 'skipped']),
  transactionId: id.optional(),
  paidDate: date.optional(),
  note: text.optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
})

const principalAdjustmentSchema = z.strictObject({ id, date, amountSatang: money, note: text.optional(), createdAt: timestamp })
const cardStatementSchema = z.strictObject({
  id,
  statementDate: date,
  balanceSatang: money,
  minimumDueSatang: money.optional(),
  dueDate: date,
  createdAt: timestamp,
})

export const debtSchema = z.strictObject({
  id,
  name: text,
  kind: z.enum(DEBT_KINDS),
  lender: text.optional(),
  principalSatang: money.optional(),
  openingBalanceSatang: money,
  openingDate: date,
  interestMethod: z.enum(['none', 'flat', 'reducing_balance', 'unknown']),
  annualInterestRateBps: z.number().int().nonnegative().optional(),
  termMonths: z.number().int().positive().optional(),
  installmentSatang: money.optional(),
  dueDay: dayOfMonth.optional(),
  startDate: date.optional(),
  maturityDate: date.optional(),
  linkedAccountId: id.optional(),
  scheduleEnabled: z.boolean().optional(),
  scheduleFrom: date.optional(),
  schedulePausedAt: timestamp.optional(),
  principalAdjustments: z.array(principalAdjustmentSchema).optional(),
  statements: z.array(cardStatementSchema).optional(),
  archivedAt: timestamp.optional(),
  status: z.enum(['active', 'paid_off', 'closed']),
  note: text.optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
})

export const budgetSchema = z.strictObject({
  id,
  month: z.string().refine((value) => isYearMonth(value), 'invalid_month'),
  categoryId: id,
  limitSatang: money,
  note: text.optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
})

export const attachmentSchema = z.strictObject({
  id,
  transactionId: id.optional(),
  fileName: text,
  mimeType: text,
  sizeBytes: count,
  width: count.optional(),
  height: count.optional(),
  createdAt: timestamp,
})

export const encodedBlobSchema = z.strictObject({ id, type: text, base64: z.string() })

export const RECORD_SCHEMAS = {
  accounts: accountSchema,
  categories: categorySchema,
  debts: debtSchema,
  recurringObligations: recurringObligationSchema,
  scheduledPayments: scheduledPaymentSchema,
  transactions: transactionSchema,
  budgets: budgetSchema,
  attachments: attachmentSchema,
  attachmentBlobs: encodedBlobSchema,
} as const

export const headerSchema = z.object({
  format: z.string(),
  formatVersion: z.number(),
  appVersion: z.string(),
  schemaVersion: z.number().int().positive(),
  exportedAt: timestamp,
  currency: z.string(),
  calendar: z.string(),
  data: z.record(z.string(), z.unknown()),
})
