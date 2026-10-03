/**
 * The in-memory key vault: whether this device has an encryption key and
 * whether it is unlocked right now. The only persisted item is the WRAPPED key
 * (via the injected store); the unlocked key lives in this object only.
 *
 * lock() drops the only reference to the CryptoKey. JavaScript cannot zero
 * memory, and a non-extractable CryptoKey's bytes are held by the browser, so
 * "destroyed" means unreachable and garbage-collectable — not wiped.
 */
import type { DataKey } from './envelope'
import { createWrappedKey, unwrapKey, validateWrappedKey, type WrappedKey } from './keyring'

export type VaultStatus = 'unknown' | 'none' | 'locked' | 'unlocked'

export interface WrappedKeyStore {
  load(): Promise<WrappedKey | undefined>
  save(wrapped: WrappedKey): Promise<void>
  remove(): Promise<void>
}

export class VaultLockedError extends Error {
  constructor() {
    super('Encryption key is locked')
    this.name = 'VaultLockedError'
  }
}
export class KeyAlreadyExistsError extends Error {
  constructor() {
    super('This device already has an encryption key')
    this.name = 'KeyAlreadyExistsError'
  }
}

export interface VaultSnapshot {
  status: VaultStatus
  kid: string | null
}

export function createKeyVault(store: WrappedKeyStore, options: { iterations?: number } = {}) {
  let snapshot: VaultSnapshot = { status: 'unknown', kid: null }
  let dataKey: DataKey | null = null
  const listeners = new Set<() => void>()
  const set = (next: VaultSnapshot) => {
    snapshot = next
    for (const listener of listeners) listener()
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    /** Reads whether a wrapped key exists (keeps an unlocked key unlocked). */
    async refresh(): Promise<VaultSnapshot> {
      const stored = await store.load()
      if (!stored) {
        dataKey = null
        set({ status: 'none', kid: null })
      } else if (!dataKey || dataKey.kid !== stored.kid) {
        dataKey = null
        set({ status: 'locked', kid: validateWrappedKey(stored).kid })
      }
      return snapshot
    },

    /** Creates this device's key (only if none exists) and leaves it unlocked. */
    async setup(passphrase: string): Promise<void> {
      if (await store.load()) throw new KeyAlreadyExistsError()
      const { wrapped, dataKey: fresh } = await createWrappedKey(passphrase, { iterations: options.iterations })
      await store.save(wrapped)
      dataKey = fresh
      set({ status: 'unlocked', kid: fresh.kid })
    },

    async unlock(passphrase: string): Promise<void> {
      const stored = await store.load()
      if (!stored) {
        set({ status: 'none', kid: null })
        throw new VaultLockedError()
      }
      dataKey = await unwrapKey(stored, passphrase)
      set({ status: 'unlocked', kid: dataKey.kid })
    },

    lock(): void {
      dataKey = null
      if (snapshot.status === 'unlocked') set({ status: 'locked', kid: snapshot.kid })
    },

    /** The unlocked key, or VaultLockedError. */
    current(): DataKey {
      if (!dataKey) throw new VaultLockedError()
      return dataKey
    },

    /** DEV ONLY: forget this device's key. Anything encrypted with it becomes unreadable. */
    async destroy(): Promise<void> {
      dataKey = null
      await store.remove()
      set({ status: 'none', kid: null })
    },
  }
}

export type KeyVault = ReturnType<typeof createKeyVault>
