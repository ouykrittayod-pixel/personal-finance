import { useLiveQuery } from 'dexie-react-hooks'
import { CircleCheck, Circle, X } from 'lucide-react'
import { Link } from 'react-router'
import { useOptionalQuickEntry } from '@/app/providers/quick-entry-context'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/db/dexie'
import { META_KEYS, metaRepository } from '@/db/repositories'
import { loadSetupCounts } from '@/db/setup-counts'
import type { ISODate } from '@/domain/entities'
import { getSetupStatus, type SetupItem } from '@/domain/setup'
import { yearMonthOf } from '@/lib/dates'
import { t, type MessageKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { SETUP_LINKS } from './setup-links'

function detail(item: SetupItem): string {
  if (!item.done) return t(`start.item.${item.key}.hint` as MessageKey)
  if (item.key === 'income') return item.count > 0 ? t('start.item.income.doneRules', { count: item.count }) : t('start.item.income.done')
  return t(`start.item.${item.key}.done` as MessageKey, { count: item.count.toLocaleString('th-TH') })
}

/**
 * First-run guidance on the Dashboard. Everything shown is derived from the
 * database; it creates nothing, blocks nothing, and can be dismissed.
 */
export function SetupCard({ today }: { today: ISODate }) {
  const quickEntry = useOptionalQuickEntry()
  const counts = useLiveQuery(() => loadSetupCounts(db, yearMonthOf(today)), [today])
  // Wrapped so "not dismissed" (undefined value) differs from "still loading".
  const dismissed = useLiveQuery(async () => ({ at: await metaRepository.get<string>(META_KEYS.setupDismissedAt) }), [])
  if (!counts || !dismissed || dismissed.at) return null

  const status = getSetupStatus(counts)
  if (status.items.every((item) => item.done)) return null

  return (
    <Card aria-labelledby="setup-title">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <CardTitle>
            <h2 id="setup-title">{status.isFirstRun ? t('start.firstRun.title') : t('start.title')}</h2>
          </CardTitle>
          <CardDescription>
            {status.isFirstRun ? t('start.firstRun.body') : t('start.progress', { done: status.doneCount, total: status.items.length })}
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="icon-touch"
          aria-label={t('start.dismiss')}
          onClick={() => void metaRepository.set(META_KEYS.setupDismissedAt, new Date().toISOString())}
        >
          <X aria-hidden="true" />
        </Button>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col divide-y">
          {status.items.map((item, index) => {
            const label = t(`start.item.${item.key}` as MessageKey)
            const Icon = item.done ? CircleCheck : Circle
            return (
              <li key={item.key} className="flex items-center gap-3 py-2.5">
                <Icon aria-hidden="true" className={cn('size-5 shrink-0', item.done ? 'text-income' : 'text-muted-foreground')} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-medium">
                    {status.isFirstRun && <span className="text-muted-foreground">{index + 1}. </span>}
                    {label}
                    <span className="sr-only"> — {item.done ? '✓' : t('start.notYet')}</span>
                    {item.optional && !item.done && <span className="ml-1.5 text-xs font-normal text-muted-foreground">({t('start.optional')})</span>}
                  </span>
                  <span className={cn('text-xs', item.done ? 'text-income' : 'text-muted-foreground')}>{detail(item)}</span>
                </div>
                {!item.done &&
                  (item.key === 'firstEntry' ? (
                    quickEntry ? (
                      <Button size="touch" variant="outline" className="shrink-0" onClick={quickEntry.openExpense}>
                        {t('start.record')}
                      </Button>
                    ) : (
                      <Button size="touch" variant="outline" className="shrink-0" asChild>
                        <Link to="/expenses">{t('start.record')}</Link>
                      </Button>
                    )
                  ) : (
                    <Button size="touch" variant="outline" className="shrink-0" asChild>
                      <Link to={SETUP_LINKS[item.key]} aria-label={t('start.go', { name: label })}>
                        {t('start.open')}
                      </Link>
                    </Button>
                  ))}
              </li>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )
}
