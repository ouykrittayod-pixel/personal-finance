/**
 * May this device sync? In Phase 19 the answer is always no: there is no sync
 * engine. The gate still spells out every condition a later engine must meet,
 * so "signed out", "locked", "offline" and "sync off" each block on their own.
 */
import type { VaultStatus } from '@/lib/crypto/vault'
import type { CloudStatus } from './session'

export const SYNC_ENGINE_AVAILABLE = false

export type SyncBlock = 'not_configured' | 'not_signed_in' | 'key_locked' | 'offline' | 'sync_disabled' | 'not_implemented'

export interface SyncGateInput {
  cloud: CloudStatus
  vault: VaultStatus
  online: boolean
  syncEnabled: boolean
}

export function evaluateSyncGate(input: SyncGateInput): { allowed: boolean; blocks: SyncBlock[] } {
  const blocks: SyncBlock[] = []
  if (input.cloud === 'unconfigured') blocks.push('not_configured')
  else if (input.cloud !== 'signed_in') blocks.push('not_signed_in')
  if (input.vault !== 'unlocked') blocks.push('key_locked')
  if (!input.online) blocks.push('offline')
  if (!input.syncEnabled) blocks.push('sync_disabled')
  if (!SYNC_ENGINE_AVAILABLE) blocks.push('not_implemented')
  return { allowed: blocks.length === 0, blocks }
}
