/**
 * Cloud configuration from the environment. The browser may only ever hold:
 *   VITE_SUPABASE_URL       project URL (https)
 *   VITE_SUPABASE_ANON_KEY  anon (JWT role "anon") or publishable (sb_publishable_…) key
 * Both are public by design; Row Level Security is what protects data.
 *
 * Never in the browser: service_role / sb_secret_ keys, database password,
 * JWT secret. A key that looks like one is REFUSED here, and the build refuses
 * it too (vite.config.ts), so it can't reach the bundle by mistake.
 *
 * Missing or invalid configuration is not an error for the app: everything
 * local keeps working; only cloud features show as unavailable.
 */
import { classifySupabaseKey } from './key-kind'

export { classifySupabaseKey }

export type CloudConfig =
  { status: 'configured'; url: string; anonKey: string } | { status: 'missing' } | { status: 'invalid'; reason: 'url' | 'key' | 'secret_key' }

export interface CloudEnv {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
}

export function readCloudConfig(env: CloudEnv): CloudConfig {
  const url = env.VITE_SUPABASE_URL?.trim()
  const key = env.VITE_SUPABASE_ANON_KEY?.trim()
  if (!url && !key) return { status: 'missing' }
  if (key) {
    const kind = classifySupabaseKey(key)
    if (kind === 'secret') return { status: 'invalid', reason: 'secret_key' }
    if (kind === 'invalid') return { status: 'invalid', reason: 'key' }
  }
  let parsed: URL
  try {
    parsed = new URL(url ?? '')
  } catch {
    return { status: 'invalid', reason: 'url' }
  }
  const local = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
  if ((parsed.protocol !== 'https:' && !local) || parsed.username || parsed.password || parsed.search || parsed.hash)
    return { status: 'invalid', reason: 'url' }
  if (!key) return { status: 'invalid', reason: 'key' }
  return { status: 'configured', url: parsed.origin, anonKey: key }
}

/** This build's configuration. */
export const cloudConfig: CloudConfig = readCloudConfig({
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
})
