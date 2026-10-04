/**
 * Google Drive connection and automatic sync for this device.
 *
 * States the UI shows:
 * - unconfigured: no Google Client ID in this build → the app keeps data in this browser only.
 * - not_linked: this device has never connected → the app asks to connect before anything else.
 * - connecting / syncing / synced: normal operation.
 * - needs_sign_in: the hour-long Google token expired → one tap reconnects; the app keeps working from its cache.
 * - offline: no network → changes wait and go up automatically when back online.
 * - error: Drive refused or the data file is unusable (details on the Drive card).
 *
 * Sync runs on start, a few seconds after every local change, when the app
 * comes back to the foreground or online, and every few minutes while open.
 */
import { liveQuery } from 'dexie'
import type { FinanceDatabase } from '@/db/dexie'
import { createMetaRepository, createScheduledPaymentsRepository, META_KEYS } from '@/db/repositories'
import { clearLocalCache } from '@/db/sync/drive-local'
import { todayISO } from '@/lib/dates'
import { GoogleAuthError, type GoogleUser } from '@/lib/google/auth'
import { OfflineError } from './google-drive-store'
import { RemoteFormatError } from './remote-format'
import { syncOnce, type RemoteStore } from './sync-engine'

export type DriveStatus = 'unconfigured' | 'not_linked' | 'connecting' | 'syncing' | 'synced' | 'needs_sign_in' | 'offline' | 'error'

export type DriveErrorCode =
  | 'cancelled'
  | 'scope_denied'
  | 'unavailable'
  | 'offline'
  | 'newer_app'
  | 'invalid_file'
  | 'other_account_pending'
  | 'failed'

/** Persisted per device in `meta` (never synced, never in backups). */
export interface DriveLink {
  sub: string
  email: string
  linkedAt: string
  remoteVersion: string | null
  lastSyncAt: string | null
  /** Set after a backup restore: the next sync replaces Drive's data with this device's. */
  replaceRemote?: boolean
  /** Some receipt files did not move last time: do not skip the next pass. */
  retryAttachments?: boolean
}

export interface DriveState {
  status: DriveStatus
  email: string | null
  lastSyncAt: string | null
  /** Local changes not yet in Drive. */
  pending: number
  error: DriveErrorCode | null
  busy: boolean
}

/** What the controller needs from Google (real: lib/google/auth; tests: a fake). */
export interface DriveAuth {
  /** Valid cached token or null; never opens a pop-up. */
  currentToken(): string | null
  /** Opens Google's pop-up (call from a tap). */
  signIn(loginHint?: string): Promise<string>
  user(token: string): Promise<GoogleUser>
  signOut(): Promise<void>
}

export interface DriveSyncOptions {
  database: FinanceDatabase
  configured: boolean
  auth: DriveAuth
  /** Builds the Drive store for a device; `getToken` throws GoogleAuthError when a tap is needed. */
  createStore: (getToken: () => Promise<string>, deviceId: string) => RemoteStore
  now?: () => string
  /** Delay before syncing after a local change. */
  debounceMs?: number
  /** Background sync interval while the app is visible. */
  intervalMs?: number
}

