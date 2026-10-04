/**
 * Google sign-in by full-page redirect. Used everywhere: pop-ups are blocked
 * or cannot report back in Safari and in apps opened from the home screen.
 *
 * Flow: the app navigates to Google's consent page; Google sends the browser
 * back to the app's own address with the token in the URL fragment
 * (`#access_token=…&expires_in=…&state=…`). `captureOAuthRedirect` runs
 * before the router starts, keeps the token, and removes it from the address
 * bar. A random `state` (stored before leaving) proves the answer belongs to
 * a request this app made.
 *
 * The app's address must be listed under "Authorized redirect URIs" for the
 * OAuth client in Google Cloud Console.
 */
const STATE_KEY = 'pf-oauth-state'
const RESULT_KEY = 'pf-oauth-result'
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'

export type RedirectOutcome = { kind: 'token'; accessToken: string; expiresIn: number; scope: string } | { kind: 'error'; error: string }

/** The address Google sends the user back to (must match the registered redirect URI exactly). */
export const redirectUri = () => `${location.origin}${import.meta.env.BASE_URL}`

function safeStorage(): Storage | null {
  try {
    return localStorage
  } catch {
    return null
  }
}

/** Leave for Google's consent page. The returned promise never settles (the page unloads). */
export function startRedirectSignIn(options: { clientId: string; scopes: string[]; loginHint?: string; consent?: boolean }): Promise<never> {
  const state = crypto.randomUUID()
  safeStorage()?.setItem(STATE_KEY, state)
  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: options.scopes.join(' '),
    include_granted_scopes: 'true',
    state,
    prompt: options.consent ? 'consent' : 'select_account',
  })
  if (options.loginHint) params.set('login_hint', options.loginHint)
  location.assign(`${AUTH_ENDPOINT}?${params}`)
  return new Promise<never>(() => undefined)
}

/**
 * Read Google's answer from a URL fragment. Pure. Returns null when the
 * fragment is not an OAuth answer, or when its state does not match (an answer
 * this app did not ask for is ignored).
 */
export function parseOAuthFragment(fragment: string, expectedState: string | null): RedirectOutcome | null {
  const raw = fragment.startsWith('#') ? fragment.slice(1) : fragment
  if (!/(^|&)(access_token|error)=/.test(raw)) return null
  const params = new URLSearchParams(raw)
  if (!expectedState || params.get('state') !== expectedState) return null
  const error = params.get('error')
  if (error) return { kind: 'error', error }
  const accessToken = params.get('access_token')
  if (!accessToken) return null
  return { kind: 'token', accessToken, expiresIn: Number(params.get('expires_in') ?? 3600) || 3600, scope: params.get('scope') ?? '' }
}

/**
 * Run once at startup, before the router reads the address: take Google's
 * answer out of the URL. `onToken` stores the token; the outcome is kept for
 * the Drive connection to pick up.
 */
export function captureOAuthRedirect(onToken: (accessToken: string, expiresIn: number, scope: string) => string | undefined): void {
  if (typeof location === 'undefined') return
  const storage = safeStorage()
  const outcome = parseOAuthFragment(location.hash, storage?.getItem(STATE_KEY) ?? null)
  if (!outcome) return
  storage?.removeItem(STATE_KEY)
  const problem = outcome.kind === 'token' ? onToken(outcome.accessToken, outcome.expiresIn, outcome.scope) : outcome.error
  storage?.setItem(RESULT_KEY, problem ?? 'ok')
  // Never leave a token in the address bar or the history.
  history.replaceState(null, '', `${location.pathname}${location.search}#/`)
}

/** The result of a redirect sign-in that just came back ('ok' or Google's error code), once. */
export function takeRedirectResult(): string | null {
  const storage = safeStorage()
  const result = storage?.getItem(RESULT_KEY) ?? null
  if (result !== null) storage?.removeItem(RESULT_KEY)
  return result
}
