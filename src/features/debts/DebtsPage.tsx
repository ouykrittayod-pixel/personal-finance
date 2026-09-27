import { useLiveQuery } from 'dexie-react-hooks'
import { AlertTriangle, Banknote, CalendarClock, CreditCard, Landmark, Plus, Scale, ShieldCheck, Wallet } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { PrimaryButton } from '@/components/actions/buttons'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { LoadingState } from '@/components/feedback/LoadingState'
import { ProgressBar } from '@/components/feedback/ProgressBar'
import { MoneyDisplay } from '@/components/finance/MoneyDisplay'
import { StatCard } from '@/components/finance/StatCard'
import { StatusBadge } from '@/components/finance/StatusBadge'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import type { Debt, ID, ISODate } from '@/domain/entities'
import { negate } from '@/domain/money'
import { todayISO } from '@/lib/dates'
import { formatDate, formatTHB } from '@/lib/formatting'
import { t } from '@/lib/i18n'
import { DebtDetailSheet } from './components/DebtDetailSheet'
import { DebtFormSheet } from './components/DebtFormSheet'
import { buildDebtsModel, dueText, loadDebtDetail, loadDebtsData, type DebtDetail, type DebtRow, type DebtsRawData } from './debts-data'
import { defaultDebtsOps, type DebtsOps } from './debts-ops'

export interface DebtsProps {
  today: ISODate
  /** Injected in tests. */
  load?: () => Promise<DebtsRawData>
  loadDetail?: (id: ID) => Promise<DebtDetail | null>
  ops?: DebtsOps
}

type LoadResult = { ok: true; raw: DebtsRawData } | { ok: false }

