import { useState } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cloudRecordStore, keyVault, useCloudSession, useKeyVault } from '@/features/cloud/cloud'
import { CloudCard } from '@/features/cloud/CloudCard'
import { runSyntheticRoundTrip } from '@/features/cloud/round-trip'
import { evaluateSyncGate } from '@/features/cloud/sync-gate'
import { buildSyntheticDataset, SYNTHETIC_RECORD_TYPES } from '@/features/cloud/synthetic'
import { cloudConfig } from '@/lib/supabase/config'

/**
 * DEVELOPMENT ONLY (#/dev/cloud): the Phase 19 proof against a real Supabase
 * project. Uses the SYNTHETIC dataset only — this page never reads the local
 * finance database. Shows counts, never record contents.
 */
export function CloudLabPage() {
  const session = useCloudSession()
  const vault = useKeyVault()
  const [report, setReport] = useState<string>('—')
  const gate = evaluateSyncGate({ cloud: session.status, vault: vault.status, online: navigator.onLine, syncEnabled: false })
  const ready = session.status === 'signed_in' && vault.status === 'unlocked'

  async function run() {
    setReport('กำลังทดสอบ…')
    try {
      const result = await runSyntheticRoundTrip({
        store: await cloudRecordStore(),
        key: keyVault.current(),
        userId: session.user!.id,
        items: buildSyntheticDataset(),
      })
      setReport(JSON.stringify(result, null, 2))
    } catch (error) {
      setReport(`ล้มเหลว: ${error instanceof Error ? error.name : 'error'}`)
    }
  }

  async function cleanup() {
    try {
      setReport(`ลบแล้ว ${await (await cloudRecordStore()).remove(SYNTHETIC_RECORD_TYPES)} รายการ`)
    } catch (error) {
      setReport(`ล้มเหลว: ${error instanceof Error ? error.name : 'error'}`)
    }
  }

  return (
    <div className="flex flex-col gap-section">
      <PageHeader title="ทดสอบคลาวด์แบบเข้ารหัส (dev)" description="ข้อมูลสังเคราะห์เท่านั้น ไม่แตะข้อมูลการเงินในเครื่อง" />
      <CloudCard />
      <Card>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p>
            config: {cloudConfig.status} · session: {session.status} · key: {vault.status}
            {vault.kid ? ` (${vault.kid.slice(0, 8)}…)` : ''}
          </p>
          <p>sync gate: {gate.allowed ? 'allowed' : `blocked (${gate.blocks.join(', ')})`}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="touch" disabled={!ready} onClick={() => void run()}>
              Round trip ข้อมูลสังเคราะห์ 43 รายการ
            </Button>
            <Button size="touch" variant="outline" disabled={session.status !== 'signed_in'} onClick={() => void cleanup()}>
              ลบข้อมูลสังเคราะห์บนคลาวด์
            </Button>
            <Button
              size="touch"
              variant="outline"
              disabled={vault.status === 'none'}
              onClick={() => window.confirm('ลบกุญแจของเครื่องนี้? ข้อมูลที่เข้ารหัสด้วยกุญแจนี้จะอ่านไม่ได้อีก') && void keyVault.destroy()}
            >
              ลบกุญแจ (dev)
            </Button>
          </div>
          <pre data-testid="cloud-report" className="overflow-x-auto rounded-lg bg-muted/50 p-3 text-xs whitespace-pre-wrap">
            {report}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}
