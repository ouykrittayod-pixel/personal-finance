/**
 * Persisted domain entities (schema v1).
 *
 * Conventions
 * - `id`: string UUID (see lib/ids).
 * - Money: integer satang (`Satang`), never floats.
 * - Rates: integer basis points (1% = 100 bps).
 * - Calendar dates: `ISODate` "YYYY-MM-DD" (local, Gregorian, no time zone).
 * - Timestamps: `ISODateTime` (UTC ISO-8601 from `Date#toISOString`).
 * - Optional/nullable fields are omitted rather than stored as null, because
 *   IndexedDB does not index null/undefined — omitted keys simply drop out of an index.
 */
import type { BasisPoints, CurrencyCode, Satang } from './money'
import type { RecurrenceRule } from './recurrence'

export type ID = string
/** Local calendar date, "YYYY-MM-DD". */
export type ISODate = string
/** UTC timestamp, "YYYY-MM-DDTHH:mm:ss.sssZ". */
export type ISODateTime = string

export interface Timestamps {
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export const ASSET_ACCOUNT_KINDS = ['cash', 'bank', 'savings', 'e_wallet', 'investment', 'other'] as const
export const LIABILITY_ACCOUNT_KINDS = ['credit_card', 'loan'] as const
export const ACCOUNT_KINDS = [...ASSET_ACCOUNT_KINDS, ...LIABILITY_ACCOUNT_KINDS] as const

export type AssetAccountKind = (typeof ASSET_ACCOUNT_KINDS)[number]
export type LiabilityAccountKind = (typeof LIABILITY_ACCOUNT_KINDS)[number]
export type AccountKind = (typeof ACCOUNT_KINDS)[number]
export type AccountClass = 'asset' | 'liability'

/**
 * A place money is held (asset) or owed (liability).
 *
 * Balance sign convention (applies to every account):
 *   balance = openingBalance + Σ account effects
 *   - assets are normally positive,
 *   - liabilities are normally NEGATIVE (−5,000 = 5,000 baht owed).
 * Net worth is therefore simply the sum of all account balances.
 */
export interface Account extends Timestamps {
  id: ID
  name: string
  kind: AccountKind
  currency: CurrencyCode
  openingBalanceSatang: Satang
  /** Date the opening balance is valid for. */
  openingDate: ISODate
  /** Credit limit for credit cards (positive satang). */
  creditLimitSatang?: Satang
  /** Statement closing day (1–31) for credit cards. */
  statementDay?: number
  /** Payment due day (1–31) for credit cards. */
  paymentDueDay?: number
  sortOrder: number
  archivedAt?: ISODateTime
  note?: string
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export type CategoryKind = 'expense' | 'income'

export interface Category extends Timestamps {
  id: ID
  kind: CategoryKind
  name: string
  parentId?: ID
  icon?: string
  color?: string
  sortOrder: number
  archivedAt?: ISODateTime
}

// ---------------------------------------------------------------------------
// Transactions — see domain/transactions.ts for the rules.
// ---------------------------------------------------------------------------

export const TRANSACTION_TYPES = ['expense', 'income', 'debt_payment', 'transfer', 'adjustment'] as const
export type TransactionType = (typeof TRANSACTION_TYPES)[number]

export interface Transaction extends Timestamps {
  id: ID
  type: TransactionType
  /** Date the transaction happened (not the date it was entered). */
  date: ISODate
  /**
   * Amount in satang.
   * - expense / income / debt_payment / transfer: strictly positive.
   * - adjustment: non-zero signed delta applied to `accountId`.
   */
  amountSatang: Satang
  /** Account money leaves (expense, transfer, debt_payment) or enters (income), or is adjusted. */
  accountId: ID
  /** transfer: destination account. debt_payment: the liability account being paid down, if any. */
  toAccountId?: ID
  /** expense / income only. */
  categoryId?: ID
  /** debt_payment: the Debt being repaid (required). */
  debtId?: ID
  /**
   * debt_payment to a loan: explicit allocation. When `principalSatang` is
   * present, principal + interest + fees = amount. When absent the payment is
   * "unallocated": it never reduces principal. Card payments carry no split.
   */
  principalSatang?: Satang
  interestSatang?: Satang
  feeSatang?: Satang
  /** Set when this transaction settles a ScheduledPayment. */
  scheduledPaymentId?: ID
  /** Short user description, e.g. "ข้าวกลางวัน". Not indexed (added after v1; no migration needed). */
  description?: string
  payee?: string
  note?: string
  tags?: string[]
}

// ---------------------------------------------------------------------------
// Recurring obligations → scheduled payments → transactions
// ---------------------------------------------------------------------------

/** A template for a repeating bill (rent, phone, insurance). It is NOT a transaction. */
export interface RecurringObligation extends Timestamps {
  id: ID
  name: string
  expectedAmountSatang: Satang
  /** Whether the amount varies each period (e.g. electricity). */
  variableAmount: boolean
  recurrence: RecurrenceRule
  /** Account usually used to pay. */
  defaultAccountId?: ID
  categoryId?: ID
  /** Days before due date to remind. */
  reminderDaysBefore?: number
  /**
   * Paying a debt instead of a bill: the scheduled payment becomes a
   * `debt_payment` to this debt (never an expense). Added in the Recurring phase.
   */
  debtId?: ID
  /**
   * Direction of the rule. Absent = money going out (a bill, or a debt payment
   * when `debtId` is set). 'income' = expected money coming in (e.g. salary):
   * receiving an occurrence creates an `income` transaction. Added in the Income
   * phase; optional and unindexed, so no schema migration.
   * 'transfer' = planned money moved to another of the user's accounts (savings,
   * DCA…): paying an occurrence creates a `transfer` to `toAccountId` — never an
   * expense. Added with the monthly plan (data schema 2).
   */
  kind?: 'income' | 'transfer'
  /** kind 'transfer': the account the money goes to. */
  toAccountId?: ID
  /**
   * First date scheduled payments are generated from (never earlier than the
   * rule's start). Set on create and on resume, so pausing never back-fills.
   */
  scheduleFrom?: ISODate
  /** Paused: no new occurrences are generated. */
  pausedAt?: ISODateTime
  /** Deleted by the user: hidden, never generated again; paid history is kept. */
  archivedAt?: ISODateTime
  note?: string
}

export type ScheduledPaymentSource = 'obligation' | 'debt'
export type ScheduledPaymentStatus = 'pending' | 'paid' | 'skipped'

/**
 * One expected occurrence of an obligation or debt installment.
 * Becomes linked to a Transaction only when actually paid.
 * Unique per (sourceType, sourceId, dueDate) so generation is idempotent.
 */
export interface ScheduledPayment extends Timestamps {
  id: ID
  sourceType: ScheduledPaymentSource
  sourceId: ID
  dueDate: ISODate
  expectedAmountSatang: Satang
  status: ScheduledPaymentStatus
  /** Present when status === 'paid'. */
  transactionId?: ID
  paidDate?: ISODate
  note?: string
}

// ---------------------------------------------------------------------------
// Debts & installments
// ---------------------------------------------------------------------------

export const DEBT_KINDS = [
  'credit_card',
  'installment',
  'personal_loan',
  'car_loan',
  'mortgage',
  'student_loan',
  'informal',
  'other',
] as const
export type DebtKind = (typeof DEBT_KINDS)[number]
export type DebtStatus = 'active' | 'paid_off' | 'closed'
/** Rate basis. 'unknown' = the user does not know how interest is charged (no estimates are made). */
export type InterestMethod = 'none' | 'flat' | 'reducing_balance' | 'unknown'

/** A dated change to a loan's principal (top-up = positive, correction may be negative). */
export interface PrincipalAdjustment {
  id: ID
  date: ISODate
  amountSatang: Satang
  /**
   * false = owed but never charged interest (e.g. accrued interest or fees a
   * lender carries over). Default: bears interest like the rest of the principal.
   */
  interestBearing?: boolean
  note?: string
  createdAt: ISODateTime
}

/**
 * A credit-card statement exactly as printed: a dated snapshot, never the live
 * balance (which always comes from the card account). Creates one scheduled
 * payment on its due date.
 */
export interface CardStatement {
  id: ID
  statementDate: ISODate
  balanceSatang: Satang
  minimumDueSatang?: Satang
  dueDate: ISODate
  createdAt: ISODateTime
}

/**
 * A debt with its own lifecycle and payment history.
 * Payment history = transactions where `type === 'debt_payment' && debtId === debt.id`
 * (indexed), plus the debt's scheduled payments (sourceType 'debt').
 *
 * Two balance models (see domain/debts.ts):
 * - loans (every kind except credit_card): outstanding principal =
 *   openingBalanceSatang at openingDate + principal adjustments − allocated principal repaid;
 * - credit cards: the liability of the linked credit-card account (never a second balance).
 *
 * Fields added in the Debts phase are optional and unindexed (no migration needed).
 */
export interface Debt extends Timestamps {
  id: ID
  name: string
  kind: DebtKind
  /** Creditor. */
  lender?: string
  /** Original amount borrowed, if known (for context and progress; never used as the current balance). */
  principalSatang?: Satang
  /** Loans: principal owed on `openingDate` (the effective date). Unused for credit cards. */
  openingBalanceSatang: Satang
  /** Effective date of the opening balance; payments before it are not counted against it. */
  openingDate: ISODate
  interestMethod: InterestMethod
  /** Annual rate in basis points; undefined = unknown. */
  annualInterestRateBps?: BasisPoints
  termMonths?: number
  installmentSatang?: Satang
  /** Day of month the installment is due (1–31; clamped to month end). */
  dueDay?: number
  /** Loan start (first installment month); defaults to the opening date. */
  startDate?: ISODate
  /** Optional contractual maturity; installments are not scheduled after it. */
  maturityDate?: ISODate
  /** Credit cards only: the credit-card account whose balance is this debt. */
  linkedAccountId?: ID
  /** Loans: generate monthly installments (needs installment + due day). */
  scheduleEnabled?: boolean
  /** First date installments are generated from (set on enable/resume). */
  scheduleFrom?: ISODate
  /** Installment schedule paused. */
  schedulePausedAt?: ISODateTime
  principalAdjustments?: PrincipalAdjustment[]
  statements?: CardStatement[]
  /** Archived by the user: hidden; payment history is kept. */
  archivedAt?: ISODateTime
  status: DebtStatus
  note?: string
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

/** Monthly spending limit for one expense category. Unique per (month, categoryId). */
export interface Budget extends Timestamps {
  id: ID
  /** "YYYY-MM". */
  month: string
  categoryId: ID
  limitSatang: Satang
  note?: string
}

// ---------------------------------------------------------------------------
// Attachments (receipts). Metadata and binary data live in separate tables
// so listing attachments never loads the blobs.
// ---------------------------------------------------------------------------

export interface Attachment {
  id: ID
  transactionId?: ID
  fileName: string
  mimeType: string
  sizeBytes: number
  width?: number
  height?: number
  createdAt: ISODateTime
}

export interface AttachmentBlob {
  /** Same id as the Attachment. */
  id: ID
  blob: Blob
}

// ---------------------------------------------------------------------------
// App metadata (key/value): last backup time, persistence status, settings.
// ---------------------------------------------------------------------------

export interface MetaEntry {
  key: string
  value: unknown
  updatedAt: ISODateTime
}
