/**
 * App-wide cloud objects: configuration, sign-in session, key vault.
 * Loaded only by cloud UI (Settings card, dev page) or when a magic link
 * returns — never on normal startup. Supabase itself loads on first use.
 */
import { useSyncExternalStore } from 'react'
import { db } from '@/db/dexie'
import { createKeyringStore } from '@/db/keyring-store'
import { createKeyVault } from '@/lib/crypto/vault'
import { getSupabaseClient, hasAuthRedirect } from '@/lib/supabase/client'
import { cloudConfig } from '@/lib/supabase/config'
import { supabaseRecordStore, type EncryptedRecordStore } from './encrypted-records'
import { createCloudSession, supabaseAuthPort } from './session'

export const keyVault = createKeyVault(createKeyringStore(db))

const configured = cloudConfig.status === 'configured' ? cloudConfig : null

export const cloudSession = createCloudSession({
  loadAuth: configured ? async () => supabaseAuthPort(await getSupabaseClient(configured)) : null,
  redirectTo: () => `${location.origin}${import.meta.env.BASE_URL}`,
  // Signing out (or the session ending) always locks the key; local data stays.
  onSignedOut: () => keyVault.lock(),
})

/** Starts the session (restores a saved one, completes a magic-link return) and removes `?code=` from the address bar. */
export async function startCloud(): Promise<void> {
  await Promise.all([cloudSession.start(), keyVault.refresh().catch(() => undefined)])
  if (hasAuthRedirect()) history.replaceState(null, '', `${location.pathname}${location.hash}`)
}

export async function cloudRecordStore(): Promise<EncryptedRecordStore> {
  if (!configured) throw new Error('cloud not configured')
  // Structural subset of the client (the full generic type is too deep for the compiler to compare).
  return supabaseRecordStore((await getSupabaseClient(configured)) as unknown as Parameters<typeof supabaseRecordStore>[0])
}

export const useCloudSession = () => useSyncExternalStore(cloudSession.subscribe, cloudSession.getState)
export const useKeyVault = () => useSyncExternalStore(keyVault.subscribe, keyVault.getSnapshot)
