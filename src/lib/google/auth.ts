/**
 * Google sign-in for a browser-only app (Google Identity Services token model).
 *
 * - An access token lasts about an hour. It is cached in localStorage so a
 *   reload within that hour needs no new sign-in.
 * - A new token needs the Google pop-up, which browsers only allow right after
 *   a tap. So when the cached token has expired, sync pauses and the app asks
 *   for one tap ("เชื่อมต่ออีกครั้ง"); the app itself keeps working from the
 *   cache meanwhile.
 * - There is no refresh token and no client secret anywhere (that would need a server).
 */
import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES, REQUIRED_SCOPES } from './config'

const GIS_SRC = 'https://accounts.google.com/gsi/client'
const TOKEN_KEY = 'pf-google-token'
/** Treat a token as expired a little early, so a request never starts with one about to lapse. */
const EXPIRY_MARGIN_MS = 2 * 60_000

export type AuthErrorReason =
  /** No valid token and no tap to open the Google pop-up: ask the user. */
  | 'sign_in_required'
  /** The user closed the pop-up or declined. */
  | 'cancelled'
  /** The user did not allow access to the app's Drive folder. */
  | 'scope_denied'
  /** Google's sign-in script could not load (offline or blocked). */
  | 'unavailable'

export class GoogleAuthError extends Error {
  readonly reason: AuthErrorReason
  constructor(reason: AuthErrorReason) {
    super(`Google sign-in: ${reason}`)
    this.name = 'GoogleAuthError'
    this.reason = reason
  }
}

export interface GoogleUser {
  /** Stable Google account id. */
  sub: string
  email: string
}

interface StoredToken {
  accessToken: string
  expiresAt: number
}

interface TokenResponse {
  access_token?: string
  expires_in?: number | string
  scope?: string
  error?: string
}
interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string; login_hint?: string }): void
}
interface GoogleAccounts {
  oauth2: {
    initTokenClient(config: {
      client_id: string
      scope: string
      callback: (response: TokenResponse) => void
      error_callback?: (error: { type?: string }) => void
    }): TokenClient
    hasGrantedAllScopes(response: TokenResponse, ...scopes: string[]): boolean
    revoke(token: string, done?: () => void): void
  }
}
declare global {
  interface Window {
    google?: { accounts?: GoogleAccounts }
  }
}

function readToken(): StoredToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY)
    if (!raw) return null
    const token = JSON.parse(raw) as StoredToken
    return typeof token.accessToken === 'string' && typeof token.expiresAt === 'number' ? token : null
  } catch {
    return null
  }
}

function writeToken(token: StoredToken | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, JSON.stringify(token))
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Storage blocked: the token simply lives for this page only.
  }
}

let memoryToken: StoredToken | null = null
let gisLoading: Promise<GoogleAccounts> | null = null

function loadGis(): Promise<GoogleAccounts> {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google.accounts)
  gisLoading ??= new Promise<GoogleAccounts>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.onload = () => (window.google?.accounts?.oauth2 ? resolve(window.google.accounts) : reject(new GoogleAuthError('unavailable')))
    script.onerror = () => reject(new GoogleAuthError('unavailable'))
    document.head.append(script)
  }).catch((error: unknown) => {
    gisLoading = null
    throw error
  })
  return gisLoading
}

/** Load Google's script ahead of time, so the pop-up opens straight from the user's tap. */
export function preloadGoogleSignIn(): void {
  void loadGis().catch(() => undefined)
}

/** The cached access token if it is still valid, else null. Never opens a pop-up. */
export function currentAccessToken(now: number = Date.now()): string | null {
  const token = memoryToken ?? readToken()
  if (!token || token.expiresAt - EXPIRY_MARGIN_MS <= now) return null
  memoryToken = token
  return token.accessToken
}

/** Forget the cached token (e.g. Google answered 401). */
export function forgetAccessToken(): void {
  memoryToken = null
  writeToken(null)
}

/**
 * Open Google's pop-up and get a token. Must be called from a tap/click
 * handler (browsers block pop-ups otherwise).
 */
export async function requestAccessToken(options: { loginHint?: string; consent?: boolean } = {}): Promise<string> {
  const accounts = await loadGis()
  return new Promise<string>((resolve, reject) => {
    const client = accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GOOGLE_SCOPES.join(' '),
      callback: (response) => {
        if (response.error || !response.access_token) return reject(new GoogleAuthError(response.error === 'access_denied' ? 'cancelled' : 'sign_in_required'))
        if (!accounts.oauth2.hasGrantedAllScopes(response, ...REQUIRED_SCOPES)) return reject(new GoogleAuthError('scope_denied'))
        const token = { accessToken: response.access_token, expiresAt: Date.now() + Number(response.expires_in ?? 3600) * 1000 }
        memoryToken = token
        writeToken(token)
        resolve(token.accessToken)
      },
      error_callback: () => reject(new GoogleAuthError('cancelled')),
    })
    client.requestAccessToken({ prompt: options.consent ? 'consent' : '', ...(options.loginHint ? { login_hint: options.loginHint } : {}) })
  })
}

/** Which Google account the token belongs to. */
export async function fetchGoogleUser(accessToken: string): Promise<GoogleUser> {
  const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } })
  if (response.status === 401) {
    forgetAccessToken()
    throw new GoogleAuthError('sign_in_required')
  }
  if (!response.ok) throw new Error(`userinfo ${response.status}`)
  const body = (await response.json()) as { sub?: string; email?: string }
  if (!body.sub) throw new Error('userinfo without sub')
  return { sub: body.sub, email: body.email ?? '' }
}

/** Revoke the token at Google and forget it here. */
export async function revokeAccess(): Promise<void> {
  const token = memoryToken ?? readToken()
  forgetAccessToken()
  if (!token) return
  try {
    const accounts = await loadGis()
    await new Promise<void>((resolve) => accounts.oauth2.revoke(token.accessToken, resolve))
  } catch {
    // Offline: the token expires by itself within the hour.
  }
}