function DebtCard({ row, onOpen }: { row: DebtRow; onOpen: () => void }) {
  return (
    <li>
      <Card className="h-full py-0">
        <button
          type="button"
          onClick={onOpen}
          className="focus-ring flex h-full min-h-touch w-full flex-col gap-3 rounded-xl p-card text-left transition-colors duration-(--duration-fast) hover:bg-muted/60"
        >
          <span className="flex items-start gap-3">
            <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-debt-muted text-debt">
              {row.isCard ? <CreditCard className="size-5" /> : <Landmark className="size-5" />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-semibold">{row.name}</span>
              <span className="truncate text-xs text-muted-foreground">{[row.kindLabel, row.lender].filter(Boolean).join(' · ')}</span>
            </span>
            {row.paidOff ? (
              <StatusBadge status="paid" label={t('debts.row.paidOff')} />
            ) : (
              row.nextDue && <StatusBadge status={row.nextDue.status.kind} label={row.nextDue.status.label} />
            )}
          </span>

          <span className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">{row.isCard ? t('debts.row.cardOwed') : t('debts.row.principal')}</span>
            {row.outstanding === null ? (
              <span className="text-sm text-muted-foreground">{t('debts.unknown')}</span>
            ) : row.outstanding < 0 ? (
              <span className="text-sm text-income">{t('debts.row.cardCredit', { amount: formatTHB(negate(row.outstanding), { trimZeroFraction: true }) })}</span>
            ) : (
              <MoneyDisplay amount={row.outstanding} tone="debt" size="lg" />
            )}
          </span>

          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {row.dueAmountText && <span>{row.dueAmountText}</span>}
            <span>{row.nextDue ? dueText(row.nextDue.dueDate) : t('debts.row.noSchedule')}</span>
          </span>

          {row.progress && (
            <span className="flex flex-col gap-1">
              <ProgressBar value={row.progress.paidBps / 100} label={row.progress.text} valueText={row.progress.text} tone="debt" size="sm" />
              <span className="text-xs text-muted-foreground">{row.progress.text}</span>
            </span>
          )}
          {row.hasUnallocated && (
            <span className="flex items-center gap-1 text-xs text-warning">
              <AlertTriangle className="size-3.5" aria-hidden="true" />
              {t('debts.detail.unallocatedPaid')}
            </span>
          )}
        </button>
      </Card>
    </li>
  )
}

/**
 * Debts: loans (principal-based) and credit cards (card-account based).
 * Nothing here moves money except confirming a repayment, which records one
 * debt_payment transaction. The open debt lives in the URL (`#/debts?id=`),
 * so the phone's back button closes the full-screen detail.
 */
export function Debts({ today, load = loadDebtsData, loadDetail, ops = defaultDebtsOps }: DebtsProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [formTarget, setFormTarget] = useState<null | 'create' | Debt>(null)
  const [attempt, setAttempt] = useState(0)

  // Bring scheduled installments up to date when the page opens (idempotent; never creates transactions).
  useEffect(() => {
    ops.generate().catch(() => {})
  }, [ops, today])

  const result = useLiveQuery<LoadResult>(
    () => load().then((raw) => ({ ok: true as const, raw }), () => ({ ok: false as const })),
    [load, attempt],
  )
  const raw = result?.ok ? result.raw : null
  const model = useMemo(() => (raw ? buildDebtsModel(raw, today) : null), [raw, today])
  const detailLoader = useMemo(() => loadDetail ?? ((id: ID) => loadDebtDetail(id, load)), [loadDetail, load])

  const selectedId = searchParams.get('id')
  const openDetail = (id: string) =>
    setSearchParams((params) => {
      const next = new URLSearchParams(params)
      next.set('id', id)
      return next
    })
  const closeDetail = () =>
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params)
        next.delete('id')
        return next
      },
      { replace: true },
    )

  const formData = raw ? { accounts: raw.accounts, debts: raw.debts } : null
  const addButton = (
    <PrimaryButton onClick={() => setFormTarget('create')} disabled={!raw}>
      <Plus aria-hidden="true" />
      {t('debts.add')}
    </PrimaryButton>
  )

  return (
    <div className="flex flex-col gap-section">
      <PageHeader title={t('debts.title')} description={t('debts.subtitle')} actions={addButton} />

      {result === undefined && <LoadingState variant="cards" count={4} />}
      {result && !result.ok && <ErrorState onRetry={() => setAttempt((n) => n + 1)} />}

      {model && (
        <>
          <section aria-label={t('debts.summary')} className="grid grid-cols-2 gap-stack lg:grid-cols-4">
            <StatCard
              label={t('debts.metric.outstanding')}
              icon={Scale}
              tone="debt"
              value={<MoneyDisplay amount={model.metrics.totalOutstanding} size="lg" />}
              hint={model.metrics.unknownCount > 0 ? t('debts.metric.unknownHint', { count: model.metrics.unknownCount }) : t('debts.metric.outstandingHint')}
            />
            <StatCard
              label={t('debts.metric.paidThisMonth')}
              icon={Banknote}
              tone="income"
              value={<MoneyDisplay amount={model.metrics.paidThisMonth} size="lg" />}
              hint={t('debts.metric.paidCount', { count: model.metrics.paidThisMonthCount })}
            />
            <StatCard
              label={t('debts.metric.upcoming')}
              icon={CalendarClock}
              tone={model.metrics.upcomingCount > 0 ? 'warning' : 'neutral'}
              value={<MoneyDisplay amount={model.metrics.upcomingTotal} size="lg" />}
              hint={
                model.metrics.upcomingCount > 0
                  ? t('debts.metric.upcomingHint', { count: model.metrics.upcomingCount, date: formatDate(model.metrics.upcomingUntil) })
                  : t('debts.metric.upcomingNone')
              }
            />
            <StatCard
              label={t('debts.metric.active')}
              icon={Wallet}
              tone="primary"
              value={<span className="amount-lg">{t('debts.metric.activeCount', { count: model.metrics.activeCount })}</span>}
            />
          </section>

          {model.rows.length === 0 ? (
            <EmptyState icon={ShieldCheck} title={t('debts.empty')} description={t('debts.emptyHint')} action={addButton} />
          ) : (
            <section className="flex flex-col gap-stack">
              <h2 className="text-base font-semibold">{t('debts.list')}</h2>
              <ul aria-label={t('debts.list')} className="grid gap-stack sm:grid-cols-2 xl:grid-cols-3">
                {model.rows.map((row) => (
                  <DebtCard key={row.id} row={row} onOpen={() => openDetail(row.id)} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <DebtFormSheet target={formTarget} onClose={() => setFormTarget(null)} data={formData} today={today} ops={ops} onCreated={openDetail} />
      <DebtDetailSheet debtId={selectedId} onClose={closeDetail} onEdit={(debt) => setFormTarget(debt)} today={today} ops={ops} load={detailLoader} />
    </div>
  )
}

/** Route entry (lazy-loaded). */
export function DebtsPage() {
  const [today] = useState(todayISO)
  return <Debts today={today} />
}
