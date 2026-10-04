import { Cloud, Loader2, ShieldCheck, WifiOff, Zap } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { PrimaryButton } from '@/components/actions/buttons'
import { t, type MessageKey } from '@/lib/i18n'
import { driveSync, useDriveSync } from './instance'

function FullScreen({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-6 px-6 py-10">{children}</div>
}

function Waiting({ label }: { label: string }) {
  return (
    <div className="flex min-h-svh items-center justify-center gap-2 text-muted-foreground" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      {label}
    </div>
  )
}

const POINTS: { icon: typeof Cloud; key: MessageKey }[] = [
  { icon: ShieldCheck, key: 'drive.connect.point1' },
  { icon: Zap, key: 'drive.connect.point2' },
  { icon: WifiOff, key: 'drive.connect.point3' },
]

/** First screen on a device that has never connected: everything lives in Drive, so connect first. */
export function ConnectScreen() {
  const state = useDriveSync()
  return (
    <FullScreen>
      <div className="flex flex-col gap-3">
        <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Cloud className="size-6" />
        </span>
        <h1 className="text-2xl font-semibold">{t('drive.connect.title')}</h1>
        <p className="text-muted-foreground">{t('drive.connect.lead')}</p>
      </div>
      <ul className="flex flex-col gap-3 text-sm">
        {POINTS.map(({ icon: Icon, key }) => (
          <li key={key} className="flex items-start gap-3">
            <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <span>{t(key)}</span>
          </li>
        ))}
      </ul>
      {state.error && (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
          {t(`drive.error.${state.error}`)}
        </p>
      )}
      <PrimaryButton size="lg" loading={state.busy} onClick={() => void driveSync.connect()}>
        {state.busy ? t('drive.connect.busy') : t('drive.connect.button')}
      </PrimaryButton>
    </FullScreen>
  )
}

/**
 * With Google Drive configured, the app opens only on a connected device; the
 * first sync on a new device finishes before the data screens show. Without a
 * Client ID (and in tests) it renders the app directly.
 */
export function DriveGate({ children }: { children: ReactNode }) {
  const state = useDriveSync()
  useEffect(() => {
    void driveSync.start()
  }, [])

  if (state.status === 'unconfigured') return children
  if (state.email === null) {
    // Still reading this device's link (first render) vs. never connected.
    if (state.status === 'connecting' && !state.busy) return <Waiting label={t('drive.connect.checking')} />
    return <ConnectScreen />
  }
  // Connected just now: wait for the first download so the screens are not empty.
  if (state.lastSyncAt === null && (state.status === 'syncing' || state.status === 'connecting')) return <Waiting label={t('drive.connect.loading')} />
  return children
}
