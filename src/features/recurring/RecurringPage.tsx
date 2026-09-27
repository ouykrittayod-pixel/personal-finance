import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarClock, CheckCircle2, CreditCard, Plus, Repeat, SearchX, Search, Wallet } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { PrimaryButton } from '@/components/actions/buttons'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { LoadingState } from '@/components/feedback/LoadingState'
import { MoneyDisplay } from '@/components/finance/MoneyDisplay'
import { StatCard } from '@/components/finance/StatCard'
import { StatusBadge } from '@/components/finance/StatusBadge'
import { ChoiceGroup } from '@/components/forms/ChoiceGroup'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { ISODate, RecurringObligation } from '@/domain/entities'
import { ExpenseSetup } from '@/features/expenses/quick-expense/ExpenseSetup'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { todayISO } from '@/lib/dates'
import { formatTHB } from '@/lib/formatting'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { RecurringDetailSheet } from './components/RecurringDetailSheet'
import { RecurringFormSheet } from './components/RecurringFormSheet'
import { buildRecurringModel, loadRecurringData, RECURRING_FILTERS, type RecurringFilter, type RecurringRawData, type RecurringRow } from './recurring-data'
import { defaultRecurringOps, type RecurringOps } from './recurring-ops'

export interface RecurringProps {
  today: ISODate
  /** Injected in tests. */
  load?: () => Promise<RecurringRawData>
  ops?: RecurringOps
}

type LoadResult = { ok: true; raw: RecurringRawData } | { ok: false }

