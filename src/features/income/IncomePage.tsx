import { useLiveQuery } from 'dexie-react-hooks'
import { Banknote, CalendarClock, HandCoins, Hash, Plus, Repeat, SearchX } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useOptionalQuickEntry } from '@/app/providers/quick-entry-context'
import { PrimaryButton, SecondaryButton } from '@/components/actions/buttons'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { LoadingState } from '@/components/feedback/LoadingState'
import { MoneyDisplay } from '@/components/finance/MoneyDisplay'
import { StatCard } from '@/components/finance/StatCard'
import { StatusBadge } from '@/components/finance/StatusBadge'
import { TransactionGroup } from '@/components/finance/TransactionList'
import { TransactionRow } from '@/components/finance/TransactionRow'
import { SelectField } from '@/components/forms/SelectField'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import type { ISODate, RecurringObligation, ScheduledPayment } from '@/domain/entities'
import { RecurringDetailSheet } from '@/features/recurring/components/RecurringDetailSheet'
import { RecurringFormSheet } from '@/features/recurring/components/RecurringFormSheet'
import { PayScheduledSheet } from '@/features/recurring/components/PayScheduledSheet'
import { defaultRecurringOps, type RecurringOps } from '@/features/recurring/recurring-ops'
import { LedgerFilters } from '@/features/transactions/components/LedgerFilters'
import { TransactionDetailSheet, type TransactionDetailSheetProps } from '@/features/transactions/detail/TransactionDetailSheet'
import { SEARCH_DEBOUNCE_MS } from '@/features/transactions/TransactionsPage'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { todayISO } from '@/lib/dates'
import { formatDate } from '@/lib/formatting'
import { t } from '@/lib/i18n'
import { buildIncomeModel, defaultIncomeFilters, INCOME_PAGE_SIZE, loadIncomeData, type IncomeFilters, type IncomeRawData, type IncomeRuleRow } from './income-data'

export interface IncomeProps {
  today: ISODate
  /** Injected in tests. */
  load?: () => Promise<IncomeRawData>
  ops?: RecurringOps
  detail?: Pick<TransactionDetailSheetProps, 'load' | 'update' | 'remove'>
}

type LoadResult = { ok: true; raw: IncomeRawData } | { ok: false }

