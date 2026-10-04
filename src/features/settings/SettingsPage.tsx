import { useEffect, useState } from 'react'
import { useStorage } from '@/app/providers/storage-context'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PagePlaceholder } from '@/components/PagePlaceholder'
import { BackupCard, ExportCard, RestoreCard } from '@/features/backup'
import { CategoriesCard } from '@/features/categories'
import { DriveCard } from '@/features/drive'
import { SetupSettingsCard } from '@/features/setup'
import { getStorageEstimate, type StorageEstimate } from '@/db/persistence'
import { DATA_SCHEMA_VERSION } from '@/db/schema'
import { formatBytes } from '@/lib/formatting'
import { driveConfigured } from '@/lib/google/config'
import { t } from '@/lib/i18n'

const PERSISTENCE_LABEL = {
  checking: 'storage.opening',
  persisted: 'storage.persisted',
  not_persisted: 'storage.notPersisted',
  unsupported: 'storage.unsupported',
} as const

export function SettingsPage() {
  const { persistence, requestPersistence } = useStorage()
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null)

  useEffect(() => {
    getStorageEstimate().then(setEstimate, () => setEstimate(null))
  }, [])

  return (
    <PagePlaceholder titleKey="nav.settings">
      <DriveCard />
      <SetupSettingsCard />
      <CategoriesCard />
      <BackupCard />
      <RestoreCard />
      <ExportCard />
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t(driveConfigured ? 'storage.section.drive' : 'storage.section')}</h2>
          </CardTitle>
          <CardDescription>{t(driveConfigured ? 'app.tagline.drive' : 'app.tagline')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div>
            <div className="font-medium">{t('storage.persistence')}</div>
            <p className="text-muted-foreground" data-testid="persistence-status">
              {t(PERSISTENCE_LABEL[persistence])}
            </p>
          </div>
          {persistence === 'not_persisted' && (
            <Button variant="outline" size="touch" className="self-start" onClick={() => void requestPersistence()}>
              {t('storage.requestPersistence')}
            </Button>
          )}
          {estimate && (
            <p className="text-muted-foreground">{t('storage.usage', { used: formatBytes(estimate.usageBytes), quota: formatBytes(estimate.quotaBytes) })}</p>
          )}
          <p className="text-muted-foreground">{t('storage.schemaVersion', { version: DATA_SCHEMA_VERSION })}</p>
        </CardContent>
      </Card>
    </PagePlaceholder>
  )
}
