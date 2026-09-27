/**
 * Detection: header row, column profiles, dataset kind, mapping suggestions.
 * Everything here is a SUGGESTION shown to the user — never applied silently.
 */
import { cellText, isEmptyCell, normalizeKey, parseDate, parseMoney } from './normalize'
import type { CellValue, ColumnMapping, ColumnProfile, DatasetClassification, DetectedType, HeaderDetection, ImportField, Semantic, SheetGrid } from './types'
import { IMPORT_FIELDS } from './types'

// ---------------------------------------------------------------------------
// Vocabulary (Thai + English, lower case)
// ---------------------------------------------------------------------------

const SEMANTIC_WORDS: [Semantic, string[]][] = [
  ['due_date', ['due date', 'duedate', 'ครบกำหนด', 'วันครบกำหนด', 'กำหนดชำระ']],
  ['principal', ['เงินต้น', 'principal']],
  ['interest', ['ดอกเบี้ย', 'interest']],
  ['fee', ['ค่าธรรมเนียม', 'fee', 'fees', 'charge']],
  ['installment', ['งวด', 'installment', 'instalment', 'period no']],
  ['invoice', ['invoice', 'inv no', 'inv.', 'ใบแจ้งหนี้', 'ใบกำกับ', 'เลขที่ใบ', 'bill no', 'เลขที่เอกสาร', 'doc no']],
  ['customer', ['customer', 'client', 'ลูกค้า', 'ชื่อลูกค้า', 'buyer']],
  ['product', ['product', 'item', 'sku', 'สินค้า', 'รายการสินค้า', 'model']],
  ['quantity', ['qty', 'quantity', 'จำนวนชิ้น', 'หน่วย', 'units']],
  ['debit', ['debit', 'dr', 'เดบิต', 'ถอน', 'เงินออก', 'withdrawal', 'withdraw']],
  ['credit', ['credit', 'cr', 'เครดิต', 'ฝาก', 'เงินเข้า', 'deposit']],
  ['balance', ['balance', 'คงเหลือ', 'ยอดคงเหลือ', 'outstanding', 'ค้างชำระ', 'ยอดค้าง', 'remaining']],
  ['budget', ['budget', 'งบ', 'งบประมาณ']],
  ['date', ['date', 'วันที่', 'วัน', 'transaction date', 'posting date', 'วันที่ทำรายการ']],
  ['type', ['type', 'ประเภท', 'ชนิด', 'kind']],
  ['category', ['category', 'หมวด', 'หมวดหมู่']],
  ['account', ['account', 'บัญชี', 'ธนาคาร', 'bank', 'wallet', 'กระเป๋า', 'จ่ายจาก', 'from account']],
  ['note', ['note', 'notes', 'หมายเหตุ', 'remark', 'remarks', 'memo']],
  ['description', ['description', 'รายละเอียด', 'รายการ', 'detail', 'details', 'particulars']],
  ['reference', ['reference', 'ref', 'ref no', 'อ้างอิง', 'เลขที่', 'เลขอ้างอิง']],
  ['status', ['status', 'สถานะ']],
  ['attachment', ['attachment', 'receipt', 'ใบเสร็จ', 'ไฟล์แนบ', 'slip', 'สลิป']],
  ['id', ['id', 'รหัส', 'no', 'no.', '#', 'ลำดับ']],
  ['amount', ['amount', 'จำนวนเงิน', 'ยอด', 'ยอดเงิน', 'ราคา', 'price', 'total', 'net', 'มูลค่า', 'value', 'ยอดขาย', 'sales']],
]

const HEADER_WORDS = SEMANTIC_WORDS.flatMap(([, words]) => words)

function semanticOfName(name: string): Semantic | null {
  const key = normalizeKey(name)
  if (!key) return null
  for (const [semantic, words] of SEMANTIC_WORDS) if (words.includes(key)) return semantic
  for (const [semantic, words] of SEMANTIC_WORDS) if (words.some((w) => w.length >= 3 && key.includes(w))) return semantic
  return null
}

// ---------------------------------------------------------------------------
// Header row
// ---------------------------------------------------------------------------

const isTextCell = (cell: CellValue) => typeof cell === 'string' && cell.trim() !== '' && !parseMoney(cell).ok && !parseDate(cell, 'auto').ok

