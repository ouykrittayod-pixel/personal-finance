import { CircleAlert, CircleCheck, FileUp } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { Dialog } from '@/components/overlays/Dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/db/dexie'
import { formatBytes, formatDateTime } from '@/lib/formatting'
import { t, type MessageKey } from '@/lib/i18n'
import { driveSync } from '@/features/drive/instance'
import { driveConfigured } from '@/lib/google/config'
import { countRecords, replaceDatabase } from '../create-backup'
import { BackupError, type BackupCounts, type BackupErrorKind } from '../format'
import { readBackup, type PreparedRestore } from '../read-backup'

/** Tables shown to the user (attachment blobs are counted as attachments). */
const PREVIEW_TABLES = ['accounts', 'categories', 'transactions', 'debts', 'budgets', 'recurringObligations', 'scheduledPayments', 'attachments'] as const

type Step =
  | { kind: 'idle' }
  | { kind: 'validating' }
  | { kind: 'invalid'; error: BackupErrorKind }
  | { kind: 'preview'; file: { name: string; size: number }; restore: PreparedRestore }
  | { kind: 'confirm'; file: { name: string; size: number }; restore: PreparedRestore; current: BackupCounts }
  | { kind: 'restoring'; file: { name: string; size: number }; restore: PreparedRestore; current: BackupCounts }
  | { kind: 'failed' }
  | { kind: 'done'; verifiedCount: number }

const errorKind = (error: unknown): BackupErrorKind => (error instanceof BackupError ? error.kind : 'restore_failed')

/** Diagnostics for developers: the kind and where (table / id / field) — never record contents. */
function logRestoreError(error: unknown) {
  if (error instanceof BackupError) console.warn('Backup rejected:', error.kind, error.details.slice(0, 20))
  else console.error('Restore failed', error instanceof Error ? error.message : error)
}

function readText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}

