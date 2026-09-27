/**
 * Import Center (Phase 15A): read → normalize → validate → preview.
 * Pure data types. Nothing in the import domain writes to the database.
 */
import type { ID, ISODate, TransactionType } from '../entities'
import type { Satang } from '../money'

/** A date cell, converted from the workbook's own date serial (no time zone involved). */
export interface ExcelDate {
  kind: 'date'
  iso: ISODate
}
export type CellValue = string | number | boolean | ExcelDate | null

export interface SheetGrid {
  name: string
  /** Excel row number of rows[0] (1-based) — keeps every row traceable to the file. */
  firstRowNumber: number
  rows: CellValue[][]
  columnCount: number
}

export interface ParsedWorkbook {
  fileName: string
  fileSize: number
  sheets: SheetGrid[]
}

// ---------------------------------------------------------------------------
// Detection (suggestions only)
// ---------------------------------------------------------------------------

export type DetectedType = 'text' | 'integer' | 'decimal' | 'date' | 'currency' | 'boolean' | 'unknown'
export type Semantic =
  | 'id'
  | 'date'
  | 'due_date'
  | 'customer'
  | 'description'
  | 'note'
  | 'category'
  | 'account'
  | 'type'
  | 'amount'
  | 'debit'
  | 'credit'
  | 'balance'
  | 'principal'
  | 'interest'
  | 'fee'
  | 'invoice'
  | 'reference'
  | 'quantity'
  | 'product'
  | 'status'
  | 'budget'
  | 'installment'
  | 'attachment'
  | 'unknown'

export interface ColumnProfile {
  index: number
  /** Header text, or "คอลัมน์ C" when the header cell is empty. */
  name: string
  nonEmpty: number
  empty: number
  /** 0–100 (integer). */
  populatedPct: number
  type: DetectedType
  semantic: Semantic
  samples: string[]
}

export interface HeaderDetection {
  /** Index into SheetGrid.rows. */
  index: number
  candidates: { index: number; score: number }[]
}

export type DatasetKind = 'transaction_history' | 'receivables' | 'sales_history' | 'debt_schedule' | 'account_balance' | 'budget' | 'unknown'

export interface DatasetClassification {
  kind: DatasetKind
  confidence: 'high' | 'medium' | 'low'
  /** False for business data (sales, receivables): never personal income/expense by default. */
  personal: boolean
  reasons: string[]
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

export const IMPORT_FIELDS = [
  'date',
  'amount',
  'outflow',
  'inflow',
  'type',
  'account',
  'toAccount',
  'category',
  'debt',
  'principal',
  'interest',
  'fee',
  'description',
  'note',
  'reference',
  'attachment',
] as const
export type ImportField = (typeof IMPORT_FIELDS)[number]

/** Source column index per application field (null = not used). */
export type ColumnMapping = Record<ImportField, number | null>

/** Fields whose distinct source values are mapped to existing records / types. */
export type ValueField = 'type' | 'account' | 'toAccount' | 'category' | 'debt'

export const IGNORE = '__ignore'
/** What a source row type value means. */
export type RowKind = TransactionType | 'opening_balance'
/** Target per distinct source value: an existing record id (or a RowKind for `type`), IGNORE, or null (not mapped). */
export type ValueMappings = Record<ValueField, Record<string, string | null>>

/**
 * How each row's kind is decided:
 * - column: from the mapped type column (its values mapped to kinds);
 * - expense / income: the user states every row is that kind;
 * - direction: money out (negative amount / outflow column) = expense, money in = income — only when chosen explicitly;
 * - none: nothing decides it → every row needs review.
 */
export type RowTypeMode = 'column' | 'expense' | 'income' | 'direction' | 'none'
export type DateFormat = 'auto' | 'DMY' | 'MDY' | 'YMD'

export interface ImportOptions {
  rowTypeMode: RowTypeMode
  dateFormat: DateFormat
}

export type MatchStatus = 'matched' | 'suggested' | 'unmatched'
export interface ValueMatch {
  value: string
  count: number
  status: MatchStatus
  /** Exact match: target. Suggestion: proposed target (applied only if the user accepts it). */
  targetId: string | null
  reason?: string
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export type MessageLevel = 'error' | 'warning' | 'info'
export interface RowMessage {
  level: MessageLevel
  code: string
  /** Extra detail for the message (e.g. the source value), never shown in logs. */
  detail?: string
}

export type RowClassification = RowKind | 'unclassified' | 'ignored'
export type RowStatus = 'ready' | 'warning' | 'error' | 'review' | 'ignored'

export interface SourceRef {
  fileName: string
  sheetName: string
  /** Excel row number (1-based), as shown in Excel. */
  rowNumber: number
}

export interface NormalizedRow {
  date?: ISODate
  amountSatang?: Satang
  kind?: RowClassification
  accountId?: ID
  toAccountId?: ID
  categoryId?: ID
  debtId?: ID
  principalSatang?: Satang
  interestSatang?: Satang
  feeSatang?: Satang
  description?: string
  note?: string
  reference?: string
}

export interface DuplicateCandidate {
  kind: 'file' | 'existing'
  /** Source row number (file) or existing transaction id. */
  ref: string
  basis: 'reference' | 'composite'
}

export interface PreviewRow {
  key: string
  source: SourceRef
  /** Source values as text, by column name — unchanged. */
  original: Record<string, string>
  normalized: NormalizedRow
  classification: RowClassification
  status: RowStatus
  messages: RowMessage[]
  duplicates: DuplicateCandidate[]
}

export interface PreviewSummary {
  sourceRows: number
  blankRowsSkipped: number
  ready: number
  warnings: number
  errors: number
  duplicates: number
  review: number
  unclassified: number
  ignored: number
  openingBalances: number
}

export interface PreviewResult {
  rows: PreviewRow[]
  summary: PreviewSummary
  /** Sheet-level notes (e.g. unmapped columns, business dataset). */
  sheetMessages: RowMessage[]
}
