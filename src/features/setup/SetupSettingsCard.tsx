import { useLiveQuery } from 'dexie-react-hooks'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/db/dexie'
import { META_KEYS, metaRepository } from '@/db/repositories'
import { loadSetupCounts } from '@/db/setup-counts'
import { getSetupStatus } from '@/domain/setup'
import { todayISO, yearMonthOf } from '@/lib/dates'
import { t } from '@/lib/i18n'

/** Settings: setup progress, and bringing the Dashboard setup card back after it was closed. */
export function SetupSettingsCard() {
  const counts = useLiveQuery(() => loadSetupCounts(db, yearMonthOf(todayISO())), [])
  const dismissed = useLiveQuery(async () => ({ at: await metaRepository.get<string>(META_KEYS.setupDismissedAt) }), [])
  if (!counts || !dismissed) return null
  const status = getSetupStatus(counts)
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('start.settingsTitle')}</h2>
        </CardTitle>
        <CardDescription>{t('start.progress', { done: status.doneCount, total: status.items.length })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {dismissed.at ? (
          <Button variant="outline" size="touch" className="self-start" onClick={() => void metaRepository.remove(META_KEYS.setupDismissedAt)}>
            {t('start.showAgain')}
          </Button>
        ) : (
          <p className="text-muted-foreground">{t('start.shown')}</p>
        )}
      </CardContent>
    </Card>
  )
}
