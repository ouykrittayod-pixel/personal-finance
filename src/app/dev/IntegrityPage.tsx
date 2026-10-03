import { useCallback, useState } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { db } from '@/db/dexie'
import { loadIntegritySnapshot } from '@/db/integrity-snapshot'
import { auditLocalSync, readSyncStatus, resetSyncMetadata } from '@/db/sync/foundation'
import { auditIntegrity, formatIntegrityReport, type IntegritySnapshot } from '@/domain/integrity'
import { readBackup } from '@/features/backup/read-backup'

/**
 * Development-only, read-only integrity report (#/dev/integrity). Audits the
 * database in this browser, or a backup file (e.g. from another device)
 * without restoring it. Nothing is written; the report lists table / id /
 * rule only — never record contents.
 */
export function IntegrityPage() {
  const [source, setSource] = useState('ฐานข้อมูลในเบราว์เซอร์นี้')
  const [text, setText] = useState<string | null>(null)
  const [ms, setMs] = useState(0)

  const run = useCallback(async (load: () => Promise<IntegritySnapshot>, label: string) => {
    const start = performance.now()
    try {
      const report = auditIntegrity(await load())
      setText(formatIntegrityReport(report))
    } catch (error) {
      setText(`ตรวจไม่ได้: ${error instanceof Error ? error.message : String(error)}`)
    }
    setSource(label)
    setMs(Math.round(performance.now() - start))
  }, [])

  const [sync, setSync] = useState<string | null>(null)
  const readSync = useCallback(async () => {
    try {
      const [status, issues] = await Promise.all([readSyncStatus(db), auditLocalSync(db)])
      setSync(
        [
          `อุปกรณ์: ${status.deviceId ?? '—'} · ซิงก์: ${status.syncEnabled ? 'เปิด' : 'ปิด'} (${status.status}) · epoch ${status.epoch}`,
          `outbox: create ${status.outbox.create} · update ${status.outbox.update} · delete ${status.outbox.delete} · tombstones ${status.tombstones}`,
          issues.length ? [`ปัญหา ${issues.length}:`, ...issues.map((i) => `- ${i.table} ${i.id} ${i.code}`)].join('\n') : 'ความสอดคล้อง: PASS (0 ปัญหา)',
        ].join('\n'),
      )
    } catch (error) {
      setSync(`อ่านไม่ได้: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [])

  async function auditFile(file: File | undefined) {
    if (!file) return
    const content = await file.text()
    await run(async () => {
      const prepared = readBackup(content)
      return { ...prepared.records, blobs: prepared.blobs.map((b) => ({ id: b.id, size: b.blob.size, type: b.blob.type })), meta: [] }
    }, `ไฟล์ ${file.name}`)
  }

  return (
    <div className="flex flex-col gap-section">
      <PageHeader title="ตรวจความถูกต้องของข้อมูล (dev)" description="อ่านอย่างเดียว ไม่แก้ไขข้อมูล" />
      <Card>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="touch" onClick={() => void run(() => loadIntegritySnapshot(db), 'ฐานข้อมูลในเบราว์เซอร์นี้')}>
              ตรวจฐานข้อมูล
            </Button>
            <label className="flex items-center gap-2">
              <span>ตรวจไฟล์ Backup:</span>
              <input type="file" accept=".json,application/json" onChange={(event) => void auditFile(event.target.files?.[0])} />
            </label>
          </div>
          <p className="text-muted-foreground">
            {source} · {ms} ms
          </p>
          <pre data-testid="integrity-report" className="overflow-x-auto rounded-lg bg-muted/50 p-3 text-xs whitespace-pre-wrap">
            {text ?? 'กดปุ่มเพื่อตรวจ'}
          </pre>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-col gap-3 text-sm">
          <h2 className="font-medium">ข้อมูลเตรียมซิงก์ในเครื่อง (ยังไม่มีการซิงก์ผ่านเครือข่าย)</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="touch" onClick={() => void readSync()}>
              อ่านสถานะ
            </Button>
            <Button
              variant="outline"
              size="touch"
              onClick={() => {
                if (window.confirm('ล้าง outbox, tombstones และสถานะซิงก์ในเครื่องนี้? ข้อมูลการเงินไม่ถูกแตะ')) void resetSyncMetadata(db).then(readSync)
              }}
            >
              รีเซ็ตข้อมูลซิงก์ (dev)
            </Button>
          </div>
          <pre data-testid="sync-status" className="overflow-x-auto rounded-lg bg-muted/50 p-3 text-xs whitespace-pre-wrap">
            {sync ?? 'กดปุ่มเพื่ออ่าน'}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}
