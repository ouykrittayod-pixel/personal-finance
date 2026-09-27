import { Plus, ReceiptText, SearchX, X } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { useOptionalQuickEntry } from '@/app/providers/quick-entry-context'
import { PrimaryButton, SecondaryButton } from '@/components/actions/buttons'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { LoadingState } from '@/components/feedback/LoadingState'
import { TransactionGroup } from '@/components/finance/TransactionList'
import { TransactionRow } from '@/components/finance/TransactionRow'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import type { ISODate } from '@/domain/entities'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { todayISO } from '@/lib/dates'
import { t } from '@/lib/i18n'
import { LedgerFilters } from './components/LedgerFilters'
import { LedgerSummary } from './components/LedgerSummary'
import { TransactionDetailSheet, type TransactionDetailSheetProps } from './detail/TransactionDetailSheet'
import { filtersFromParams, loadLedgerData, PAGE_SIZE, type LedgerFilters as Filters, type LedgerRawData } from './ledger-data'
import { useLedger } from './use-ledger'

export const SEARCH_DEBOUNCE_MS = 200

export interface TransactionsProps {
  today: ISODate
  /** Injected in tests. */
  load?: () => Promise<LedgerRawData>
  detail?: Pick<TransactionDetailSheetProps, 'load' | 'update' | 'remove'>
}

/**
 * The ledger: every transaction, newest first, grouped by day.
 * The open transaction lives in the URL (`#/transactions?tx=<id>`), so the
 * phone's back button closes the full-screen detail view.
 */
export function Transactions({ today, load = loadLedgerData, detail }: TransactionsProps) {
  const quickEntry = useOptionalQuickEntry()
  const [searchParams, setSearchParams] = useSearchParams()
  // A deep link (?month=&type=&category=) sets the starting filters; the page is the ledger as usual.
  const [filters, setFilters] = useState<Filters>(() => filtersFromParams(searchParams, today))
  const [searchText, setSearchText] = useState('')
  const search = useDebouncedValue(searchText, SEARCH_DEBOUNCE_MS)
  const effectiveFilters = search === filters.search ? filters : { ...filters, search }

  // Show one page again whenever the filters change.
  const filterKey = JSON.stringify(effectiveFilters)
  const [paging, setPaging] = useState({ key: filterKey, limit: PAGE_SIZE })
  const limit = paging.key === filterKey ? paging.limit : PAGE_SIZE

  const state = useLedger(effectiveFilters, today, limit, load)
  const selectedId = searchParams.get('tx')

  const openDetail = (id: string) =>
    setSearchParams((params) => {
      const next = new URLSearchParams(params)
      next.set('tx', id)
      return next
    })
  const closeDetail = () =>
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params)
        next.delete('tx')
        return next
      },
      { replace: true },
    )

  const addButton = quickEntry && (
    <PrimaryButton onClick={quickEntry.openMenu}>
      <Plus aria-hidden="true" />
      {t('ledger.add')}
    </PrimaryButton>
  )

  return (
    <div className="flex flex-col gap-section">
      <PageHeader title={t('ledger.title')} description={t('ledger.subtitle')} actions={addButton} />

      {state.status === 'ready' && <LedgerSummary totals={state.model.summary} range={state.model.range} />}

      <LedgerFilters
        filters={filters}
        searchText={searchText}
        onSearchTextChange={setSearchText}
        onChange={(next) => setFilters({ ...next, search: filters.search })}
        rangeReversed={state.status === 'ready' && state.model.rangeReversed}
        today={today}
      />

      {filters.categoryId && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>{t('ledger.categoryFilter', { name: state.status === 'ready' ? (state.model.categoryName ?? '—') : '…' })}</span>
          <SecondaryButton
            onClick={() => {
              setFilters({ ...filters, categoryId: undefined })
              setSearchParams(
                (params) => {
                  const next = new URLSearchParams(params)
                  next.delete('category')
                  return next
                },
                { replace: true },
              )
            }}
          >
            <X aria-hidden="true" />
            {t('ledger.clearCategory')}
          </SecondaryButton>
        </div>
      )}

      {state.status === 'loading' && (
        <Card className="py-0">
          <LoadingState variant="list" count={6} />
        </Card>
      )}
      {state.status === 'error' && <ErrorState onRetry={state.retry} />}

      {state.status === 'ready' && state.model.emptyReason === 'no_data' && (
        <EmptyState
          icon={ReceiptText}
          title={t('ledger.empty')}
          description={t('ledger.emptyHint')}
          action={
            quickEntry && (
              <PrimaryButton onClick={quickEntry.openMenu}>
                <Plus aria-hidden="true" />
                {t('ledger.addFirst')}
              </PrimaryButton>
            )
          }
        />
      )}
      {state.status === 'ready' && state.model.emptyReason === 'no_search' && (
        <EmptyState icon={SearchX} title={t('ledger.noSearch')} description={t('ledger.noSearchHint')} />
      )}
      {state.status === 'ready' && state.model.emptyReason === 'no_period' && (
        <EmptyState icon={SearchX} title={t('ledger.noPeriod')} description={t('ledger.noPeriodHint')} />
      )}

      {state.status === 'ready' && state.model.groups.length > 0 && (
        <section aria-label={t('ledger.list')} className="flex flex-col gap-stack">
          <Card className="gap-0 py-0">
            {state.model.groups.map((group) => (
              <TransactionGroup key={group.date} headingLevel={2} title={<time dateTime={group.date}>{group.label}</time>}>
                {group.rows.map((row) => (
                  <TransactionRow
                    key={row.id}
                    type={row.type}
                    title={row.title}
                    amount={row.amount}
                    categoryLabel={row.categoryLabel}
                    categoryIcon={row.categoryIcon}
                    accountLabel={row.accountLabel}
                    toAccountLabel={row.toAccountLabel}
                    hasAttachment={row.hasAttachment}
                    onSelect={() => openDetail(row.id)}
                  />
                ))}
              </TransactionGroup>
            ))}
          </Card>
          <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
            <p aria-live="polite">{t('ledger.count', { shown: state.model.shownCount, total: state.model.matchCount })}</p>
            {state.model.shownCount < state.model.matchCount && (
              <SecondaryButton onClick={() => setPaging({ key: filterKey, limit: limit + PAGE_SIZE })}>
                {t('ledger.loadMore', { count: Math.min(PAGE_SIZE, state.model.matchCount - state.model.shownCount) })}
              </SecondaryButton>
            )}
          </div>
        </section>
      )}

      <TransactionDetailSheet transactionId={selectedId} onClose={closeDetail} today={today} {...detail} />
    </div>
  )
}

/** Route entry (lazy-loaded). */
export function TransactionsPage() {
  const [today] = useState(todayISO)
  return <Transactions today={today} />
}
