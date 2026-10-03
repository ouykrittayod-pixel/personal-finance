/** Phase 19 — client-side encryption (Web Crypto). Synthetic values only. */
import { beforeAll, describe, expect, it } from 'vitest'
import { fromBase64Url, toBase64Url } from './base64url'
import {
  decryptRecord,
  DecryptionError,
  encryptRecord,
  NotSerializableError,
  parseEnvelope,
  UnsupportedEnvelopeError,
  WrongKeyError,
  type DataKey,
} from './envelope'
import {
  createWrappedKey,
  DEFAULT_PBKDF2_ITERATIONS,
  InvalidWrappedKeyError,
  MIN_PBKDF2_ITERATIONS,
  unwrapKey,
  WeakPassphraseError,
  WrongPassphraseError,
  type WrappedKey,
} from './keyring'
import { createKeyVault, KeyAlreadyExistsError, VaultLockedError, type WrappedKeyStore } from './vault'

const FAST = { iterations: MIN_PBKDF2_ITERATIONS }
const PASS = 'correct horse battery staple'
const ctx = { userId: 'aaaaaaaa-0000-4000-8000-000000000001', recordType: 'synthetic_expense', recordId: 'cccccccc-0000-4000-8000-000000000003' }
const SYNTHETIC = { type: 'expense', amount: 1250, category: 'food', note: 'Synthetic test record' }

let key: DataKey
let otherKey: DataKey
let wrapped: WrappedKey
beforeAll(async () => {
  ;({ dataKey: key, wrapped } = await createWrappedKey(PASS, FAST))
  ;({ dataKey: otherKey } = await createWrappedKey('a different passphrase', FAST))
})

/** Flips one bit of a base64url field. */
const flip = (text: string, at = 0) => {
  const bytes = fromBase64Url(text)!
  bytes[at] = bytes[at]! ^ 1
  return toBase64Url(bytes)
}

describe('base64url', () => {
  it('round-trips all byte values and rejects non-canonical text', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i)
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes)
    expect(toBase64Url(bytes)).toMatch(/^[A-Za-z0-9_-]+$/)
    for (const bad of ['a', 'ab=', 'ab+c', 'ab/c', 'AB', '?']) expect(fromBase64Url(bad)).toBeNull()
  })
})

