import { FileJson, FileSpreadsheet } from 'lucide-react'
import { useState } from 'react'
import { useToast } from '@/components/feedback/toast-context'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/db/dexie'
import { todayISO } from '@/lib/dates'
import { downloadBlob } from '@/lib/download'
import { t } from '@/lib/i18n'
import { csvExportFileName, dataExportFileName, exportDataJson, exportTransactionsCsv } from '../export-data'

export function ExportCard() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function run(kind: 'json' | 'csv') {
    setBusy(true)
    try {
      const now = new Date()
      const today = todayISO(now)
      const [blob, fileName] =
        kind === 'json' ? [await exportDataJson(db, now.toISOString()), dataExportFileName(today)] : [await exportTransactionsCsv(db), csvExportFileName(today)]
      downloadBlob(blob, fileName)
      toast.show({ message: t('export.done', { file: fileName }), tone: 'success' })
    } catch (error) {
      console.error('Export failed', error instanceof Error ? error.message : error)
      toast.show({ message: t('export.failed'), tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('export.title')}</h2>
        </CardTitle>
        <CardDescription>{t('export.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Button variant="outline" size="touch" disabled={busy} onClick={() => void run('json')} aria-describedby="export-json-hint">
              <FileJson aria-hidden="true" />
              {t('export.json')}
            </Button>
            <p id="export-json-hint" className="text-xs text-muted-foreground">
              {t('export.jsonHint')}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <Button variant="outline" size="touch" disabled={busy} onClick={() => void run('csv')} aria-describedby="export-csv-hint">
              <FileSpreadsheet aria-hidden="true" />
              {t('export.csv')}
            </Button>
            <p id="export-csv-hint" className="text-xs text-muted-foreground">
              {t('export.csvHint')}
            </p>
          </div>
        </div>
        <p role="status" aria-live="polite" className="text-muted-foreground">
          {busy ? t('export.working') : ''}
        </p>
      </CardContent>
    </Card>
  )
}
