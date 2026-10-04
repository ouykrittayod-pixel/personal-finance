import { FileSpreadsheet, LogOut, RotateCw } from 'lucide-react'
import { useState } from 'react'
import { PrimaryButton, SecondaryButton } from '@/components/actions/buttons'
import { useToast } from '@/components/feedback/toast-context'
import { Dialog } from '@/components/overlays/Dialog'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDateTime } from '@/lib/formatting'
import { t } from '@/lib/i18n'
import { driveSync, useDriveSync } from './instance'
import { syncLabel } from './sync-label'

/** Settings: which Google account holds the data, sync state, and signing this device out. */
export function DriveCard() {
  const state = useDriveSync()
  const toast = useToast()
  const [confirmOpen, setConfirmOpen] = useState(false)
  if (state.status === 'unconfigured' || state.status === 'not_linked') return null

  const needsTap = state.status === 'needs_sign_in'
  const hint = state.error ? t(`drive.error.${state.error}`) : state.status === 'offline' ? t('drive.hint.offline') : needsTap ? t('drive.hint.needs_sign_in') : null

  async function signOut() {
    await driveSync.signOut()
    setConfirmOpen(false)
    toast.show({ message: t('drive.signedOut'), tone: 'success' })
  }

  return (
    <Card id="drive">
      <CardHeader>
        <CardTitle>
          <h2>{t('drive.title')}</h2>
        </CardTitle>
        <CardDescription>{t('drive.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2 min-w-0">
            <dt className="text-xs text-muted-foreground">{t('drive.account')}</dt>
            <dd className="truncate font-medium">{state.email}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{t('drive.status')}</dt>
            <dd className="font-medium" data-testid="drive-status">
              {syncLabel(state)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{t('drive.lastSync')}</dt>
            <dd className="font-medium">{state.lastSyncAt ? formatDateTime(state.lastSyncAt) : t('drive.never')}</dd>
          </div>
        </dl>
        {state.pending > 0 && (
          <p className="text-muted-foreground">
            {t('drive.pending')}: {t('drive.pendingValue', { count: state.pending.toLocaleString('th-TH') })}
          </p>
        )}
        {hint && (
          <p role={state.error ? 'alert' : undefined} className="rounded-lg bg-muted/60 p-3">
            {hint}
          </p>
        )}
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <div className="flex items-start gap-3">
            <FileSpreadsheet className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-medium">{t('drive.sheet.title')}</p>
              <p className="text-muted-foreground">{state.sheetError ? t('drive.sheet.error') : state.sheetUrl ? t('drive.sheet.hint') : t('drive.sheet.pending')}</p>
            </div>
          </div>
          {state.sheetUrl && (
            <SecondaryButton asChild className="self-start">
              <a href={state.sheetUrl} target="_blank" rel="noopener noreferrer">
                {t('drive.sheet.open')}
              </a>
            </SecondaryButton>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {needsTap ? (
            <PrimaryButton loading={state.busy} onClick={() => void driveSync.connect()}>
              <RotateCw aria-hidden="true" />
              {t('drive.reconnect')}
            </PrimaryButton>
          ) : (
            <SecondaryButton loading={state.status === 'syncing'} disabled={state.busy} onClick={() => void driveSync.sync()}>
              <RotateCw aria-hidden="true" />
              {t('drive.syncNow')}
            </SecondaryButton>
          )}
          <SecondaryButton disabled={state.busy} onClick={() => setConfirmOpen(true)}>
            <LogOut aria-hidden="true" />
            {t('drive.signOut')}
          </SecondaryButton>
        </div>
      </CardContent>
      <Dialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('drive.signOut.title')}
        description={t('drive.signOut.body')}
        footer={
          <>
            <SecondaryButton onClick={() => setConfirmOpen(false)}>{t('drive.signOut.cancel')}</SecondaryButton>
            <PrimaryButton loading={state.busy} onClick={() => void signOut()}>
              {t('drive.signOut.confirm')}
            </PrimaryButton>
          </>
        }
      >
        {state.pending > 0 && (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            {t('drive.signOut.pending', { count: state.pending.toLocaleString('th-TH') })}
          </p>
        )}
      </Dialog>
    </Card>
  )
}
