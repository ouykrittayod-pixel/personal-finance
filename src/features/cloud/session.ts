/**
 * Cloud sign-in state (Phase 19): email one-time code / magic link only.
 *
 * Sign-in is OPTIONAL. Nothing local depends on it — accounts, expenses,
 * debts, backup and offline use work the same signed in, signed out, or with
 * no cloud configured at all. Signing out never deletes local data; it locks
 * the encryption key (onSignedOut).
 *
 * The store talks to Supabase through a small AuthPort so it can be tested
 * without a network; supabaseAuthPort adapts the real client.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type CloudStatus = 'unconfigured' | 'loading' | 'signed_out' | 'code_sent' | 'signed_in' | 'error'
export type CloudErrorCode = 'offline' | 'invalid_email' | 'invalid_code' | 'rate_limited' | 'session_expired' | 'unavailable'

export interface CloudUser {
  id: string
  email: string | null
}

export interface CloudSessionState {
  status: CloudStatus
  user: CloudUser | null
  /** Where the code was sent (status code_sent). */
  email: string | null
  error: CloudErrorCode | null
  busy: boolean
}

export interface AuthSession {
  user: { id: string; email?: string | null }
  /** Seconds since epoch. */
  expires_at?: number
}

export type AuthEvent = 'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED' | 'PASSWORD_RECOVERY' | 'MFA_CHALLENGE_VERIFIED'