function RuleRow({ row, onOpen, onReceive }: { row: IncomeRuleRow; onOpen: () => void; onReceive?: () => void }) {
  return (
    <li className="flex flex-col gap-2 px-card py-3 sm:flex-row sm:items-center">
      <button type="button" onClick={onOpen} className="focus-ring -m-1 flex min-h-touch min-w-0 flex-1 items-center gap-3 rounded-md p-1 text-left hover:bg-muted/60">
        <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-income-muted text-lg text-income">
          {row.icon ?? <Repeat className="size-5" />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{row.name}</span>
          <span className="truncate text-xs text-muted-foreground">{[row.categoryLabel, row.accountLabel, row.dueText].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <MoneyDisplay amount={row.amount} tone="income" size="md" />
          <StatusBadge status={row.status.kind} label={row.status.label} />
        </span>
      </button>
      {onReceive && row.current && (
        <PrimaryButton className="sm:self-center" onClick={onReceive} aria-label={t('income.recurring.receiveFor', { date: formatDate(row.current.dueDate) })}>
          <HandCoins aria-hidden="true" />
          {t('income.recurring.receive')}
        </PrimaryButton>
      )}
    </li>
  )
}

/**
 * Income: every `income` transaction (never transfers, expenses or debt
 * payments), plus recurring income rules whose occurrences become income only
 * when the user confirms "รับเงินแล้ว". URL keeps the open item (`?tx=` a
 * transaction, `?rule=` a recurring income rule), so the phone's back button closes it.
 */
export function Income({ today, load = loadIncomeData, ops = defaultRecurringOps, detail }: IncomeProps) {
  const quickEntry = useOptionalQuickEntry()
  const [searchParams, setSearchParams] = useSearchParams()
  const [filters, setFilters] = useState<IncomeFilters>(() => defaultIncomeFilters(today))
  const [searchText, setSearchText] = useState('')
  const search = useDebouncedValue(searchText, SEARCH_DEBOUNCE_MS)
  const effectiveFilters = useMemo(() => (search === filters.search ? filters : { ...filters, search }), [filters, search])
  const filterKey = JSON.stringify(effectiveFilters)
  const [paging, setPaging] = useState({ key: filterKey, limit: INCOME_PAGE_SIZE })
  const limit = paging.key === filterKey ? paging.limit : INCOME_PAGE_SIZE
  const [attempt, setAttempt] = useState(0)
  const [formTarget, setFormTarget] = useState<null | 'create' | RecurringObligation>(null)
  const [receiving, setReceiving] = useState<{ payment: ScheduledPayment; rule: RecurringObligation } | null>(null)

  // Bring expected income up to date (idempotent; never creates income by itself).
  useEffect(() => {
    ops.generate().catch(() => {})
  }, [ops, today])

  const result = useLiveQuery<LoadResult>(
    () => load().then((raw) => ({ ok: true as const, raw }), () => ({ ok: false as const })),
    [load, attempt],
  )
  const raw = result?.ok ? result.raw : null
  const model = useMemo(() => (raw ? buildIncomeModel(raw, effectiveFilters, today, limit) : null), [raw, effectiveFilters, today, limit])

  const setParam = (key: 'tx' | 'rule', value: string | null) =>
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: value === null },
    )

  const isMonth = filters.preset === 'month'
  const addButton = quickEntry && (
    <PrimaryButton onClick={quickEntry.openIncome}>
      <Plus aria-hidden="true" />
      {t('income.add')}
    </PrimaryButton>
  )
  const formData = raw ? { categories: raw.categories, accounts: raw.accounts, debts: raw.debts } : null

  return (
    <div className="flex flex-col gap-section">
      <PageHeader title={t('income.title')} description={t('income.subtitle')} actions={addButton} />

      {result === undefined && <LoadingState variant="cards" count={3} />}
      {result && !result.ok && <ErrorState onRetry={() => setAttempt((n) => n + 1)} />}

      {model && (
        <>
          <section aria-label={t('income.summary')} className="grid grid-cols-2 gap-stack lg:grid-cols-3">
            <StatCard
              className="col-span-2 lg:col-span-1"
              label={isMonth ? t('income.summary.totalMonth') : t('income.summary.total')}
              icon={Banknote}
              tone="income"
              value={<MoneyDisplay amount={model.summary.total} tone="income" size="lg" />}
              hint={t('income.summary.range', { start: formatDate(model.range.start), end: formatDate(model.range.end) })}
            />
            <StatCard
              label={t('income.summary.count')}
              icon={Hash}
              tone="neutral"
              value={<span className="amount-lg">{t('income.summary.countValue', { count: model.summary.count })}</span>}
            />
            <StatCard
              label={t('income.summary.average')}
              icon={CalendarClock}
              tone="info"
              value={model.summary.average === null ? <span className="text-sm text-muted-foreground">{t('income.summary.none')}</span> : <MoneyDisplay amount={model.summary.average} size="lg" />}
              hint={t('income.summary.averageHint')}
            />
          </section>

          <section aria-labelledby="income-rules" className="flex flex-col gap-stack">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 id="income-rules" className="text-base font-semibold">
                  {t('income.recurring.title')}
                </h2>
                <p className="text-xs text-muted-foreground">{t('income.recurring.hint')}</p>
              </div>
              <SecondaryButton onClick={() => setFormTarget('create')}>
                <Plus aria-hidden="true" />
                {t('income.recurring.add')}
              </SecondaryButton>
            </div>
            {model.rules.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('income.recurring.empty')}</p>
            ) : (
              <Card className="py-0">
                <ul aria-label={t('income.recurring.list')} className="divide-y divide-border">
                  {model.rules.map((row) => {
                    const rule = raw!.obligations.find((o) => o.id === row.id)!
                    return (
                      <RuleRow
                        key={row.id}
                        row={row}
                        onOpen={() => setParam('rule', row.id)}
                        onReceive={row.current ? () => setReceiving({ payment: row.current!, rule }) : undefined}
                      />
                    )
                  })}
                </ul>
              </Card>
            )}
          </section>

          <section aria-label={t('income.list')} className="flex flex-col gap-stack">
            <LedgerFilters
              filters={filters}
              searchText={searchText}
              onSearchTextChange={setSearchText}
              onChange={(next) => setFilters({ ...filters, ...next, search: filters.search })}
              rangeReversed={model.rangeReversed}
              today={today}
              showTypes={false}
              searchLabel={t('income.searchLabel')}
              searchPlaceholder={t('income.search')}
            />
            <div className="grid gap-stack sm:grid-cols-2">
              <SelectField label={t('income.filter.category')} value={filters.categoryId} options={model.categoryOptions} onValueChange={(categoryId) => setFilters({ ...filters, categoryId })} />
              <SelectField label={t('income.filter.account')} value={filters.accountId} options={model.accountOptions} onValueChange={(accountId) => setFilters({ ...filters, accountId })} />
            </div>

            {model.emptyReason === 'no_data' && <EmptyState icon={HandCoins} title={t('income.empty')} description={t('income.emptyHint')} action={addButton} />}
            {model.emptyReason === 'no_match' && <EmptyState icon={SearchX} title={t('income.noMatch')} description={t('income.noMatchHint')} />}

            {model.groups.length > 0 && (
              <>
                <Card className="gap-0 py-0">
                  {model.groups.map((group) => (
                    <TransactionGroup key={group.date} title={<time dateTime={group.date}>{group.label}</time>}>
                      {group.rows.map((row) => (
                        <TransactionRow
                          key={row.id}
                          type={row.type}
                          title={row.title}
                          amount={row.amount}
                          date={row.date}
                          categoryLabel={row.categoryLabel}
                          categoryIcon={row.categoryIcon}
                          accountLabel={row.accountLabel}
                          hasAttachment={row.hasAttachment}
                          onSelect={() => setParam('tx', row.id)}
                        />
                      ))}
                    </TransactionGroup>
                  ))}
                </Card>
                <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
                  <p aria-live="polite">{t('income.count', { shown: model.shownCount, total: model.matchCount })}</p>
                  {model.shownCount < model.matchCount && (
                    <SecondaryButton onClick={() => setPaging({ key: filterKey, limit: limit + INCOME_PAGE_SIZE })}>
                      {t('ledger.loadMore', { count: Math.min(INCOME_PAGE_SIZE, model.matchCount - model.shownCount) })}
                    </SecondaryButton>
                  )}
                </div>
              </>
            )}
          </section>
        </>
      )}

      <TransactionDetailSheet transactionId={searchParams.get('tx')} onClose={() => setParam('tx', null)} today={today} {...detail} />
      <RecurringDetailSheet obligationId={searchParams.get('rule')} onClose={() => setParam('rule', null)} onEdit={setFormTarget} today={today} ops={ops} />
      <RecurringFormSheet target={formTarget} onClose={() => setFormTarget(null)} data={formData} today={today} ops={ops} mode="income" />
      {receiving && raw && (
        <PayScheduledSheet
          payment={receiving.payment}
          obligation={receiving.rule}
          detail={{ categories: raw.categories, accounts: raw.accounts, debts: raw.debts }}
          today={today}
          onClose={() => setReceiving(null)}
          markPaid={ops.markPaid}
        />
      )}
    </div>
  )
}

/** Route entry (lazy-loaded). */
export function IncomePage() {
  const [today] = useState(todayISO)
  return <Income today={today} />
}
