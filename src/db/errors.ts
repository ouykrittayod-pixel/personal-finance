/**
 * Storage failures translated into a small set of kinds the UI can explain.
 * Raw Dexie/IndexedDB messages are kept for logs but never shown to the user.
 */
export type StorageErrorKind = 'storage_full' | 'attachment' | 'database'

export class StorageError extends Error {
  readonly kind: StorageErrorKind
  constructor(kind: StorageErrorKind, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause })
    this.name = 'StorageError'
    this.kind = kind
  }
}

function isQuotaError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const names = [error.name, (error as { inner?: Error }).inner?.name]
  return names.includes('QuotaExceededError')
}

export function toStorageError(error: unknown, fallback: StorageErrorKind = 'database'): StorageError {
  if (error instanceof StorageError) return error
  return new StorageError(isQuotaError(error) ? 'storage_full' : fallback, error)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ErrorClass = abstract new (...args: any[]) => Error

/**
 * Dexie wraps errors thrown inside a transaction callback. Re-throw our own
 * (known) errors unwrapped; map anything else to a StorageError.
 */
export function rethrowStorage(error: unknown, known: readonly ErrorClass[]): never {
  const isKnown = (value: unknown) => value instanceof StorageError || known.some((type) => value instanceof type)
  const inner = (error as { inner?: unknown } | null)?.inner
  const cause = isKnown(inner) ? inner : error
  if (isKnown(cause)) throw cause
  throw toStorageError(cause)
}