describe('AES-256-GCM envelope', () => {
  it('encrypts and decrypts the synthetic record exactly', async () => {
    const envelope = await encryptRecord(key, ctx, SYNTHETIC)
    expect(Object.keys(envelope).sort()).toEqual(['alg', 'ct', 'iv', 'kid', 'v'])
    expect(envelope).toMatchObject({ v: 1, alg: 'A256GCM', kid: key.kid })
    expect(fromBase64Url(envelope.iv)).toHaveLength(12)
    expect(JSON.stringify(envelope)).not.toMatch(/expense|1250|food|Synthetic/)
    expect(await decryptRecord(key, ctx, envelope)).toEqual(SYNTHETIC)
  })

  it('uses a different random IV (and ciphertext) every time', async () => {
    const envelopes = await Promise.all(Array.from({ length: 200 }, () => encryptRecord(key, ctx, SYNTHETIC)))
    expect(new Set(envelopes.map((e) => e.iv)).size).toBe(200)
    expect(new Set(envelopes.map((e) => e.ct)).size).toBe(200)
  })

  it('fails with the wrong key (different key id)', async () => {
    const envelope = await encryptRecord(key, ctx, SYNTHETIC)
    await expect(decryptRecord(otherKey, ctx, envelope)).rejects.toThrow(WrongKeyError)
  })

  it('fails with the wrong key even if the key id is forged', async () => {
    const envelope = await encryptRecord(key, ctx, SYNTHETIC)
    await expect(decryptRecord({ kid: key.kid, key: otherKey.key }, ctx, envelope)).rejects.toThrow(DecryptionError)
  })

  it('fails when the ciphertext is modified (any byte, including the tag)', async () => {
    const envelope = await encryptRecord(key, ctx, SYNTHETIC)
    const length = fromBase64Url(envelope.ct)!.length
    for (const at of [0, Math.floor(length / 2), length - 1])
      await expect(decryptRecord(key, ctx, { ...envelope, ct: flip(envelope.ct, at) })).rejects.toThrow(DecryptionError)
    await expect(decryptRecord(key, ctx, { ...envelope, ct: toBase64Url(fromBase64Url(envelope.ct)!.slice(0, -1)) })).rejects.toThrow(DecryptionError)
  })

  it('fails when the IV is modified', async () => {
    const envelope = await encryptRecord(key, ctx, SYNTHETIC)
    await expect(decryptRecord(key, ctx, { ...envelope, iv: flip(envelope.iv) })).rejects.toThrow(DecryptionError)
  })

  it('is bound to its context: another user, record type or record id cannot decrypt it', async () => {
    const envelope = await encryptRecord(key, ctx, SYNTHETIC)
    for (const moved of [
      { ...ctx, userId: 'bbbbbbbb-0000-4000-8000-000000000002' },
      { ...ctx, recordType: 'synthetic_income' },
      { ...ctx, recordId: 'cccccccc-0000-4000-8000-000000000009' },
    ])
      await expect(decryptRecord(key, moved, envelope)).rejects.toThrow(DecryptionError)
  })

  it('refuses unsupported versions, algorithms and malformed envelopes safely', async () => {
    const envelope = await encryptRecord(key, ctx, SYNTHETIC)
    const reason = async (raw: unknown) =>
      decryptRecord(key, ctx, raw).then(
        () => 'decrypted',
        (e: unknown) => (e instanceof UnsupportedEnvelopeError ? e.reason : String(e)),
      )
    expect(await reason({ ...envelope, v: 2 })).toBe('version')
    expect(await reason({ ...envelope, v: '1' })).toBe('version')
    expect(await reason({ ...envelope, alg: 'A128GCM' })).toBe('algorithm')
    expect(await reason({ ...envelope, extra: 'plaintext' })).toBe('shape')
    expect(await reason({ ...envelope, iv: 'AAAA' })).toBe('shape')
    expect(await reason({ ...envelope, ct: 'not base64!' })).toBe('shape')
    expect(await reason({ ...envelope, kid: '' })).toBe('shape')
    expect(await reason(null)).toBe('shape')
    expect(await reason('{"v":1}')).toBe('shape')
    expect(() => parseEnvelope(envelope)).not.toThrow()
  })

  it('handles empty and plain values exactly', async () => {
    const values: unknown[] = [null, '', 0, -0.5, false, true, [], {}, 'ข้าวมันไก่ 🍗', [1, 'a', null], { nested: { deep: [{}] } }, 'x'.repeat(100_000)]
    for (const value of values) expect(await decryptRecord(key, ctx, await encryptRecord(key, ctx, value))).toEqual(value)
  })

  it('refuses values that JSON cannot represent instead of silently dropping them', async () => {
    for (const value of [undefined, () => 1, Symbol('s'), 10n]) await expect(encryptRecord(key, ctx, value)).rejects.toThrow(NotSerializableError)
  })
})

