import { AlertTriangle, Cloud, CloudOff, Loader2, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/formatting'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { DriveState } from './drive-sync'
import { driveSync, useDriveSync } from './instance'

export function syncLabel(state: DriveState): string {
  if (state.status === 'synced' && state.pending > 0) return t('drive.status.pending', { count: state.pending.toLocaleString('th-TH') })
  return t(`drive.status.${state.status}`)
}

/** Header chip: where the data stands right now. Tapping syncs, or reconnects when Google needs a tap. */
export function SyncStatus() {
  const state = useDriveSync()
  if (state.status === 'unconfigured' || state.status === 'not_linked') return null

  const label = syncLabel(state)
  const needsTap = state.status === 'needs_sign_in'
  const Icon = state.status === 'syncing' || state.status === 'connecting' ? Loader2 : state.status === 'offline' ? CloudOff : state.status === 'error' ? AlertTriangle : needsTap ? RotateCw : Cloud
  const title = state.lastSyncAt ? `${label} · ${t('drive.lastSync')} ${formatDateTime(state.lastSyncAt)}` : label

  return (
    <Button
      variant={needsTap ? 'default' : 'ghost'}
      size="sm"
      className={cn('h-touch min-w-touch gap-1.5 px-2 text-xs md:h-8 md:min-w-0', state.status === 'error' && 'text-destructive', state.status === 'offline' && 'text-muted-foreground')}
      aria-label={t('drive.statusLabel', { status: label })}
      title={title}
      disabled={state.busy && !needsTap}
      onClick={() => void (needsTap ? driveSync.connect() : driveSync.sync())}
    >
      <Icon className={cn('size-4', (state.status === 'syncing' || state.status === 'connecting') && 'animate-spin')} aria-hidden="true" />
      <span className={cn(needsTap ? 'inline' : 'hidden sm:inline')}>{label}</span>
    </Button>
  )
}
