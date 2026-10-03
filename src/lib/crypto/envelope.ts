/**
 * Encrypted record envelope (format version 1). Web Crypto only — no custom
 * cryptography.
 *
 *   { v: 1, alg: "A256GCM", kid: "<key id>", iv: "<base64url, 12 bytes>", ct: "<base64url ciphertext + 16-byte tag>" }
 *
 * - AES-256-GCM, a fresh random 96-bit IV for every encryption (never reused).
 * - The plaintext is the record serialized as JSON (UTF-8).
 * - Additional authenticated data (not stored, recomputed on decrypt) binds the
 *   ciphertext to its context: format version, algorithm, key id, user id,
 *   record type and record id. A ciphertext moved to another row, user or key
 *   fails to decrypt instead of silently decrypting as the wrong record.
 * - Any change to ct, iv, kid or the context makes decryption fail (GCM tag).
 */
import { fromBase64Url, toBase64Url } from './base64url'

export const ENVELOPE_VERSION = 1
export const ENVELOPE_ALGORITHM = 'A256GCM'
const IV_BYTES = 12
const TAG_BYTES = 16

export interface EncryptedEnvelope {
  v: typeof ENVELOPE_VERSION
  alg: typeof ENVELOPE_ALGORITHM
  kid: string
  iv: string
  ct: string
}

/** Where a ciphertext belongs; authenticated, never encrypted or stored inside the envelope. */
export interface RecordContext {
  userId: string
  recordType: string
  recordId: string
}

/** An unlocked data key: a non-extractable AES-GCM CryptoKey and its id. */
export interface DataKey {
  kid: string
  key: CryptoKey
}

export class UnsupportedEnvelopeError extends Error {
  readonly reason: 'version' | 'algorithm' | 'shape'
  constructor(reason: 'version' | 'algorithm' | 'shape') {
    super(`Unsupported encrypted envelope (${reason})`)
    this.name = 'UnsupportedEnvelopeError'
    this.reason = reason
  }
}
export class WrongKeyError extends Error {
  constructor() {
    super('Envelope was encrypted with a different key')
    this.name = 'WrongKeyError'
  }
}
/** Authentication failed: wrong key, modified ciphertext/IV, or wrong context. Deliberately says no more. */
export class DecryptionError extends Error {
  constructor() {
    super('Decryption failed')
    this.name = 'DecryptionError'
  }
}
export class NotSerializableError extends Error {
  constructor() {
    super('Value cannot be serialized as JSON')
    this.name = 'NotSerializableError'
  }
}

const utf8 = new TextEncoder()

function additionalData(kid: string, context: RecordContext): Uint8Array<ArrayBuffer> {
  return utf8.encode(JSON.stringify(['pf-record', ENVELOPE_VERSION, ENVELOPE_ALGORITHM, kid, context.userId, context.recordType, context.recordId]))
}

/** Encrypts any JSON value. `undefined`, functions, symbols and BigInts are refused, not silently dropped. */
export async function encryptRecord(dataKey: DataKey, context: RecordContext, value: unknown): Promise<EncryptedEnvelope> {
  let json: string | undefined
  try {
    json = JSON.stringify(value)
  } catch {
    throw new NotSerializableError()
  }
  if (json === undefined) throw new NotSerializableError()
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: additionalData(dataKey.kid, context), tagLength: 128 },
    dataKey.key,
    utf8.encode(json),
  )
  return { v: ENVELOPE_VERSION, alg: ENVELOPE_ALGORITHM, kid: dataKey.kid, iv: toBase64Url(iv), ct: toBase64Url(new Uint8Array(ct)) }
}

/** Validates the envelope's shape and version (no decryption). */
export function parseEnvelope(raw: unknown): EncryptedEnvelope {
  if (typeof raw !== 'object' || raw === null) throw new UnsupportedEnvelopeError('shape')
  const e = raw as Record<string, unknown>
  if (e.v !== ENVELOPE_VERSION) throw new UnsupportedEnvelopeError('version')
  if (e.alg !== ENVELOPE_ALGORITHM) throw new UnsupportedEnvelopeError('algorithm')
  const keys = Object.keys(e).sort().join(',')
  if (keys !== 'alg,ct,iv,kid,v' || typeof e.kid !== 'string' || !e.kid || typeof e.iv !== 'string' || typeof e.ct !== 'string')
    throw new UnsupportedEnvelopeError('shape')
  const iv = fromBase64Url(e.iv)
  const ct = fromBase64Url(e.ct)
  if (!iv || iv.length !== IV_BYTES || !ct || ct.length < TAG_BYTES) throw new UnsupportedEnvelopeError('shape')
  return { v: ENVELOPE_VERSION, alg: ENVELOPE_ALGORITHM, kid: e.kid, iv: e.iv, ct: e.ct }
}

export async function decryptRecord<T = unknown>(dataKey: DataKey, context: RecordContext, raw: unknown): Promise<T> {
  const envelope = parseEnvelope(raw)
  if (envelope.kid !== dataKey.kid) throw new WrongKeyError()
  let plain: ArrayBuffer
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(envelope.iv)!, additionalData: additionalData(envelope.kid, context), tagLength: 128 },
      dataKey.key,
      fromBase64Url(envelope.ct)!,
    )
  } catch {
    throw new DecryptionError()
  }
  return JSON.parse(new TextDecoder().decode(plain)) as T
}
