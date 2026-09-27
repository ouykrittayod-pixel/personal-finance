import { useLiveQuery } from 'dexie-react-hooks'
import { DatabaseBackup } from 'lucide-react'
import { useState } from 'react'
import { useToast } from '@/components/feedback/toast-context'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/db/dexie'
import { META_KEYS, metaRepository } from '@/db/repositories'
import { todayISO } from '@/lib/dates'
import { downloadBlob } from '@/lib/download'
import { formatBytes, formatDateTime } from '@/lib/formatting'
import { t } from '@/lib/i18n'
import { backupToBlob, createBackup, estimateBackup } from '../create-backup'
import { backupFileName } from '../format'

export function BackupCard() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const estimate = useLiveQuery(() => estimateBackup(db), [])
  const lastBackupAt = useLiveQuery(() => metaRepository.get<string>(META_KEYS.lastBackupAt), [])

  async function create() {
    setBusy(true)
    try {
      const now = new Date()
      const backup = await createBackup(db, now.toISOString())
      const fileName = backupFileName(todayISO(now))
      downloadBlob(backupToBlob(backup), fileName)
      // Recorded only once the file has been generated and handed to the browser.
      await metaRepository.set(META_KEYS.lastBackupAt, backup.exportedAt)
      toast.show({ message: t('backup.created', { file: fileName }), tone: 'success' })
    } catch (error) {
      console.error('Backup failed', error instanceof Error ? error.message : error)
      toast.show({ message: t('backup.createFailed'), tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('backup.title')}</h2>
        </CardTitle>
        <CardDescription>{t('backup.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <dl className="grid grid-cols-3 gap-3">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{t('backup.records')}</dt>
            <dd className="font-medium tabular-nums">{estimate ? t('backup.recordsValue', { count: estimate.records.toLocaleString('th-TH') }) : '—'}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{t('backup.attachments')}</dt>
            <dd className="font-medium tabular-nums">
              {estimate ? t('backup.attachmentsValue', { count: estimate.attachments.toLocaleString('th-TH') }) : '—'}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{t('backup.size')}</dt>
            <dd className="font-medium tabular-nums">{estimate ? formatBytes(estimate.bytes) : '—'}</dd>
          </div>
        </dl>
        <p className="text-muted-foreground" data-testid="last-backup">
          {lastBackupAt ? t('backup.last', { date: formatDateTime(lastBackupAt) }) : t('backup.never')}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button size="touch" className="sm:self-start" onClick={() => void create()} disabled={busy || !estimate}>
            <DatabaseBackup aria-hidden="true" />
            {t('backup.create')}
          </Button>
          <p role="status" aria-live="polite" className="text-muted-foreground">
            {busy ? t('backup.creating') : ''}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">{t('backup.privacy')}</p>
      </CardContent>
    </Card>
  )
}