function RecurringListRow({ row, onOpen }: { row: RecurringRow; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="focus-ring flex min-h-touch w-full items-center gap-3 px-card py-3 text-left transition-colors duration-(--duration-fast) hover:bg-muted/60"
      >
        <span
          aria-hidden="true"
          className={cn('flex size-10 shrink-0 items-center justify-center rounded-full text-lg', row.isDebt ? 'bg-debt-muted text-debt' : 'bg-neutral-muted')}
        >
          {row.isDebt ? <CreditCard className="size-5" /> : (row.icon ?? <Repeat className="size-5 text-muted-foreground" />)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{row.name}</span>
          <span className="truncate text-xs text-muted-foreground">{[row.categoryLabel, row.dueText].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="flex items-baseline gap-1">
            <MoneyDisplay amount={row.current?.amount ?? row.amount} size="md" />
            <span className="text-xs text-muted-foreground">{row.perLabel}</span>
          </span>
          <StatusBadge status={row.status.kind} label={row.status.label} />
        </span>
      </button>
    </li>
  )
}

/**
 * Recurring obligations: the rules and their scheduled payments. Nothing here
 * creates money movements except "ชำระแล้ว", which records the real payment.
 * The open obligation lives in the URL (`#/recurring?id=<id>`), so the phone's
 * back button closes the full-screen detail.
 */
export function Recurring({ today, load = loadRecurringData, ops = defaultRecurringOps }: RecurringProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [filter, setFilter] = useState<RecurringFilter>('all')
  const [searchText, setSearchText] = useState('')
  const search = useDebouncedValue(searchText, 200)
  const [formTarget, setFormTarget] = useState<null | 'create' | RecurringObligation>(null)
  const [attempt, setAttempt] = useState(0)

  // Bring scheduled payments up to date when the page opens (idempotent; never creates transactions).
  useEffect(() => {
    ops.generate().catch(() => {})
  }, [ops, today])

  const result = useLiveQuery<LoadResult>(
    () => load().then((raw) => ({ ok: true as const, raw }), () => ({ ok: false as const })),
    [load, attempt],
  )
  const raw = result?.ok ? result.raw : null
  const model = useMemo(() => (raw ? buildRecurringModel(raw, { filter, search }, today) : null), [raw, filter, search, today])

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

  const formData = raw ? { categories: raw.categories, accounts: raw.accounts, debts: raw.debts } : null
  const needsSetup = raw !== null && (raw.categories.every((c) => c.kind !== 'expense' || c.archivedAt) || raw.accounts.every((a) => a.archivedAt))

  return (
    <div className="flex flex-col gap-section">
      <PageHeader
        title={t('recurring.title')}
        description={t('recurring.subtitle')}
        actions={
          <PrimaryButton onClick={() => setFormTarget('create')} disabled={!raw || needsSetup}>
            <Plus aria-hidden="true" />
            {t('recurring.add')}
          </PrimaryButton>
        }
      />

      {result === undefined && <LoadingState variant="cards" count={4} />}
      {result && !result.ok && <ErrorState onRetry={() => setAttempt((n) => n + 1)} />}

      {raw && needsSetup && (
        <Card className="px-card">
          <ExpenseSetup
            hasCategories={raw.categories.some((c) => c.kind === 'expense' && !c.archivedAt)}
            hasAccounts={raw.accounts.some((a) => !a.archivedAt)}
            today={today}
          />
        </Card>
      )}

      {model && !needsSetup && (
        <>
          <section aria-label={t('recurring.summary')} className="grid grid-cols-2 gap-stack lg:grid-cols-4">
            <StatCard
              label={t('recurring.summary.due')}
              icon={CalendarClock}
              tone="debt"
              value={<MoneyDisplay amount={model.summary.due} size="lg" />}
              hint={t('recurring.summary.dueHint')}
            />
            <StatCard label={t('recurring.summary.paid')} icon={CheckCircle2} tone="income" value={<MoneyDisplay amount={model.summary.paid} size="lg" />} />
            <StatCard
              label={t('recurring.summary.outstanding')}
              icon={CalendarClock}
              tone={model.summary.outstanding > 0 || model.summary.overdueEarlier > 0 ? 'warning' : 'neutral'}
              value={<MoneyDisplay amount={model.summary.outstanding} size="lg" />}
              hint={model.summary.overdueEarlier > 0 ? t('recurring.summary.earlier', { amount: formatTHB(model.summary.overdueEarlier, { trimZeroFraction: true }) }) : undefined}
            />
            <StatCard
              label={t('recurring.summary.active')}
              icon={Wallet}
              tone="primary"
              value={<span className="amount-lg">{t('recurring.summary.activeCount', { count: model.summary.activeCount })}</span>}
            />
          </section>

          {model.emptyReason === 'no_data' ? (
            <EmptyState
              icon={Repeat}
              title={t('recurring.empty')}
              description={t('recurring.emptyHint')}
              action={
                <PrimaryButton onClick={() => setFormTarget('create')}>
                  <Plus aria-hidden="true" />
                  {t('recurring.add')}
                </PrimaryButton>
              }
            />
          ) : (
            <>
              <div className="flex flex-col gap-stack lg:flex-row lg:items-center lg:justify-between">
                <div className="relative lg:w-80">
                  <label htmlFor="recurring-search" className="sr-only">
                    {t('recurring.searchLabel')}
                  </label>
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    id="recurring-search"
                    type="search"
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                    placeholder={t('recurring.search')}
                    autoComplete="off"
                    className="pl-9"
                  />
                </div>
                <ChoiceGroup
                  legend={t('recurring.filter')}
                  hideLegend
                  layout="scroll"
                  name="recurring-filter"
                  options={RECURRING_FILTERS.map((value) => ({ value, label: t(`recurring.filter.${value}`) }))}
                  value={filter}
                  onValueChange={(value) => setFilter(value as RecurringFilter)}
                />
              </div>

              {model.emptyReason === 'no_match' ? (
                <EmptyState icon={SearchX} title={t('recurring.noMatch')} description={t('recurring.noMatchHint')} />
              ) : (
                <Card className="py-0">
                  <ul aria-label={t('recurring.list')} className="divide-y divide-border">
                    {model.rows.map((row) => (
                      <RecurringListRow key={row.id} row={row} onOpen={() => openDetail(row.id)} />
                    ))}
                  </ul>
                </Card>
              )}
            </>
          )}
        </>
      )}

      <RecurringFormSheet target={formTarget} onClose={() => setFormTarget(null)} data={formData} today={today} ops={ops} />
      <RecurringDetailSheet obligationId={selectedId} onClose={closeDetail} onEdit={(obligation) => setFormTarget(obligation)} today={today} ops={ops} />
    </div>
  )
}

/** Route entry (lazy-loaded). */
export function RecurringPage() {
  const [today] = useState(todayISO)
  return <Recurring today={today} />
}
