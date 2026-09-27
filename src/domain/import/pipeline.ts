/**
 * The preview pipeline: every source row → normalized values, classification,
 * validation messages, duplicate candidates, status. Pure — reads the
 * existing records it is given and returns a preview; it writes nothing.
 *
 * Accounting rules (the app's own, via buildTransaction):
 * - a row's kind comes only from its type value, or from an explicit choice by
 *   the user — never from "it has an amount";
 * - opening balances are account settings, not transactions;
 * - card purchases are expenses, card payments are debt payments (to the card);
 * - principal / interest / fees only from explicit split columns.
 */
import type { Account, Category, Debt, Transaction } from '../entities'
import type { Satang } from '../money'
import { buildTransaction, type TransactionDraft } from '../transactions'
import { columnNames, dataRows } from './detect'
import { cellText, cleanText, isEmptyCell, looksLikeTotal, normalizeKey, parseDate, parseMoney } from './normalize'
import {
  IGNORE,
  type CellValue,
  type ColumnMapping,
  type DatasetClassification,
  type DuplicateCandidate,
  type ImportField,
  type ImportOptions,
  type NormalizedRow,
  type PreviewResult,
  type PreviewRow,
  type RowClassification,
  type RowKind,
  type RowMessage,
  type RowStatus,
  type SheetGrid,
  type ValueMappings,
} from './types'

export interface ExistingData {
  accounts: readonly Account[]
  categories: readonly Category[]
  debts: readonly Debt[]
  transactions: readonly Transaction[]
}

export interface PreviewInput {
  fileName: string
  sheet: SheetGrid
  headerIndex: number
  mapping: ColumnMapping
  values: ValueMappings
  options: ImportOptions
  dataset: DatasetClassification
  existing: ExistingData
}

/** Messages that put a row in REVIEW REQUIRED (it must be looked at; it is not an error in the data itself). */
export const REVIEW_CODES = new Set(['unclassified', 'date_ambiguous', 'date_two_digit_year', 'amount_too_precise', 'looks_like_total', 'type_empty'])

const TRANSACTION_KINDS = new Set<RowKind>(['expense', 'income', 'debt_payment', 'transfer'])

function statusOf(classification: RowClassification, messages: readonly RowMessage[]): RowStatus {
  if (classification === 'ignored') return 'ignored'
  if (messages.some((m) => m.level === 'error')) return 'error'
  if (messages.some((m) => REVIEW_CODES.has(m.code))) return 'review'
  if (messages.some((m) => m.level === 'warning')) return 'warning'
  return 'ready'
}