export function createDriveSync(options: DriveSyncOptions) {
  const { database, auth } = options
  const meta = createMetaRepository(database)
  const now = options.now ?? (() => new Date().toISOString())
  const debounceMs = options.debounceMs ?? 2500
  const intervalMs = options.intervalMs ?? 3 * 60_000

  let state: DriveState = { status: options.configured ? 'connecting' : 'unconfigured', email: null, lastSyncAt: null, pending: 0, error: null, busy: false }
  const listeners = new Set<() => void>()
  const set = (patch: Partial<DriveState>) => {
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }

  let running: Promise<void> | null = null
  let again = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopTriggers: (() => void) | null = null

  const readLink = () => meta.get<DriveLink>(META_KEYS.drive)
  const writeLink = (link: DriveLink) => meta.set(META_KEYS.drive, link)
  const deviceId = async () => (await database.syncSettings.get('device'))?.deviceId ?? 'unknown-device'

  async function getToken(): Promise<string> {
    const token = auth.currentToken()
    if (!token) throw new GoogleAuthError('sign_in_required')
    return token
  }

  function failure(error: unknown): Partial<DriveState> {
    if (error instanceof GoogleAuthError) {
      if (error.reason === 'sign_in_required') return { status: 'needs_sign_in', error: null }
      return { status: state.status === 'connecting' ? 'not_linked' : 'needs_sign_in', error: error.reason }
    }
    if (error instanceof OfflineError || (typeof navigator !== 'undefined' && navigator.onLine === false)) return { status: 'offline', error: null }
    if (error instanceof RemoteFormatError) return { status: 'error', error: error.reason === 'newer_app' ? 'newer_app' : 'invalid_file' }
    return { status: 'error', error: 'failed' }
  }

  async function runSync(): Promise<void> {
    const link = await readLink()
    if (!link) return
    set({ status: 'syncing', busy: true })
    try {
      const store = options.createStore(getToken, await deviceId())
      const result = await syncOnce(database, store, {
        now,
        lastVersion: link.retryAttachments ? null : link.remoteVersion,
        replaceRemote: link.replaceRemote,
      })
      const stamp = now()
      const { replaceRemote: _done, ...rest } = link
      await writeLink({ ...rest, remoteVersion: result.version, lastSyncAt: stamp, retryAttachments: result.attachmentsFailed > 0 })
      // New rules or payments from another device: bring scheduled occurrences up to date here too.
      if (result.downloaded > 0)
        await createScheduledPaymentsRepository(database)
          .generateMissing(todayISO(), { now: stamp, newId: () => crypto.randomUUID() })
          .catch(() => undefined)
      set({ status: 'synced', lastSyncAt: stamp, error: null, busy: false })
    } catch (error) {
      if (error instanceof GoogleAuthError || error instanceof OfflineError) console.info('Drive sync paused:', error.name)
      else console.error('Drive sync failed', error instanceof Error ? error.message : error)
      set({ ...failure(error), busy: false })
    }
  }

  /** Sync now (single flight: a request during a pass runs one more pass afterwards). */
  function sync(): Promise<void> {
    if (state.status === 'unconfigured' || state.status === 'not_linked') return Promise.resolve()
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      do {
        again = false
        await runSync()
      } while (again && state.status === 'synced')
    })().finally(() => {
      running = null
    })
    return running
  }

  function schedule(delay = debounceMs) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void sync()
    }, delay)
  }

  function startTriggers() {
    if (stopTriggers || typeof window === 'undefined') return
    const onOnline = () => void sync()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void sync()
    }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void sync()
    }, intervalMs)
    let first = true
    const subscription = liveQuery(() => database.syncOutbox.count()).subscribe({
      next: (count) => {
        set({ pending: count })
        if (!first && count > 0) schedule()
        first = false
      },
      error: () => undefined,
    })
    stopTriggers = () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(interval)
      subscription.unsubscribe()
      stopTriggers = null
    }
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    /** Read this device's link and start syncing (no pop-up). */
    async start(): Promise<void> {
      if (!options.configured) return
      const link = await readLink()
      if (!link) {
        set({ status: 'not_linked', email: null, lastSyncAt: null, error: null })
        return
      }
      set({ status: 'synced', email: link.email, lastSyncAt: link.lastSyncAt, pending: await database.syncOutbox.count() })
      startTriggers()
      await sync()
    },

    /**
     * Connect this device to a Google account (from a tap). A device that held
     * another account's data empties its cache first; it refuses if that data
     * still has changes that never reached Drive.
     */
    async connect(): Promise<boolean> {
      const previous = await readLink()
      set({ status: previous ? state.status : 'connecting', busy: true, error: null })
      try {
        const token = await auth.signIn(previous?.email || undefined)
        const user = await auth.user(token)
        if (previous && previous.sub !== user.sub) {
          if ((await database.syncOutbox.count()) > 0) {
            await auth.signOut()
            set({ status: previous ? 'needs_sign_in' : 'not_linked', busy: false, error: 'other_account_pending' })
            return false
          }
          await clearLocalCache(database)
        }
        const keep = previous && previous.sub === user.sub ? previous : null
        await writeLink({
          sub: user.sub,
          email: user.email,
          linkedAt: keep?.linkedAt ?? now(),
          remoteVersion: keep?.remoteVersion ?? null,
          lastSyncAt: keep?.lastSyncAt ?? null,
          ...(keep?.replaceRemote ? { replaceRemote: true } : {}),
        })
        set({ status: 'syncing', email: user.email, error: null })
        startTriggers()
        await sync()
        set({ busy: false })
        return state.status === 'synced'
      } catch (error) {
        set({ ...failure(error), status: previous ? 'needs_sign_in' : 'not_linked', busy: false })
        return false
      }
    },

    sync,

    /** After restoring a backup: the restored data replaces what is in Drive (and on other devices). */
    async replaceRemoteWithLocal(): Promise<void> {
      const link = await readLink()
      if (!link) return
      await writeLink({ ...link, replaceRemote: true })
      await sync()
    },

    /**
     * Disconnect this device: revoke access and delete the cache (the data stays
     * in Drive). Callers confirm first when `pending > 0` — those changes are lost.
     */
    async signOut(): Promise<void> {
      set({ busy: true })
      stopTriggers?.()
      if (timer) clearTimeout(timer)
      await running?.catch(() => undefined)
      await auth.signOut().catch(() => undefined)
      await clearLocalCache(database)
      set({ status: 'not_linked', email: null, lastSyncAt: null, pending: 0, error: null, busy: false })
    },

    /** Tests: stop timers and listeners. */
    dispose() {
      stopTriggers?.()
      if (timer) clearTimeout(timer)
    },
  }
}

export type DriveSync = ReturnType<typeof createDriveSync>