/**
 * Score the first rows: a header is mostly short, distinct text, often using
 * known column words, followed by rows that hold data. Earliest wins a tie.
 */
export function detectHeaderRow(grid: SheetGrid, scan = 25): HeaderDetection {
  const rows = grid.rows.slice(0, scan)
  const candidates = rows.map((row, index) => {
    const cells = row.filter((c) => !isEmptyCell(c))
    if (cells.length < 2) return { index, score: 0 }
    const texts = cells.filter(isTextCell).map((c) => normalizeKey(cellText(c)))
    const textRatio = texts.length / cells.length
    const distinct = new Set(texts).size / Math.max(1, texts.length)
    const known = texts.filter((t) => HEADER_WORDS.includes(t) || HEADER_WORDS.some((w) => w.length >= 4 && t.includes(w))).length
    const below = grid.rows.slice(index + 1, index + 6)
    const dataBelow = below.filter((r) => r.filter((c) => !isEmptyCell(c)).length >= Math.max(2, cells.length / 2)).length
    const score = cells.length * textRatio * distinct + known * 3 + dataBelow
    return { index, score: Math.round(score * 10) / 10 }
  })
  const best = candidates.reduce((a, b) => (b.score > a.score ? b : a), { index: 0, score: -1 })
  return {
    index: best.score > 0 ? best.index : 0,
    candidates: candidates
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5),
  }
}

// ---------------------------------------------------------------------------
// Column profiles
// ---------------------------------------------------------------------------

