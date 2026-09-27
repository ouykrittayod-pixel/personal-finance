/**
 * Normalization without changing meaning. Every function returns either a
 * value or a reason — nothing is rounded, guessed or rewritten silently.
 */
import type { ISODate } from '../entities'
import type { Satang } from '../money'
import { isCalendarDate } from '../transactions'
import type { CellValue, DateFormat, RowKind } from './types'

/** Text shown for a cell exactly as read (dates as YYYY-MM-DD). */
export function cellText(cell: CellValue): string {
  if (cell === null || cell === undefined) return ''
  if (typeof cell === 'object') return cell.iso
  return String(cell)
}

export const isEmptyCell = (cell: CellValue) => cellText(cell).trim() === ''

/** Trim only. Never rewrites, translates or removes punctuation. */
export const cleanText = (cell: CellValue): string | undefined => {
  const text = cellText(cell).trim()
  return text === '' ? undefined : text
}

// ---------------------------------------------------------------------------
// Money → integer satang
// ---------------------------------------------------------------------------

export type MoneyResult = { ok: true; satang: Satang } | { ok: false; reason: 'empty' | 'invalid' | 'too_precise' }

const GROUPED = /^\d{1,3}(,\d{3})+(\.\d+)?$/
const PLAIN = /^\d+(\.\d+)?$/

/**
 * "27,500.00" / "฿27,500" / "27500.5" / 27500 / "(1,200.00)" / "-1,200" → satang.
 * More than 2 decimals → too_precise (needs review; never rounded).
 */
export function parseMoney(cell: CellValue): MoneyResult {
  if (cell === null || cell === undefined || (typeof cell === 'string' && cell.trim() === '')) return { ok: false, reason: 'empty' }
  if (typeof cell === 'number') {
    if (!Number.isFinite(cell)) return { ok: false, reason: 'invalid' }
    const cents = Math.round(cell * 100)
    if (Math.abs(cell * 100 - cents) > 1e-6) return { ok: false, reason: 'too_precise' }
    return Number.isSafeInteger(cents) ? { ok: true, satang: cents as Satang } : { ok: false, reason: 'invalid' }
  }
  if (typeof cell !== 'string') return { ok: false, reason: 'invalid' }
  let text = cell.trim().replace(/\s+/g, '')
  let negative = false
  if (/^\(.*\)$/.test(text)) {
    negative = true
    text = text.slice(1, -1)
  }
  if (text.startsWith('-') || text.startsWith('−')) {
    negative = !negative
    text = text.slice(1)
  }
  text = text.replace(/^(฿|THB|บาท)/i, '').replace(/(฿|THB|บาท)$/i, '')
  if (text.startsWith('-') || text.startsWith('−')) {
    negative = !negative
    text = text.slice(1)
  }
  if (!GROUPED.test(text) && !PLAIN.test(text)) return { ok: false, reason: 'invalid' }
  const [whole, fraction = ''] = text.replace(/,/g, '').split('.')
  if (fraction.length > 2) return { ok: false, reason: 'too_precise' }
  const satang = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(satang)) return { ok: false, reason: 'invalid' }
  return { ok: true, satang: (negative && satang !== 0 ? -satang : satang) as Satang }
}

// ---------------------------------------------------------------------------
// Dates → YYYY-MM-DD
// ---------------------------------------------------------------------------

export type DateResult =
  { ok: true; iso: ISODate; buddhistYear?: boolean } | { ok: false; reason: 'empty' | 'invalid' | 'ambiguous' | 'two_digit_year' | 'not_a_date' }

const THAI_MONTHS: Record<string, number> = {
  'ม.ค.': 1,
  มกราคม: 1,
  'ก.พ.': 2,
  กุมภาพันธ์: 2,
  'มี.ค.': 3,
  มีนาคม: 3,
  'เม.ย.': 4,
  เมษายน: 4,
  'พ.ค.': 5,
  พฤษภาคม: 5,
  'มิ.ย.': 6,
  มิถุนายน: 6,
  'ก.ค.': 7,
  กรกฎาคม: 7,
  'ส.ค.': 8,
  สิงหาคม: 8,
  'ก.ย.': 9,
  กันยายน: 9,
  'ต.ค.': 10,
  ตุลาคม: 10,
  'พ.ย.': 11,
  พฤศจิกายน: 11,
  'ธ.ค.': 12,
  ธันวาคม: 12,
}
const pad = (n: number, width = 2) => String(n).padStart(width, '0')

