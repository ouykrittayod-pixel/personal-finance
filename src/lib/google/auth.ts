/**
 * Google sign-in for a browser-only app (OAuth 2.0 token by redirect).
 *
 * - Signing in leaves for Google's consent page and comes back to the app with
 *   an access token (see oauth-redirect). This works the same in Safari, in an
 *   app opened from the home screen, and in desktop browsers — no pop-up, so
 *   no pop-up blocker can get in the way.
 * - The token lasts about an hour. It is cached in localStorage so reloads
 *   within that hour need no new sign-in. When it expires, sync pauses and the
 *   app asks for one tap ("เชื่อมต่ออีกครั้ง"); the app keeps working from its
 *   cache meanwhile.
 * - There is no refresh token and no client secret anywhere (that would need a server).
 */
import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES, REQUIRED_SCOPES } from './config'
import { startRedirectSignIn } from './oauth-redirect'

const TOKEN_KEY = 'pf-google-token'
/** Treat a token as expired a little early, so a request never starts with one about to lapse. */
const EXPIRY_MARGIN_MS = 2 * 60_000

export type AuthErrorReason =
  /** No valid token: ask the user to tap and sign in. */
  | 'sign_in_required'
  /** The user declined on Google's page. */
  | 'cancelled'
  /** The user did not allow access to the app's Drive folder. */
  | 'scope_denied'
  /** Google could not be reached. */
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

/** The cached access token if it is still valid, else null. Never leaves the page. */
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
 * Keep a token that came back from Google. Returns an error code when the
 * user did not grant the app's Drive folder.
 */
export function storeRedirectToken(accessToken: string, expiresIn: number, scope: string): string | undefined {
  const granted = new Set(scope.split(/\s+/))
  if (!REQUIRED_SCOPES.every((s) => granted.has(s))) return 'scope_denied'
  const token = { accessToken, expiresAt: Date.now() + expiresIn * 1000 }
  memoryToken = token
  writeToken(token)
  return undefined
}

/**
 * Sign in: leaves for Google's page (call from a tap). The returned promise
 * never settles — the app reloads when Google sends the user back.
 */
export function requestAccessToken(options: { loginHint?: string; consent?: boolean } = {}): Promise<string> {
  return startRedirectSignIn({ clientId: GOOGLE_CLIENT_ID, scopes: GOOGLE_SCOPES, loginHint: options.loginHint, consent: options.consent })
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
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: token.accessToken }),
    })
  } catch {
    // Offline: the token expires by itself within the hour.
  }
}
