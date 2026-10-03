/**
 * Phase 19 key management (first version — NOT the final recovery design).
 *
 * - The data encryption key (DEK) is a random AES-256-GCM key made by Web Crypto.
 * - It is stored only WRAPPED: encrypted (AES-256-GCM) with a key derived from
 *   the user's encryption passphrase by PBKDF2-SHA-256 (random 16-byte salt,
 *   ≥ 600,000 iterations by default).
 * - The passphrase is separate from sign-in (email one-time code). It is never
 *   stored, never sent anywhere, and never derived from auth credentials.
 * - Unwrapped keys are non-extractable CryptoKeys that live in memory only.
 *
 * Not yet: recovery key, key rotation, device enrollment (later phases).
 */
import { fromBase64Url, toBase64Url } from './base64url'
import type { DataKey } from './envelope'

export const WRAPPED_KEY_VERSION = 1
export const DEFAULT_PBKDF2_ITERATIONS = 600_000
/** A stored record asking for fewer iterations is refused (downgrade protection). */
export const MIN_PBKDF2_ITERATIONS = 100_000
export const MIN_PASSPHRASE_LENGTH = 12

export interface WrappedKey {
  kid: string
  version: typeof WRAPPED_KEY_VERSION
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string }
  wrap: { alg: 'A256GCM'; iv: string; ct: string }
  createdAt: string
}

export class WeakPassphraseError extends Error {
  constructor() {
    super('Passphrase too short')
    this.name = 'WeakPassphraseError'
  }
}
export class WrongPassphraseError extends Error {
  constructor() {
    super('Wrong passphrase or damaged key')
    this.name = 'WrongPassphraseError'
  }
}
export class InvalidWrappedKeyError extends Error {
  constructor() {
    super('Stored key record is not valid')
    this.name = 'InvalidWrappedKeyError'
  }
}

const normalize = (passphrase: string) => passphrase.normalize('NFKC')

export function checkPassphrase(passphrase: string): void {
  if ([...normalize(passphrase).trim()].length < MIN_PASSPHRASE_LENGTH) throw new WeakPassphraseError()
}

async function deriveWrappingKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(normalize(passphrase)), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, { name: 'AES-GCM', length: 256 }, false, [
    'wrapKey',
    'unwrapKey',
  ])
}

const wrapAad = (kid: string) => new TextEncoder().encode(`pf-dek:${WRAPPED_KEY_VERSION}:${kid}`)

/** A new random data key, returned unlocked (non-extractable) together with its wrapped form for storage. */
export async function createWrappedKey(
  passphrase: string,
  options: { iterations?: number; now?: string; kid?: string } = {},
): Promise<{ wrapped: WrappedKey; dataKey: DataKey }> {
  checkPassphrase(passphrase)
  const iterations = options.iterations ?? DEFAULT_PBKDF2_ITERATIONS
  if (iterations < MIN_PBKDF2_ITERATIONS) throw new InvalidWrappedKeyError()
  const kid = options.kid ?? crypto.randomUUID()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  // Extractable only for the moment it takes to wrap it; the copy we keep is not.
  const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  const kek = await deriveWrappingKey(passphrase, salt, iterations)
  const ct = await crypto.subtle.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv, additionalData: wrapAad(kid) })
  const wrapped: WrappedKey = {
    kid,
    version: WRAPPED_KEY_VERSION,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64Url(salt) },
    wrap: { alg: 'A256GCM', iv: toBase64Url(iv), ct: toBase64Url(new Uint8Array(ct)) },
    createdAt: options.now ?? new Date().toISOString(),
  }
  return { wrapped, dataKey: await unwrapKey(wrapped, passphrase) }
}

export function validateWrappedKey(raw: unknown): WrappedKey {
  const w = raw as WrappedKey | undefined
  const ok =
    !!w &&
    w.version === WRAPPED_KEY_VERSION &&
    typeof w.kid === 'string' &&
    w.kdf?.name === 'PBKDF2' &&
    w.kdf.hash === 'SHA-256' &&
    Number.isSafeInteger(w.kdf.iterations) &&
    w.kdf.iterations >= MIN_PBKDF2_ITERATIONS &&
    fromBase64Url(w.kdf.salt)?.length === 16 &&
    w.wrap?.alg === 'A256GCM' &&
    fromBase64Url(w.wrap.iv)?.length === 12 &&
    (fromBase64Url(w.wrap.ct)?.length ?? 0) === 48
  if (!ok) throw new InvalidWrappedKeyError()
  return w
}

/** Unlocks a stored key. The result is a non-extractable key: it can encrypt and decrypt, never be exported. */
export async function unwrapKey(raw: unknown, passphrase: string): Promise<DataKey> {
  const wrapped = validateWrappedKey(raw)
  const kek = await deriveWrappingKey(passphrase, fromBase64Url(wrapped.kdf.salt)!, wrapped.kdf.iterations)
  try {
    const key = await crypto.subtle.unwrapKey(
      'raw',
      fromBase64Url(wrapped.wrap.ct)!,
      kek,
      { name: 'AES-GCM', iv: fromBase64Url(wrapped.wrap.iv)!, additionalData: wrapAad(wrapped.kid) },
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
    return { kid: wrapped.kid, key }
  } catch {
    throw new WrongPassphraseError()
  }
}