const columnLetter = (index: number): string => {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function typeOfCell(cell: CellValue): DetectedType {
  if (typeof cell === 'object' && cell !== null) return 'date'
  if (typeof cell === 'boolean') return 'boolean'
  if (typeof cell === 'number') return Number.isInteger(cell) ? 'integer' : 'decimal'
  const text = cellText(cell).trim()
  if (/^(true|false|ใช่|ไม่ใช่|yes|no)$/i.test(text)) return 'boolean'
  const asDate = parseDate(text, 'auto')
  if (asDate.ok || asDate.reason === 'ambiguous' || asDate.reason === 'two_digit_year') return 'date'
  if (/[฿,]|บาท|THB/i.test(text) && parseMoney(text).ok) return 'currency'
  if (/^-?\d+$/.test(text)) return 'integer'
  if (/^-?\d+\.\d+$/.test(text)) return 'decimal'
  return 'text'
}

/** Data rows = every row after the header (blank rows included; the caller skips them). */
export const dataRows = (grid: SheetGrid, headerIndex: number) => grid.rows.slice(headerIndex + 1)

export function columnNames(grid: SheetGrid, headerIndex: number): string[] {
  const header = grid.rows[headerIndex] ?? []
  const names: string[] = []
  for (let i = 0; i < grid.columnCount; i++) {
    const text = cellText(header[i] ?? null).trim()
    let name = text || `คอลัมน์ ${columnLetter(i)}`
    // Keep names unique so every column stays addressable.
    if (names.includes(name)) name = `${name} (${columnLetter(i)})`
    names.push(name)
  }
  return names
}

export function profileColumns(grid: SheetGrid, headerIndex: number): ColumnProfile[] {
  const names = columnNames(grid, headerIndex)
  const rows = dataRows(grid, headerIndex).filter((row) => row.some((c) => !isEmptyCell(c)))
  return names.map((name, index) => {
    const values = rows.map((row) => row[index] ?? null)
    const filled = values.filter((c) => !isEmptyCell(c))
    const counts = new Map<DetectedType, number>()
    for (const cell of filled) counts.set(typeOfCell(cell), (counts.get(typeOfCell(cell)) ?? 0) + 1)
    let type: DetectedType = filled.length === 0 ? 'unknown' : 'text'
    const [top, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['unknown', 0]
    const numeric = (counts.get('integer') ?? 0) + (counts.get('decimal') ?? 0) + (counts.get('currency') ?? 0)
    if (filled.length && topCount / filled.length >= 0.8) type = top
    else if (filled.length && numeric / filled.length >= 0.8) type = counts.get('currency') ? 'currency' : 'decimal'
    else if (filled.length) type = 'unknown'

    let semantic = semanticOfName(name) ?? 'unknown'
    if (semantic === 'unknown' && type === 'date') semantic = 'date'
    if (semantic === 'unknown' && type === 'currency') semantic = 'amount'
    if (semantic === 'date' && type !== 'date' && filled.length > 0 && type !== 'unknown') semantic = 'unknown'
    return {
      index,
      name,
      nonEmpty: filled.length,
      empty: values.length - filled.length,
      populatedPct: values.length ? Math.round((filled.length / values.length) * 100) : 0,
      type,
      semantic,
      samples: filled.slice(0, 3).map((c) => cellText(c).trim().slice(0, 40)),
    }
  })
}

// ---------------------------------------------------------------------------
// Dataset classification
// ---------------------------------------------------------------------------

export function classifyDataset(profiles: readonly ColumnProfile[]): DatasetClassification {
  const has = (...semantics: Semantic[]) => semantics.some((s) => profiles.some((p) => p.semantic === s && p.nonEmpty > 0))
  const names = profiles.map((p) => normalizeKey(p.name)).join(' ')
  const money = has('amount', 'debit', 'credit')

  if (has('customer') && (has('product', 'quantity') || /sale|ขาย/.test(names)) && money)
    return { kind: 'sales_history', confidence: 'high', personal: false, reasons: ['customer', 'product/quantity', 'amount'] }
  if ((has('customer') || has('invoice')) && (has('due_date') || has('balance') || /receivable|ลูกหนี้|aging|ค้างรับ/.test(names)))
    return {
      kind: 'receivables',
      confidence: has('customer') && has('invoice') ? 'high' : 'medium',
      personal: false,
      reasons: ['customer/invoice', 'due date/outstanding'],
    }
  if (has('customer') && money) return { kind: 'sales_history', confidence: 'medium', personal: false, reasons: ['customer', 'amount'] }
  if (has('principal', 'interest', 'installment') && money)
    return {
      kind: 'debt_schedule',
      confidence: has('principal') && has('interest') ? 'high' : 'medium',
      personal: true,
      reasons: ['principal/interest/installment'],
    }
  if (has('budget') && has('category')) return { kind: 'budget', confidence: 'medium', personal: true, reasons: ['budget', 'category'] }
  if (has('date') && money && has('description', 'category', 'account', 'type'))
    return {
      kind: 'transaction_history',
      confidence: has('type') || has('category') ? 'high' : 'medium',
      personal: true,
      reasons: ['date', 'amount', 'description/category/account/type'],
    }
  if (has('account') && has('balance') && !has('date'))
    return { kind: 'account_balance', confidence: 'medium', personal: true, reasons: ['account', 'balance'] }
  if (has('date') && money) return { kind: 'transaction_history', confidence: 'low', personal: true, reasons: ['date', 'amount'] }
  return { kind: 'unknown', confidence: 'low', personal: false, reasons: [] }
}

// ---------------------------------------------------------------------------
// Mapping suggestion (shown as "แนะนำ"; the user confirms it)
// ---------------------------------------------------------------------------

const FIELD_FOR: Partial<Record<Semantic, ImportField>> = {
  date: 'date',
  amount: 'amount',
  debit: 'outflow',
  credit: 'inflow',
  type: 'type',
  account: 'account',
  category: 'category',
  principal: 'principal',
  interest: 'interest',
  fee: 'fee',
  description: 'description',
  note: 'note',
  reference: 'reference',
  invoice: 'reference',
  attachment: 'attachment',
}

export const emptyMapping = (): ColumnMapping => Object.fromEntries(IMPORT_FIELDS.map((f) => [f, null])) as ColumnMapping

export function suggestMapping(profiles: readonly ColumnProfile[]): ColumnMapping {
  const mapping = emptyMapping()
  for (const profile of profiles) {
    const field = FIELD_FOR[profile.semantic]
    if (field && mapping[field] === null && profile.nonEmpty > 0) mapping[field] = profile.index
  }
  if (mapping.amount !== null && (mapping.outflow !== null || mapping.inflow !== null)) {
    mapping.outflow = null
    mapping.inflow = null
  }
  return mapping
}