export function buildPreview(input: PreviewInput): PreviewResult {
  const { sheet, mapping, values, options, existing } = input
  const names = columnNames(sheet, input.headerIndex)
  const accounts = new Map(existing.accounts.map((a) => [a.id, a]))
  const categories = new Map(existing.categories.map((c) => [c.id, c]))
  const debts = new Map(existing.debts.map((d) => [d.id, d]))
  const context = { accounts, categories, debts }
  const firstDataRow = sheet.firstRowNumber + input.headerIndex + 1

  const rows: PreviewRow[] = []
  let blankRowsSkipped = 0
  const openingSeen = new Map<string, number>()

  dataRows(sheet, input.headerIndex).forEach((cells, offset) => {
    if (cells.every((c) => isEmptyCell(c))) {
      blankRowsSkipped += 1
      return
    }
    const rowNumber = firstDataRow + offset
    const cell = (field: ImportField): CellValue => (mapping[field] === null ? null : (cells[mapping[field]!] ?? null))
    const messages: RowMessage[] = []
    const add = (level: RowMessage['level'], code: string, detail?: string) => messages.push(detail === undefined ? { level, code } : { level, code, detail })
    const normalized: NormalizedRow = {}

    const original: Record<string, string> = {}
    names.forEach((name, i) => {
      original[name] = cellText(cells[i] ?? null)
    })

    // Date
    const date = parseDate(cell('date'), options.dateFormat)
    if (date.ok) {
      normalized.date = date.iso
      if (date.buddhistYear) add('info', 'buddhist_year_converted', cellText(cell('date')))
    } else if (date.reason === 'empty') add('error', 'date_missing')
    else if (date.reason === 'ambiguous') add('warning', 'date_ambiguous', cellText(cell('date')))
    else if (date.reason === 'two_digit_year') add('warning', 'date_two_digit_year', cellText(cell('date')))
    else add('error', 'date_invalid', cellText(cell('date')))

    // Amount (one column, or money-out / money-in columns)
    let direction: 'out' | 'in' | null = null
    let amount: Satang | undefined
    const readMoney = (field: ImportField) => {
      const result = parseMoney(cell(field))
      if (result.ok) return result.satang
      if (result.reason === 'too_precise') add('warning', 'amount_too_precise', cellText(cell(field)))
      else if (result.reason === 'invalid') add('error', 'amount_invalid', cellText(cell(field)))
      return undefined
    }
    if (mapping.amount !== null) {
      if (isEmptyCell(cell('amount'))) add('error', 'amount_missing')
      else {
        const value = readMoney('amount')
        if (value !== undefined) {
          direction = value < 0 ? 'out' : 'in'
          amount = value
        }
      }
    } else if (mapping.outflow !== null || mapping.inflow !== null) {
      const out = isEmptyCell(cell('outflow')) ? undefined : readMoney('outflow')
      const inn = isEmptyCell(cell('inflow')) ? undefined : readMoney('inflow')
      if (out && inn) add('error', 'outflow_and_inflow')
      else if (out) [direction, amount] = ['out', Math.abs(out) as Satang]
      else if (inn) [direction, amount] = ['in', Math.abs(inn) as Satang]
      else if (!messages.some((m) => m.code.startsWith('amount_'))) add('error', 'amount_missing')
    } else add('error', 'amount_missing')

    // Kind
    let classification: RowClassification = 'unclassified'
    const typeText = cleanText(cell('type'))
    switch (options.rowTypeMode) {
      case 'column': {
        if (!typeText) add('warning', 'type_empty')
        else {
          const target = values.type[typeText]
          if (target === IGNORE) classification = 'ignored'
          else if (target) classification = target as RowKind
          else add('error', 'type_unknown', typeText)
        }
        break
      }
      case 'expense':
      case 'income':
        classification = options.rowTypeMode
        break
      case 'direction':
        if (direction) classification = direction === 'out' ? 'expense' : 'income'
        break
      case 'none':
        break
    }
    if (classification === 'unclassified' && !messages.some((m) => m.code === 'type_unknown')) add('warning', 'unclassified')
    normalized.kind = classification

    const description = cleanText(cell('description'))
    const note = cleanText(cell('note'))
    const reference = cleanText(cell('reference'))
    if (description) normalized.description = description
    if (note) normalized.note = note
    if (reference) normalized.reference = reference
    if (looksLikeTotal(description) || looksLikeTotal(cellText(cells.find((c) => !isEmptyCell(c)) ?? null))) add('warning', 'looks_like_total')
    if (!isEmptyCell(cell('attachment'))) add('info', 'attachment_reference', cellText(cell('attachment')))

    // Sign: only "direction" mode reads the sign as meaning; otherwise a negative amount is not allowed (except opening balances).
    if (amount !== undefined) {
      if (options.rowTypeMode === 'direction' || mapping.amount === null) amount = Math.abs(amount) as Satang
      // The sign can only be judged once the row's kind is known.
      else if (amount < 0 && classification !== 'opening_balance' && classification !== 'unclassified' && classification !== 'ignored')
        add('error', 'amount_negative', cellText(cell('amount')))
      if (amount === 0 && classification !== 'opening_balance') add('error', 'amount_zero')
      normalized.amountSatang = amount
    }

    // References to existing records (value mappings chosen by the user)
    const lookup = (field: 'account' | 'toAccount' | 'category' | 'debt', required: boolean): string | undefined => {
      const text = cleanText(cell(field))
      if (!text) {
        if (required) add('error', `${field}_missing`)
        return undefined
      }
      const target = values[field][text]
      if (!target || target === IGNORE) {
        add('error', `${field}_unmapped`, text)
        return undefined
      }
      return target
    }

    if (classification !== 'ignored' && classification !== 'unclassified') {
      normalized.accountId = lookup('account', true)
      if (classification === 'transfer') normalized.toAccountId = lookup('toAccount', true)
      if (classification === 'expense' || classification === 'income') normalized.categoryId = lookup('category', true)
      if (classification === 'debt_payment') normalized.debtId = lookup('debt', true)
    }

    if (classification === 'opening_balance') {
      // Not a transaction: becomes the account's opening balance and date (a later, explicit step).
      add('info', 'opening_balance_not_transaction')
      if (normalized.accountId) {
        const seen = openingSeen.get(normalized.accountId)
        if (seen !== undefined) add('error', 'opening_balance_repeated', String(seen))
        else openingSeen.set(normalized.accountId, rowNumber)
        add('warning', 'opening_balance_replaces_existing')
      }
    }

    // Debt split (explicit columns only)
    if (classification === 'debt_payment') {
      const parts = (['principal', 'interest', 'fee'] as const).map((field) =>
        mapping[field] === null || isEmptyCell(cell(field)) ? undefined : readMoney(field),
      )
      const [principal, interest, fee] = parts
      if (principal !== undefined) normalized.principalSatang = principal
      if (interest !== undefined) normalized.interestSatang = interest
      if (fee !== undefined) normalized.feeSatang = fee
    }

    // Final check with the app's own transaction rules.
    const noErrors = !messages.some((m) => m.level === 'error')
    if (noErrors && TRANSACTION_KINDS.has(classification as RowKind) && normalized.date && normalized.amountSatang !== undefined && normalized.accountId) {
      const split = [normalized.principalSatang, normalized.interestSatang, normalized.feeSatang]
      const draft: TransactionDraft = {
        type: classification as TransactionDraft['type'],
        amountSatang: normalized.amountSatang,
        accountId: normalized.accountId,
        date: normalized.date,
        ...(normalized.toAccountId ? { toAccountId: normalized.toAccountId } : {}),
        ...(normalized.categoryId ? { categoryId: normalized.categoryId } : {}),
        ...(normalized.debtId ? { debtId: normalized.debtId } : {}),
        ...(classification === 'debt_payment'
          ? split.some((v) => v !== undefined)
            ? {
                allocation: 'split' as const,
                principalSatang: normalized.principalSatang ?? null,
                interestSatang: normalized.interestSatang ?? null,
                feeSatang: normalized.feeSatang ?? null,
              }
            : { allocation: 'unallocated' as const }
          : {}),
        ...(description ? { description } : {}),
        ...(note ? { note } : {}),
      }
      const result = buildTransaction(draft, context, { id: 'import-preview', now: '2000-01-01T00:00:00.000Z' })
      if (!result.ok) for (const issue of result.issues) add('error', `rule_${issue}`)
      else if (classification === 'debt_payment') {
        if (result.transaction.toAccountId) normalized.toAccountId = result.transaction.toAccountId
        if (result.transaction.principalSatang === undefined && debts.get(normalized.debtId!)?.kind !== 'credit_card') add('info', 'debt_unallocated')
      }
      const account = accounts.get(normalized.accountId)
      if (account?.archivedAt) add('warning', 'account_archived')
    }

    rows.push({
      key: `${sheet.name}#${rowNumber}`,
      source: { fileName: input.fileName, sheetName: sheet.name, rowNumber },
      original,
      normalized,
      classification,
      status: 'ready',
      messages,
      duplicates: [],
    })
  })

  markDuplicates(rows, existing.transactions)
  for (const row of rows) row.status = statusOf(row.classification, row.messages)

  // Sheet-level notes
  const sheetMessages: RowMessage[] = []
  if (!input.dataset.personal) sheetMessages.push({ level: 'warning', code: 'business_dataset', detail: input.dataset.kind })
  const used = new Set(Object.values(mapping).filter((v): v is number => v !== null))
  const unmapped = names.filter((_, i) => !used.has(i))
  if (unmapped.length) sheetMessages.push({ level: 'warning', code: 'unmapped_columns', detail: unmapped.join(', ') })
  if (options.rowTypeMode === 'none') sheetMessages.push({ level: 'warning', code: 'no_row_type' })

  const count = (test: (row: PreviewRow) => boolean) => rows.filter(test).length
  return {
    rows,
    sheetMessages,
    summary: {
      sourceRows: rows.length,
      blankRowsSkipped,
      ready: count((r) => r.status === 'ready' || r.status === 'warning'),
      warnings: count((r) => r.status === 'warning'),
      errors: count((r) => r.status === 'error'),
      duplicates: count((r) => r.duplicates.length > 0),
      review: count((r) => r.status === 'review'),
      unclassified: count((r) => r.classification === 'unclassified'),
      ignored: count((r) => r.status === 'ignored'),
      openingBalances: count((r) => r.classification === 'opening_balance'),
    },
  }
}

