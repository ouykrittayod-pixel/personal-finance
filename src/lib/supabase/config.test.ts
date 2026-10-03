/** Phase 19 — which Supabase settings a browser build may use. Fabricated sample keys only. */
import { describe, expect, it } from 'vitest'
import { classifySupabaseKey, readCloudConfig } from './config'

const jwt = (payload: object) => ['eyJhbGciOiJIUzI1NiJ9', btoa(JSON.stringify(payload)).replace(/=+$/, ''), 'c2lnbmF0dXJl'].join('.')
const ANON = jwt({ iss: 'supabase', role: 'anon' })
const SERVICE = jwt({ iss: 'supabase', role: 'service_role' })

describe('Supabase key classification', () => {
  it('accepts anon JWTs and publishable keys only', () => {
    expect(classifySupabaseKey(ANON)).toBe('public')
    expect(classifySupabaseKey('sb_publishable_abcdEFGH1234')).toBe('public')
    expect(classifySupabaseKey(SERVICE)).toBe('secret')
    expect(classifySupabaseKey('sb_secret_abcdEFGH1234')).toBe('secret')
    expect(classifySupabaseKey(jwt({ role: 'authenticated' }))).toBe('secret')
    expect(classifySupabaseKey('hello')).toBe('invalid')
  })
})

describe('cloud configuration', () => {
  const url = 'https://abcd1234.supabase.co'

  it('missing configuration means local-only, not an error', () => {
    expect(readCloudConfig({})).toEqual({ status: 'missing' })
    expect(readCloudConfig({ VITE_SUPABASE_URL: ' ', VITE_SUPABASE_ANON_KEY: '' })).toEqual({ status: 'missing' })
  })

  it('accepts an https project URL with an anon or publishable key', () => {
    expect(readCloudConfig({ VITE_SUPABASE_URL: `${url}/`, VITE_SUPABASE_ANON_KEY: ANON })).toEqual({ status: 'configured', url, anonKey: ANON })
    expect(readCloudConfig({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_ANON_KEY: 'sb_publishable_abcdEFGH1234' }).status).toBe('configured')
  })

  it('refuses a service_role or secret key — the cloud stays off', () => {
    expect(readCloudConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: SERVICE })).toEqual({ status: 'invalid', reason: 'secret_key' })
    expect(readCloudConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: 'sb_secret_abcdEFGH1234' })).toEqual({ status: 'invalid', reason: 'secret_key' })
  })

  it('refuses insecure or malformed URLs and missing keys', () => {
    for (const bad of ['http://abcd.supabase.co', 'ftp://x', 'not a url', 'https://user:pw@abcd.supabase.co', `${url}?x=1`])
      expect(readCloudConfig({ VITE_SUPABASE_URL: bad, VITE_SUPABASE_ANON_KEY: ANON })).toEqual({ status: 'invalid', reason: 'url' })
    expect(readCloudConfig({ VITE_SUPABASE_URL: url })).toEqual({ status: 'invalid', reason: 'key' })
    expect(readCloudConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: 'garbage' })).toEqual({ status: 'invalid', reason: 'key' })
  })
})
