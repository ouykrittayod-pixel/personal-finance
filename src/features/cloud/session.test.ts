/** Phase 19 — sign-in state, with a fake auth backend (no network). */
import { describe, expect, it, vi } from 'vitest'
import { classifyAuthError, createCloudSession, type AuthEvent, type AuthPort, type AuthSession } from './session'

const NOW = Date.parse('2026-09-29T03:00:00Z')
const session = (expiresInSeconds = 3600): AuthSession => ({
  user: { id: 'aaaaaaaa-0000-4000-8000-000000000001', email: 'synthetic@example.test' },
  expires_at: NOW / 1000 + expiresInSeconds,
})
const networkError = Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError', status: 0 })

function fakeAuth(overrides: Partial<AuthPort> = {}) {
  let listener: ((event: AuthEvent, s: AuthSession | null) => void) | null = null
  const port: AuthPort & { emit: (event: AuthEvent, s: AuthSession | null) => void } = {
    getSession: vi.fn<AuthPort['getSession']>(async () => ({ session: null, error: null })),
    onAuthStateChange: (callback) => {
      listener = callback
      return () => (listener = null)
    },
    signInWithOtp: vi.fn<AuthPort['signInWithOtp']>(async () => ({ error: null })),
    verifyOtp: vi.fn<AuthPort['verifyOtp']>(async () => ({ session: session(), error: null })),
    signOut: vi.fn<AuthPort['signOut']>(async () => ({ error: null })),
    emit: (event, s) => listener?.(event, s),
    ...overrides,
  }
  return port
}

function setup(port: AuthPort | null) {
  const onSignedOut = vi.fn<() => void>()
  const cloud = createCloudSession({ loadAuth: port ? async () => port : null, redirectTo: () => 'http://localhost:5173/', onSignedOut, now: () => NOW })
  return { cloud, onSignedOut }
}

describe('cloud session', () => {
  it('without configuration: unconfigured, and nothing is loaded', async () => {
    const { cloud } = setup(null)
    await cloud.start()
    expect(cloud.getState().status).toBe('unconfigured')
  })

  it('unauthenticated: signed out after start', async () => {
    const { cloud } = setup(fakeAuth())
    expect(cloud.getState().status).toBe('loading')
    await cloud.start()
    expect(cloud.getState()).toMatchObject({ status: 'signed_out', user: null, error: null })
  })

  it('restores a saved session', async () => {
    const { cloud } = setup(fakeAuth({ getSession: async () => ({ session: session(), error: null }) }))
    await cloud.start()
    expect(cloud.getState()).toMatchObject({ status: 'signed_in', user: { id: 'aaaaaaaa-0000-4000-8000-000000000001', email: 'synthetic@example.test' } })
  })

  it('an expired session is signed out locally and reported; the key is locked', async () => {
    const port = fakeAuth({ getSession: async () => ({ session: session(-60), error: null }) })
    const { cloud, onSignedOut } = setup(port)
    await cloud.start()
    expect(cloud.getState()).toMatchObject({ status: 'signed_out', error: 'session_expired' })
    expect(port.signOut).toHaveBeenCalledWith('local')
    expect(onSignedOut).toHaveBeenCalled()
  })

  it('an invalid (revoked) refresh token ends the session', async () => {
    const { cloud, onSignedOut } = setup(fakeAuth({ getSession: async () => ({ session: null, error: { code: 'refresh_token_not_found', status: 400 } }) }))
    await cloud.start()
    expect(cloud.getState()).toMatchObject({ status: 'signed_out', error: 'session_expired' })
    expect(onSignedOut).toHaveBeenCalled()
  })

  it('offline at start: cloud unavailable, stored session untouched', async () => {
    const port = fakeAuth({ getSession: async () => ({ session: null, error: networkError }) })
    const { cloud, onSignedOut } = setup(port)
    await cloud.start()
    expect(cloud.getState()).toMatchObject({ status: 'error', error: 'offline' })
    expect(port.signOut).not.toHaveBeenCalled()
    expect(onSignedOut).not.toHaveBeenCalled()
  })

  it('sign in: email → one-time code → signed in', async () => {
    const port = fakeAuth()
    const { cloud } = setup(port)
    await cloud.start()
    expect(await cloud.requestCode('not-an-email')).toBe(false)
    expect(cloud.getState().error).toBe('invalid_email')
    expect(await cloud.requestCode('  Synthetic@Example.TEST ')).toBe(true)
    expect(port.signInWithOtp).toHaveBeenCalledWith('synthetic@example.test', 'http://localhost:5173/')
    expect(cloud.getState()).toMatchObject({ status: 'code_sent', email: 'synthetic@example.test' })
    expect(await cloud.verifyCode('12')).toBe(false)
    expect(cloud.getState().error).toBe('invalid_code')
    expect(await cloud.verifyCode('123 456')).toBe(true)
    expect(port.verifyOtp).toHaveBeenCalledWith('synthetic@example.test', '123456')
    expect(cloud.getState()).toMatchObject({ status: 'signed_in', email: null, error: null })
  })

  it('a wrong or expired code, rate limits and network failures are reported, not thrown', async () => {
    const port = fakeAuth({ verifyOtp: async () => ({ session: null, error: { code: 'otp_expired', status: 403 } }) })
    const { cloud } = setup(port)
    await cloud.start()
    await cloud.requestCode('synthetic@example.test')
    expect(await cloud.verifyCode('123456')).toBe(false)
    expect(cloud.getState()).toMatchObject({ status: 'code_sent', error: 'invalid_code', busy: false })
    expect(classifyAuthError({ status: 429 })).toBe('rate_limited')
    expect(classifyAuthError(networkError)).toBe('offline')
    expect(classifyAuthError(new TypeError('Failed to fetch'))).toBe('offline')
  })

  it('sign out revokes the session, locks the key and never touches local data', async () => {
    const port = fakeAuth({ getSession: async () => ({ session: session(), error: null }) })
    const { cloud, onSignedOut } = setup(port)
    await cloud.start()
    await cloud.signOut()
    expect(port.signOut).toHaveBeenCalledWith('global')
    expect(cloud.getState()).toMatchObject({ status: 'signed_out', user: null })
    expect(onSignedOut).toHaveBeenCalledTimes(1)
  })

  it('sign out while offline falls back to forgetting the session on this device', async () => {
    const signOut = vi.fn<AuthPort['signOut']>(async (scope) => ({ error: scope === 'global' ? networkError : null }))
    const { cloud, onSignedOut } = setup(fakeAuth({ getSession: async () => ({ session: session(), error: null }), signOut }))
    await cloud.start()
    await cloud.signOut()
    expect(signOut.mock.calls.map(([scope]) => scope)).toEqual(['global', 'local'])
    expect(cloud.getState().status).toBe('signed_out')
    expect(onSignedOut).toHaveBeenCalled()
  })

  it('a sign-out elsewhere (other tab, revoked token) is followed here', async () => {
    const port = fakeAuth({ getSession: async () => ({ session: session(), error: null }) })
    const { cloud, onSignedOut } = setup(port)
    await cloud.start()
    port.emit('SIGNED_OUT', null)
    expect(cloud.getState().status).toBe('signed_out')
    expect(onSignedOut).toHaveBeenCalled()
  })
})