/**
 * Possible duplicates — flagged, never removed.
 * Identity, strongest first: reference number (+ date + amount), else
 * date + amount + account + description. Date + amount alone is never enough.
 */
export function markDuplicates(rows: PreviewRow[], existing: readonly Transaction[]) {
  const identity = (row: PreviewRow): { key: string; basis: DuplicateCandidate['basis'] } | null => {
    const n = row.normalized
    if (!n.date || n.amountSatang === undefined || row.classification === 'ignored') return null
    if (n.reference) return { key: `ref|${normalizeKey(n.reference)}|${n.date}|${n.amountSatang}`, basis: 'reference' }
    if (!n.accountId && !n.description) return null
    return { key: `c|${n.date}|${n.amountSatang}|${n.accountId ?? ''}|${normalizeKey(n.description ?? '')}|${row.classification}`, basis: 'composite' }
  }
  const groups = new Map<string, PreviewRow[]>()
  const references = new Map<string, Set<number>>()
  for (const row of rows) {
    const id = identity(row)
    if (!id) {
      if (row.normalized.date && row.normalized.amountSatang !== undefined && row.classification !== 'ignored')
        row.messages.push({ level: 'info', code: 'duplicate_check_limited' })
      continue
    }
    groups.set(id.key, [...(groups.get(id.key) ?? []), row])
    if (row.normalized.reference) {
      const ref = normalizeKey(row.normalized.reference)
      references.set(ref, (references.get(ref) ?? new Set()).add(row.normalized.amountSatang!))
    }
  }
  for (const [key, group] of groups) {
    if (group.length < 2) continue
    const basis = key.startsWith('ref|') ? 'reference' : 'composite'
    for (const row of group) {
      for (const other of group) if (other !== row) row.duplicates.push({ kind: 'file', ref: String(other.source.rowNumber), basis })
      row.messages.push({
        level: 'warning',
        code: 'possible_duplicate',
        detail: group
          .filter((r) => r !== row)
          .map((r) => r.source.rowNumber)
          .join(', '),
      })
    }
  }
  // Lines of one invoice (same reference, different amounts) are not duplicates — noted for context.
  for (const row of rows) {
    const ref = row.normalized.reference ? references.get(normalizeKey(row.normalized.reference)) : undefined
    if (ref && ref.size > 1) row.messages.push({ level: 'info', code: 'shared_reference' })
  }

  // Against transactions already in the app.
  const index = new Map<string, Transaction[]>()
  for (const tx of existing) {
    const key = `${tx.date}|${tx.amountSatang}|${tx.accountId}|${tx.type}`
    index.set(key, [...(index.get(key) ?? []), tx])
  }
  for (const row of rows) {
    const n = row.normalized
    if (!n.date || n.amountSatang === undefined || !n.accountId || !TRANSACTION_KINDS.has(row.classification as RowKind)) continue
    const matches = (index.get(`${n.date}|${n.amountSatang}|${n.accountId}|${row.classification}`) ?? []).filter(
      (tx) => !n.description || !tx.description || normalizeKey(tx.description) === normalizeKey(n.description),
    )
    for (const tx of matches) row.duplicates.push({ kind: 'existing', ref: tx.id, basis: 'composite' })
    if (matches.length) row.messages.push({ level: 'warning', code: 'possible_duplicate_existing' })
  }
}