describe('key management (passphrase-wrapped data key)', () => {
  it('uses PBKDF2-SHA-256 with ≥ 600,000 iterations by default and a random salt', async () => {
    expect(DEFAULT_PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000)
    const second = await createWrappedKey(PASS, FAST)
    expect(second.wrapped.kdf.salt).not.toBe(wrapped.kdf.salt)
    expect(second.wrapped.kid).not.toBe(wrapped.kid)
  })

  it('the stored record holds only the wrapped key — never the passphrase or plain key', async () => {
    const text = JSON.stringify(wrapped)
    expect(text).not.toContain(PASS)
    expect(Object.keys(wrapped).sort()).toEqual(['createdAt', 'kdf', 'kid', 'version', 'wrap'])
    expect(fromBase64Url(wrapped.wrap.ct)).toHaveLength(48) // 32-byte key + 16-byte tag
  })

  it('unlocks with the right passphrase; the unlocked key cannot be exported', async () => {
    const unlocked = await unwrapKey(wrapped, PASS)
    expect(unlocked.kid).toBe(key.kid)
    expect(unlocked.key.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('raw', unlocked.key)).rejects.toThrow(/not extractable|extractable/i)
    expect(await decryptRecord(unlocked, ctx, await encryptRecord(key, ctx, SYNTHETIC))).toEqual(SYNTHETIC)
  })

  it('a wrong passphrase fails', async () => {
    await expect(unwrapKey(wrapped, `${PASS}!`)).rejects.toThrow(WrongPassphraseError)
  })

  it('a tampered key record fails (wrapped key, salt, key id, weak iteration count)', async () => {
    await expect(unwrapKey({ ...wrapped, wrap: { ...wrapped.wrap, ct: flip(wrapped.wrap.ct) } }, PASS)).rejects.toThrow(WrongPassphraseError)
    await expect(unwrapKey({ ...wrapped, kdf: { ...wrapped.kdf, salt: flip(wrapped.kdf.salt) } }, PASS)).rejects.toThrow(WrongPassphraseError)
    await expect(unwrapKey({ ...wrapped, kid: crypto.randomUUID() }, PASS)).rejects.toThrow(WrongPassphraseError)
    await expect(unwrapKey({ ...wrapped, kdf: { ...wrapped.kdf, iterations: 1_000 } }, PASS)).rejects.toThrow(InvalidWrappedKeyError)
    await expect(unwrapKey({ ...wrapped, version: 2 }, PASS)).rejects.toThrow(InvalidWrappedKeyError)
  })

  it('refuses short passphrases', async () => {
    for (const weak of ['', 'short', '           x', 'elevenchars']) await expect(createWrappedKey(weak, FAST)).rejects.toThrow(WeakPassphraseError)
  })
})

describe('key vault (locked / unlocked)', () => {
  const memoryStore = (): WrappedKeyStore & { saved: WrappedKey | undefined } => {
    const store = {
      saved: undefined as WrappedKey | undefined,
      load: async () => store.saved,
      save: async (w: WrappedKey) => {
        store.saved = w
      },
      remove: async () => {
        store.saved = undefined
      },
    }
    return store
  }

  it('none → setup (unlocked) → lock → unlock → destroy', async () => {
    const store = memoryStore()
    const vault = createKeyVault(store, FAST)
    expect((await vault.refresh()).status).toBe('none')
    expect(() => vault.current()).toThrow(VaultLockedError)
    await vault.setup(PASS)
    expect(vault.getSnapshot().status).toBe('unlocked')
    const kid = vault.current().kid
    await expect(vault.setup(PASS)).rejects.toThrow(KeyAlreadyExistsError)
    vault.lock()
    expect(vault.getSnapshot()).toEqual({ status: 'locked', kid })
    expect(() => vault.current()).toThrow(VaultLockedError)
    await expect(vault.unlock('wrong passphrase!!')).rejects.toThrow(WrongPassphraseError)
    expect(vault.getSnapshot().status).toBe('locked')
    await vault.unlock(PASS)
    expect(vault.current().kid).toBe(kid)
    await vault.destroy()
    expect(vault.getSnapshot().status).toBe('none')
    expect(store.saved).toBeUndefined()
  })

  it('a new vault instance (e.g. after reload) starts locked', async () => {
    const store = memoryStore()
    await createKeyVault(store, FAST).setup(PASS)
    const reloaded = createKeyVault(store, FAST)
    expect((await reloaded.refresh()).status).toBe('locked')
    expect(() => reloaded.current()).toThrow(VaultLockedError)
  })
})
