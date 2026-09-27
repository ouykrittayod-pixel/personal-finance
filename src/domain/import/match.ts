/**
 * Matching distinct source values to existing records.
 * - matched:   the same name (ignoring case and extra spaces) — used as the mapping;
 * - suggested: a known synonym or a partial name — shown, applied only if the user accepts;
 * - unmatched: nothing — the user chooses (creating new records is a later, explicit step).
 */
import { cellText, isEmptyCell, kindFromWord, normalizeKey } from './normalize'
import type { CellValue, ValueMatch } from './types'

export interface MatchTarget {
  id: string
  name: string
}

/** Common Thai ⇄ English names (suggestions only). */
const SYNONYMS: string[][] = [
  ['cash', 'เงินสด'],
  ['food', 'อาหาร'],
  ['drink', 'drinks', 'เครื่องดื่ม'],
  ['shopping', 'ช้อปปิ้ง', 'ช็อปปิ้ง'],
  ['transport', 'transportation', 'travel', 'เดินทาง', 'ค่าเดินทาง'],
  ['rent', 'ค่าเช่า'],
  ['salary', 'เงินเดือน'],
  ['health', 'สุขภาพ'],
  ['education', 'การศึกษา'],
  ['home', 'house', 'บ้าน'],
  ['other', 'others', 'อื่น ๆ', 'อื่นๆ'],
  ['internet', 'อินเทอร์เน็ต', 'อินเตอร์เน็ต'],
  ['bonus', 'โบนัส'],
  ['mortgage', 'สินเชื่อบ้าน'],
  ['credit card', 'บัตรเครดิต'],
]

function suggestionFor(value: string, targets: readonly MatchTarget[]): { target: MatchTarget; reason: string } | null {
  const key = normalizeKey(value)
  const group = SYNONYMS.find((words) => words.includes(key))
  if (group) {
    const target = targets.find((t) => group.includes(normalizeKey(t.name)))
    if (target) return { target, reason: 'synonym' }
  }
  if (key.length >= 3) {
    const partial = targets.filter((t) => {
      const name = normalizeKey(t.name)
      return name.length >= 3 && (name.includes(key) || key.includes(name))
    })
    if (partial.length === 1) return { target: partial[0]!, reason: 'partial' }
  }
  return null
}

/** Distinct non-empty source values (trimmed, original case), most frequent first. */
export function distinctValues(cells: readonly CellValue[]): { value: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const cell of cells) {
    if (isEmptyCell(cell)) continue
    const value = cellText(cell).trim()
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'th'))
}

export function matchValues(values: readonly { value: string; count: number }[], targets: readonly MatchTarget[]): ValueMatch[] {
  return values.map(({ value, count }) => {
    const exact = targets.filter((t) => normalizeKey(t.name) === normalizeKey(value))
    if (exact.length === 1) return { value, count, status: 'matched', targetId: exact[0]!.id }
    if (exact.length > 1) return { value, count, status: 'suggested', targetId: exact[0]!.id, reason: 'several_same_name' }
    const suggestion = suggestionFor(value, targets)
    if (suggestion) return { value, count, status: 'suggested', targetId: suggestion.target.id, reason: suggestion.reason }
    return { value, count, status: 'unmatched', targetId: null }
  })
}

/** Type column values: known words are matched to a kind; anything else is unmatched (user decides). */
export function matchTypeValues(values: readonly { value: string; count: number }[]): ValueMatch[] {
  return values.map(({ value, count }) => {
    const kind = kindFromWord(value)
    return kind ? { value, count, status: 'matched', targetId: kind, reason: 'known_word' } : { value, count, status: 'unmatched', targetId: null }
  })
}

/** Initial value mapping: only exact matches are applied. */
export const appliedTargets = (matches: readonly ValueMatch[]): Record<string, string | null> =>
  Object.fromEntries(matches.map((m) => [m.value, m.status === 'matched' ? m.targetId : null]))