function finish(year: number, month: number, day: number): DateResult {
  let buddhistYear = false
  // Thai workbooks often use พ.ศ. (Buddhist Era): 2569 = 2026. Converted and reported.
  if (year >= 2400) {
    year -= 543
    buddhistYear = true
  }
  const iso = `${pad(year, 4)}-${pad(month)}-${pad(day)}`
  if (!isCalendarDate(iso)) return { ok: false, reason: 'invalid' }
  return buddhistYear ? { ok: true, iso, buddhistYear } : { ok: true, iso }
}

/**
 * A date from a cell. Real Excel dates are exact. Text dates:
 * YYYY-MM-DD / YYYY/MM/DD always; D/M/Y vs M/D/Y only when unambiguous
 * (a part > 12) or when the user chose the format — "03/04/2026" is ambiguous.
 */
export function parseDate(cell: CellValue, format: DateFormat): DateResult {
  if (cell === null || cell === undefined) return { ok: false, reason: 'empty' }
  if (typeof cell === 'object') {
    const [y, m, d] = cell.iso.split('-').map(Number)
    return finish(y!, m!, d!)
  }
  if (typeof cell !== 'string') return { ok: false, reason: 'not_a_date' }
  const text = cell.trim()
  if (text === '') return { ok: false, reason: 'empty' }

  const thai = /^(\d{1,2})\s*([ก-๙.]+)\s*(\d{2,4})$/.exec(text)
  if (thai && THAI_MONTHS[thai[2]!] !== undefined) {
    if (thai[3]!.length === 2) return { ok: false, reason: 'two_digit_year' }
    return finish(Number(thai[3]), THAI_MONTHS[thai[2]!]!, Number(thai[1]))
  }
  const ymd = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text)
  if (ymd) return finish(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]))
  const parts = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(text)
  if (!parts) return { ok: false, reason: 'not_a_date' }
  if (parts[3]!.length === 2) return { ok: false, reason: 'two_digit_year' }
  const [a, b, year] = [Number(parts[1]), Number(parts[2]), Number(parts[3])]
  if (format === 'DMY') return finish(year, b, a)
  if (format === 'MDY') return finish(year, a, b)
  if (format === 'YMD') return { ok: false, reason: 'invalid' }
  if (a > 12 && b <= 12) return finish(year, b, a)
  if (b > 12 && a <= 12) return finish(year, a, b)
  if (a === b) return finish(year, a, b)
  return { ok: false, reason: 'ambiguous' }
}

// ---------------------------------------------------------------------------
// Row kinds from type values (known words only; anything else must be mapped by the user)
// ---------------------------------------------------------------------------

const KIND_WORDS: [RowKind, string[]][] = [
  ['expense', ['รายจ่าย', 'จ่าย', 'ค่าใช้จ่าย', 'expense', 'expenses', 'spend', 'purchase', 'ซื้อ']],
  ['income', ['รายรับ', 'รับ', 'รายได้', 'income', 'revenue', 'salary']],
  ['debt_payment', ['ชำระหนี้', 'จ่ายหนี้', 'ผ่อน', 'ผ่อนชำระ', 'ชำระบัตร', 'จ่ายบัตร', 'debt payment', 'debt_payment', 'loan payment', 'card payment']],
  ['transfer', ['โอน', 'โอนเงิน', 'transfer']],
  ['opening_balance', ['ยอดยกมา', 'ยอดเริ่มต้น', 'ยอดตั้งต้น', 'opening balance', 'opening_balance', 'beginning balance']],
]

export const normalizeKey = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('th')

/** A known type word → its kind. Unknown words return null (never guessed). */
export function kindFromWord(value: string): RowKind | null {
  const key = normalizeKey(value)
  for (const [kind, words] of KIND_WORDS) if (words.includes(key)) return kind
  return null
}

/** "รวม", "Total", "ยอดรวม" rows are usually subtotals, not transactions. */
export const looksLikeTotal = (text: string | undefined) => !!text && /^(รวมทั้งสิ้น|ยอดรวม|รวม|grand total|subtotal|total|sum)(?=$|[\s:])/i.test(text.trim())
