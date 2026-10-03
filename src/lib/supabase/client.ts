/**
 * The Supabase client, created on first use only. The library is loaded with
 * a dynamic import, so the local app (and its startup bundle) never loads it
 * unless a cloud feature is used.
 *
 * Auth session: kept by supabase-js in localStorage under `pf-cloud-auth`
 * (access + refresh token). It is NOT in IndexedDB, so it can never end up in
 * a backup file. PKCE flow: a magic link returns `?code=…`, exchanged here.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CloudConfig } from './config'

export const AUTH_STORAGE_KEY = 'pf-cloud-auth'

let client: Promise<SupabaseClient> | null = null

export function getSupabaseClient(config: Extract<CloudConfig, { status: 'configured' }>): Promise<SupabaseClient> {
  client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(config.url, config.anonKey, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: AUTH_STORAGE_KEY },
    }),
  )
  return client
}

/** A magic link lands with `?code=` (PKCE). The session must be picked up even if Settings is never opened. */
export const hasAuthRedirect = (search: string = location.search) => new URLSearchParams(search).has('code')
