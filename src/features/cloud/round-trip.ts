/**
 * Phase 19 proof, SYNTHETIC data only:
 *   plaintext → encrypt locally → upload ciphertext → download → decrypt locally → exact equality → delete.
 * Returns counts only (nothing about the data itself).
 */
import { fromBase64Url } from '@/lib/crypto/base64url'
import type { DataKey } from '@/lib/crypto/envelope'
import { decryptFromCloud, encryptForCloud, type CloudRow, type EncryptedRecordStore } from './encrypted-records'
import type { SyntheticItem } from './synthetic'

export interface RoundTripReport {
  uploaded: number
  downloaded: number
  matched: number
  mismatched: number
  /** Plaintext values or field names found in the opaque part of an uploaded row. Must be 0. */
  plaintextLeaks: number
  removed: number
  remainingAfterCleanup: number
}

/** Stable JSON (sorted keys) for exact structural comparison. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  )
}

/** Every plaintext string leaf (≥ 4 characters) and every field name of the record. */
function plaintextNeedles(value: unknown, out = new Set<string>()): Set<string> {
  if (typeof value === 'string' && value.length >= 4) out.add(value)
  else if (typeof value === 'number' && String(value).length >= 4) out.add(String(value))
  else if (Array.isArray(value)) value.forEach((v) => plaintextNeedles(v, out))
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) {
      if (k.length >= 4) out.add(`"${k}"`)
      plaintextNeedles(v, out)
    }
  return out
}

const indexOfBytes = (haystack: Uint8Array, needle: Uint8Array) => {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

/**
 * How many plaintext values of `value` are visible in the outgoing row.
 * Routing columns (user_id, record_type, record_id) are routing by design;
 * everything else must be opaque: the decoded IV and ciphertext bytes are
 * searched for the UTF-8 bytes of every plaintext string, number and field
 * name, and the key id must not be one of them.
 */
export function countPlaintextLeaks(row: CloudRow, value: unknown): number {
  const opaque = [fromBase64Url(String(row.iv)), fromBase64Url(String(row.ciphertext))]
  if (opaque.some((bytes) => bytes === null)) return Number.POSITIVE_INFINITY
  const utf8 = new TextEncoder()
  let leaks = 0
  for (const needle of plaintextNeedles(value)) {
    const bytes = utf8.encode(needle)
    if (String(row.key_id).includes(needle) || opaque.some((b) => indexOfBytes(b!, bytes) >= 0)) leaks++
  }
  return leaks
}

export async function runSyntheticRoundTrip(args: {
  store: EncryptedRecordStore
  key: DataKey
  userId: string
  items: readonly SyntheticItem[]
}): Promise<RoundTripReport> {
  const { store, key, userId, items } = args
  for (const item of items) if (!item.recordType.startsWith('synthetic_')) throw new Error('synthetic data only')
  const types = [...new Set(items.map((i) => i.recordType))]

  const rows: CloudRow[] = []
  let plaintextLeaks = 0
  for (const item of items) {
    const row = await encryptForCloud(key, { userId, recordType: item.recordType, recordId: item.recordId }, item.value)
    plaintextLeaks += countPlaintextLeaks(row, item.value)
    rows.push(row)
  }
  if (plaintextLeaks > 0) throw new Error('plaintext found in an outgoing row — nothing uploaded')

  let removed = 0
  try {
    await store.upsert(rows)
    const downloaded = await store.list(types)
    const byKey = new Map(downloaded.map((row) => [`${row.record_type}/${row.record_id}`, row]))
    let matched = 0
    for (const item of items) {
      const row = byKey.get(`${item.recordType}/${item.recordId}`)
      if (row && canonicalJson(await decryptFromCloud(key, row)) === canonicalJson(item.value)) matched++
    }
    removed = await store.remove(types)
    const remaining = (await store.list(types)).length
    return {
      uploaded: rows.length,
      downloaded: downloaded.length,
      matched,
      mismatched: items.length - matched,
      plaintextLeaks,
      removed,
      remainingAfterCleanup: remaining,
    }
  } catch (error) {
    // Best effort: never leave synthetic rows behind.
    if (removed === 0) await store.remove(types).catch(() => 0)
    throw error
  }
}