export function RestoreCard() {
  const inputId = useId()
  const input = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>({ kind: 'idle' })
  const [understood, setUnderstood] = useState(false)

  async function onFile(file: File | undefined) {
    if (input.current) input.current.value = ''
    if (!file) return
    setStep({ kind: 'validating' })
    try {
      // Validation is pure: the database is not touched until the user confirms.
      const restore = readBackup(await readText(file))
      setStep({ kind: 'preview', file: { name: file.name, size: file.size }, restore })
    } catch (error) {
      logRestoreError(error)
      setStep({ kind: 'invalid', error: error instanceof BackupError ? error.kind : 'invalid_json' })
    }
  }

  async function toConfirm() {
    if (step.kind !== 'preview') return
    setUnderstood(false)
    setStep({ ...step, kind: 'confirm', current: await countRecords(db) })
  }

  async function restore() {
    if (step.kind !== 'confirm' || !understood) return
    setStep({ ...step, kind: 'restoring' })
    try {
      await replaceDatabase(db, step.restore)
      // Verify what is now stored against the file.
      const stored = await countRecords(db)
      const expected = step.restore.counts
      const mismatch = (Object.keys(expected) as (keyof BackupCounts)[]).filter((table) => stored[table] !== expected[table])
      if (mismatch.length) throw new BackupError('restore_failed', mismatch)
      // Drive holds the shared data set: the restored data replaces it (and so every device's copy).
      void driveSync.replaceRemoteWithLocal()
      setStep({ kind: 'done', verifiedCount: Object.values(stored).reduce((total, n) => total + n, 0) - stored.attachmentBlobs })
    } catch (error) {
      logRestoreError(error)
      setStep(errorKind(error) === 'restore_failed' ? { kind: 'failed' } : { kind: 'invalid', error: errorKind(error) })
    }
  }

  const open = step.kind === 'preview' || step.kind === 'confirm' || step.kind === 'restoring'
  const busy = step.kind === 'validating' || step.kind === 'restoring'

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('restore.title')}</h2>
        </CardTitle>
        <CardDescription>{t('restore.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label htmlFor={inputId} className="sr-only">
            {t('restore.fileLabel')}
          </label>
          <input
            ref={input}
            id={inputId}
            type="file"
            accept=".json,application/json"
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => void onFile(event.target.files?.[0])}
          />
          <Button variant="outline" size="touch" className="sm:self-start" disabled={busy} onClick={() => input.current?.click()}>
            <FileUp aria-hidden="true" />
            {t('restore.choose')}
          </Button>
          <p role="status" aria-live="polite" className="text-muted-foreground">
            {step.kind === 'validating' ? t('restore.validating') : step.kind === 'restoring' ? t('restore.restoring') : ''}
          </p>
        </div>

        {step.kind === 'invalid' && (
          <Outcome tone="error" title={t('restore.invalid.title')}>
            <p>{t(`restore.error.${step.error}` as MessageKey)}</p>
            <p>{t('restore.unchanged')}</p>
          </Outcome>
        )}
        {step.kind === 'failed' && (
          <Outcome tone="error" title={t('restore.failed.title')}>
            <p>{t('restore.error.restore_failed')}</p>
            <p>{t('restore.unchanged')}</p>
          </Outcome>
        )}
        {step.kind === 'done' && (
          <Outcome tone="success" title={t('restore.success.title')}>
            <p>{t('restore.success.body')}</p>
            <p>{t('restore.success.verified', { count: step.verifiedCount.toLocaleString('th-TH') })}</p>
            <p className="text-muted-foreground">{t('restore.success.reloadHint')}</p>
            <Button variant="outline" size="touch" className="mt-1 self-start" onClick={() => window.location.reload()}>
              {t('restore.success.reload')}
            </Button>
          </Outcome>
        )}
      </CardContent>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && step.kind !== 'restoring') setStep({ kind: 'idle' })
        }}
        title={step.kind === 'preview' ? t('restore.preview.title') : t('restore.confirm.title')}
        description={step.kind === 'preview' ? t('restore.preview.description') : t('restore.confirm.description')}
        className="max-h-[90dvh] overflow-y-auto"
        footer={
          step.kind === 'preview' ? (
            <>
              <Button variant="outline" size="touch" onClick={() => setStep({ kind: 'idle' })}>
                {t('detail.cancel')}
              </Button>
              <Button size="touch" onClick={() => void toConfirm()}>
                {t('restore.preview.continue')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="touch" disabled={step.kind === 'restoring'} onClick={() => setStep({ kind: 'idle' })}>
                {t('detail.cancel')}
              </Button>
              <Button variant="destructive" size="touch" disabled={!understood || step.kind === 'restoring'} onClick={() => void restore()}>
                {step.kind === 'restoring' ? t('restore.restoring') : t('restore.confirm.action')}
              </Button>
            </>
          )
        }
      >
        {step.kind === 'preview' && (
          <div className="flex flex-col gap-3 text-sm">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">{t('restore.preview.createdAt')}</dt>
              <dd className="text-right">{formatDateTime(step.restore.exportedAt)}</dd>
              <dt className="text-muted-foreground">{t('restore.preview.size')}</dt>
              <dd className="text-right tabular-nums">{formatBytes(step.file.size)}</dd>
            </dl>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-muted/50 p-3" aria-label={t('restore.confirm.incoming')}>
              {PREVIEW_TABLES.map((table) => (
                <div key={table} className="contents">
                  <dt>{t(`restore.count.${table}`)}</dt>
                  <dd className="text-right font-medium tabular-nums">{step.restore.counts[table].toLocaleString('th-TH')}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        {(step.kind === 'confirm' || step.kind === 'restoring') && (
          <div className="flex flex-col gap-3 text-sm">
            <table className="w-full text-sm">
              <caption className="sr-only">{t('restore.confirm.description')}</caption>
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th scope="col" className="text-left font-normal">
                    {t('restore.confirm.item')}
                  </th>
                  <th scope="col" className="text-right font-normal">
                    {t('restore.confirm.current')}
                  </th>
                  <th scope="col" className="text-right font-normal">
                    {t('restore.confirm.incoming')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {PREVIEW_TABLES.map((table) => (
                  <tr key={table} className="border-t border-border">
                    <th scope="row" className="py-1 text-left font-normal">
                      {t(`restore.count.${table}`)}
                    </th>
                    <td className="py-1 text-right tabular-nums">{step.current[table].toLocaleString('th-TH')}</td>
                    <td className="py-1 text-right font-medium tabular-nums">{step.restore.counts[table].toLocaleString('th-TH')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <p className="font-medium">{t('restore.confirm.will')}</p>
              <ul className="mt-1 list-disc pl-5">
                <li>{t('restore.confirm.replace')}</li>
                <li>{t('restore.confirm.delete')}</li>
                <li>{t('restore.confirm.import')}</li>
                <li>{t('restore.confirm.attachments')}</li>
                {driveConfigured && <li>{t('restore.confirm.drive')}</li>}
              </ul>
              <p className="mt-2 text-muted-foreground">{t('restore.confirm.irreversible')}</p>
            </div>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={understood}
                disabled={step.kind === 'restoring'}
                onChange={(event) => setUnderstood(event.target.checked)}
                className="focus-ring mt-0.5 size-5 shrink-0 accent-(--primary)"
              />
              <span>{t('restore.confirm.check')}</span>
            </label>
          </div>
        )}
      </Dialog>
    </Card>
  )
}

function Outcome({ tone, title, children }: { tone: 'success' | 'error'; title: string; children: React.ReactNode }) {
  const Icon = tone === 'success' ? CircleCheck : CircleAlert
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={
        tone === 'error'
          ? 'flex gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3'
          : 'flex gap-3 rounded-lg border border-income/30 bg-income/5 p-3'
      }
    >
      <Icon aria-hidden="true" className={tone === 'error' ? 'mt-0.5 size-5 shrink-0 text-destructive' : 'mt-0.5 size-5 shrink-0 text-income'} />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-medium">{title}</p>
        {children}
      </div>
    </div>
  )
}