export interface AuthPort {
  getSession(): Promise<{ session: AuthSession | null; error: unknown }>
  onAuthStateChange(callback: (event: AuthEvent, session: AuthSession | null) => void): () => void
  signInWithOtp(email: string, redirectTo: string): Promise<{ error: unknown }>
  verifyOtp(email: string, token: string): Promise<{ session: AuthSession | null; error: unknown }>
  /** scope 'global' revokes the refresh token on the server; 'local' only forgets it here (works offline). */
  signOut(scope: 'global' | 'local'): Promise<{ error: unknown }>
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CODE = /^\d{6,10}$/

/** Maps Supabase / fetch errors to a small set of codes. Never exposes raw server messages. */
export function classifyAuthError(error: unknown): CloudErrorCode {
  const e = error as { name?: string; status?: number; code?: string; message?: string } | null
  if (!e) return 'unavailable'
  if (e.name === 'AuthRetryableFetchError' || e.name === 'TypeError' || e.status === 0 || /fetch|network/i.test(e.message ?? '')) return 'offline'
  if (e.status === 429 || e.code === 'over_email_send_rate_limit' || e.code === 'over_request_rate_limit') return 'rate_limited'
  if (e.code === 'otp_expired' || e.code === 'invalid_credentials' || /token has expired|invalid/i.test(e.message ?? '')) return 'invalid_code'
  if (e.code === 'session_expired' || e.code === 'refresh_token_not_found' || e.code === 'session_not_found') return 'session_expired'
  return 'unavailable'
}

const toUser = (session: AuthSession): CloudUser => ({ id: session.user.id, email: session.user.email ?? null })

export interface CloudSessionOptions {
  /** Null when the build has no (valid) cloud configuration. */
  loadAuth: (() => Promise<AuthPort>) | null
  redirectTo: () => string
  /** Called on every sign-out (user action, expiry, another tab): lock the key, stop cloud work. */
  onSignedOut: () => void
  now?: () => number
}

export function createCloudSession(options: CloudSessionOptions) {
  const now = options.now ?? Date.now
  let state: CloudSessionState = { status: options.loadAuth ? 'loading' : 'unconfigured', user: null, email: null, error: null, busy: false }
  let auth: Promise<AuthPort> | null = null
  let started: Promise<void> | null = null
  const listeners = new Set<() => void>()
  const set = (patch: Partial<CloudSessionState>) => {
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }
  const signedOut = (error: CloudErrorCode | null = null) => {
    options.onSignedOut()
    set({ status: 'signed_out', user: null, email: null, error, busy: false })
  }
  const port = () => {
    if (!options.loadAuth) throw new Error('cloud not configured')
    auth ??= options.loadAuth()
    return auth
  }
  const expired = (session: AuthSession) => session.expires_at !== undefined && session.expires_at * 1000 <= now()

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    /** Restores a saved session and starts listening for changes. Idempotent; a no-op without configuration. */
    start(): Promise<void> {
      if (!options.loadAuth) return Promise.resolve()
      started ??= (async () => {
        try {
          const a = await port()
          a.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_OUT' || !session) {
              // Refresh token rejected, signed out in another tab, or explicit sign-out.
              if (state.status === 'signed_in') signedOut(event === 'SIGNED_OUT' ? null : 'session_expired')
              return
            }
            if (!expired(session)) set({ status: 'signed_in', user: toUser(session), email: null, error: null })
          })
          const { session, error } = await a.getSession()
          if (error) {
            const code = classifyAuthError(error)
            // Offline: whatever is stored stays stored; cloud is just unavailable for now.
            if (code === 'offline') set({ status: 'error', error: 'offline' })
            else signedOut(code === 'unavailable' ? 'session_expired' : code)
          } else if (!session) {
            if (state.status === 'loading') set({ status: 'signed_out', error: null })
          } else if (expired(session)) {
            await a.signOut('local')
            signedOut('session_expired')
          } else set({ status: 'signed_in', user: toUser(session), error: null })
        } catch (error) {
          set({ status: 'error', error: classifyAuthError(error) })
          started = null
        }
      })()
      return started
    },

    /** Sends the email with the one-time code / magic link. Creates the account on first use. */
    async requestCode(email: string): Promise<boolean> {
      const address = email.trim().toLowerCase()
      if (!EMAIL.test(address)) {
        set({ error: 'invalid_email' })
        return false
      }
      set({ busy: true, error: null })
      try {
        const { error } = await (await port()).signInWithOtp(address, options.redirectTo())
        if (error) {
          set({ busy: false, error: classifyAuthError(error) })
          return false
        }
        set({ status: 'code_sent', email: address, busy: false })
        return true
      } catch (error) {
        set({ busy: false, error: classifyAuthError(error) })
        return false
      }
    },

    async verifyCode(code: string): Promise<boolean> {
      const token = code.replace(/\s/g, '')
      if (!state.email || !CODE.test(token)) {
        set({ error: 'invalid_code' })
        return false
      }
      set({ busy: true, error: null })
      try {
        const { session, error } = await (await port()).verifyOtp(state.email, token)
        if (error || !session) {
          set({ busy: false, error: error ? classifyAuthError(error) : 'invalid_code' })
          return false
        }
        set({ status: 'signed_in', user: toUser(session), email: null, busy: false, error: null })
        return true
      } catch (error) {
        set({ busy: false, error: classifyAuthError(error) })
        return false
      }
    },

    cancelCode() {
      if (state.status === 'code_sent') set({ status: 'signed_out', email: null, error: null })
    },

    /**
     * Signs out: revokes the session on the server when online, otherwise
     * forgets it locally. Always ends signed out with the key locked.
     * Local finance data is never touched.
     */
    async signOut(): Promise<void> {
      set({ busy: true })
      try {
        const a = await port()
        const { error } = await a.signOut('global')
        if (error) await a.signOut('local')
      } catch {
        try {
          await (await port()).signOut('local')
        } catch {
          // Nothing more we can do; the in-memory state is cleared below regardless.
        }
      }
      signedOut()
    },
  }
}

export type CloudSession = ReturnType<typeof createCloudSession>

/** Adapts the Supabase client to AuthPort. */
export function supabaseAuthPort(client: SupabaseClient): AuthPort {
  return {
    async getSession() {
      const { data, error } = await client.auth.getSession()
      return { session: data.session, error }
    },
    onAuthStateChange(callback) {
      const { data } = client.auth.onAuthStateChange((event, session) => callback(event as AuthEvent, session))
      return () => data.subscription.unsubscribe()
    },
    async signInWithOtp(email, redirectTo) {
      const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: true } })
      return { error }
    },
    async verifyOtp(email, token) {
      const { data, error } = await client.auth.verifyOtp({ email, token, type: 'email' })
      return { session: data.session, error }
    },
    async signOut(scope) {
      const { error } = await client.auth.signOut({ scope })
      return { error }
    },
  }
}
