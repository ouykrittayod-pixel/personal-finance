import { useLiveQuery } from 'dexie-react-hooks'
import { ListFilter, Plus, Receipt, SearchX } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useOptionalQuickEntry } from '@/app/providers/quick-entry-context'
import { PrimaryButton, SecondaryButton } from '@/components/actions/buttons'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { LoadingState } from '@/components/feedback/LoadingState'
import { ProgressBar } from '@/components/feedback/ProgressBar'
import { MoneyDisplay } from '@/components/finance/MoneyDisplay'
import { TransactionGroup } from '@/components/finance/TransactionList'
import { TransactionRow } from '@/components/finance/TransactionRow'
import { SelectField } from '@/components/forms/SelectField'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ISODate } from '@/domain/entities'
import { LedgerFilters } from '@/features/transactions/components/LedgerFilters'
import { TransactionDetailSheet, type TransactionDetailSheetProps } from '@/features/transactions/detail/TransactionDetailSheet'
import { SEARCH_DEBOUNCE_MS } from '@/features/transactions/TransactionsPage'
import type { LedgerRawData } from '@/features/transactions/ledger-data'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { todayISO } from '@/lib/dates'
import { formatDate, formatTHB } from '@/lib/formatting'
import { t } from '@/lib/i18n'
import { ALL, buildExpenseBook, defaultExpenseFilters, EXPENSE_PAGE_SIZE, loadExpenseBookData, type ExpenseFilters } from './expense-book-data'

export interface DailyExpensesProps {
  today: ISODate
  /** Injected in tests. */
  load?: () => Promise<LedgerRawData>
  detail?: Pick<TransactionDetailSheetProps, 'load' | 'update' | 'remove'>
}

type LoadResult = { ok: true; raw: LedgerRawData } | { ok: false }

function AmountBound({ label, value, onChange }: { label: string; value: string; onChange: (text: string) => void }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} inputMode="decimal" autoComplete="off" placeholder="฿" value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}

/**
 * รายจ่ายประจำวัน: money already spent (`expense` transactions only), by day —
 * what went where today, this week and this month. Adding uses the app's quick
 * form ("+"); a tap opens the shared transaction detail to edit or delete
 * (with attachments). One data set with the ledger, dashboard, budget,
 * analytics and accounts. URL keeps the open item (`?tx=`).
 */
export function DailyExpenses({ today, load = loadExpenseBookData, detail }: DailyExpensesProps) {
  const quickEntry = useOptionalQuickEntry()
  const [searchParams, setSearchParams] = useSearchParams()
  const [filters, setFilters] = useState<ExpenseFilters>(() => defaultExpenseFilters(today))
  const [searchText, setSearchText] = useState('')
  const search = useDebouncedValue(searchText, SEARCH_DEBOUNCE_MS)
  const effectiveFilters = useMemo(() => (search === filters.search ? filters : { ...filters, search }), [filters, search])
  const filterKey = JSON.stringify(effectiveFilters)
  const [paging, setPaging] = useState({ key: filterKey, limit: EXPENSE_PAGE_SIZE })
  const limit = paging.key === filterKey ? paging.limit : EXPENSE_PAGE_SIZE
  const [moreFilters, setMoreFilters] = useState(false)
  const [attempt, setAttempt] = useState(0)

  const result = useLiveQuery<LoadResult>(
    () => load().then((raw) => ({ ok: true as const, raw }), () => ({ ok: false as const })),
    [load, attempt],
  )
  const raw = result?.ok ? result.raw : null
  const model = useMemo(() => (raw ? buildExpenseBook(raw, effectiveFilters, today, limit) : null), [raw, effectiveFilters, today, limit])

  const setTx = (id: string | null) =>
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params)
        if (id) next.set('tx', id)
        else next.delete('tx')
        return next
      },
      { replace: id === null },
    )

  const addButton = quickEntry && (
    <PrimaryButton onClick={quickEntry.openExpense}>
      <Plus aria-hidden="true" />
      {t('expenses.add')}
    </PrimaryButton>
  )
  const extraFilters = [filters.categoryId !== ALL, filters.accountId !== ALL, filters.minAmount.trim() !== '', filters.maxAmount.trim() !== ''].filter(Boolean).length
  const clearExtra = () => setFilters({ ...filters, categoryId: ALL, accountId: ALL, minAmount: '', maxAmount: '' })

  return (
    <div className="flex flex-col gap-section">
      <PageHeader title={t('nav.expenses')} description={t('expenses.subtitle')} actions={addButton} />

      {result === undefined && <LoadingState variant="cards" count={3} />}
      {result && !result.ok && <ErrorState onRetry={() => setAttempt((n) => n + 1)} />}

      {model && (
        <>
          <Card className="gap-3 px-card" aria-labelledby="expenses-month">
            <div className="flex flex-col gap-1">
              <h2 id="expenses-month" className="text-sm text-muted-foreground">
                {t('expenses.summary.month')}
              </h2>
              <MoneyDisplay amount={model.summary.month} size="xl" />
            </div>
            <dl className="grid grid-cols-2 gap-stack border-t pt-3">
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">{t('expenses.summary.today')}</dt>
                <dd>
                  <MoneyDisplay amount={model.summary.today} size="md" />
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">{t('expenses.summary.week')}</dt>
                <dd>
                  <MoneyDisplay amount={model.summary.week} size="md" />
                </dd>
              </div>
            </dl>
          </Card>

          <section aria-label={t('expenses.list')} className="flex flex-col gap-stack">
            <LedgerFilters
              filters={filters}
              searchText={searchText}
              onSearchTextChange={setSearchText}
              onChange={(next) => setFilters({ ...filters, ...next, search: filters.search })}
              rangeReversed={model.rangeReversed}
              today={today}
              showTypes={false}
              searchLabel={t('expenses.searchLabel')}
              searchPlaceholder={t('expenses.search')}
            />

            <div className="flex flex-wrap items-center gap-2">
              <SecondaryButton onClick={() => setMoreFilters((open) => !open)} aria-expanded={moreFilters}>
                <ListFilter aria-hidden="true" />
                {extraFilters > 0 ? t('expenses.filter.moreCount', { count: extraFilters }) : t('expenses.filter.more')}
              </SecondaryButton>
              {extraFilters > 0 && (
                <SecondaryButton onClick={clearExtra}>{t('expenses.filter.clear')}</SecondaryButton>
              )}
            </div>
            {moreFilters && (
              <div className="grid gap-stack sm:grid-cols-2">
                <SelectField label={t('expenses.filter.category')} value={filters.categoryId} options={model.categoryOptions} onValueChange={(categoryId) => setFilters({ ...filters, categoryId })} />
                <SelectField label={t('expenses.filter.account')} value={filters.accountId} options={model.accountOptions} onValueChange={(accountId) => setFilters({ ...filters, accountId })} />
                <AmountBound label={t('expenses.filter.min')} value={filters.minAmount} onChange={(minAmount) => setFilters({ ...filters, minAmount })} />
                <AmountBound label={t('expenses.filter.max')} value={filters.maxAmount} onChange={(maxAmount) => setFilters({ ...filters, maxAmount })} />
                {model.amountInvalid && (
                  <p role="alert" className="text-xs text-destructive sm:col-span-2">
                    {t('expenses.filter.amountInvalid')}
                  </p>
                )}
              </div>
            )}

            {model.emptyReason === 'no_data' && <EmptyState icon={Receipt} title={t('expenses.empty')} description={t('expenses.emptyHint')} action={addButton} />}
            {model.emptyReason === 'no_match' && <EmptyState icon={SearchX} title={t('expenses.noMatch')} description={t('expenses.noMatchHint')} />}

            {model.matchCount > 0 && (
              <>
                <div className="flex items-baseline justify-between gap-3" aria-live="polite">
                  <p className="text-sm text-muted-foreground">
                    {t('expenses.periodTotal', { start: formatDate(model.range.start), end: formatDate(model.range.end), count: model.matchCount })}
                  </p>
                  <MoneyDisplay amount={model.total} size="md" />
                </div>

                {model.categories.length > 1 && (
                  <Card className="gap-3 px-card" aria-labelledby="expenses-by-category">
                    <h2 id="expenses-by-category" className="text-sm font-semibold">
                      {t('expenses.byCategory')}
                    </h2>
                    <ul className="flex flex-col gap-3">
                      {model.categories.map((share) => (
                        <li key={share.id} className="flex flex-col gap-1">
                          <div className="flex items-baseline justify-between gap-3 text-sm">
                            <span className="min-w-0 truncate">
                              {share.icon ? `${share.icon} ` : ''}
                              {share.label}
                            </span>
                            <span className="flex shrink-0 items-baseline gap-2">
                              <span className="text-xs text-muted-foreground">{(share.shareBps / 100).toFixed(0)}%</span>
                              <MoneyDisplay amount={share.amount} size="sm" />
                            </span>
                          </div>
                          <ProgressBar value={share.shareBps / 100} label={share.label} tone="expense" size="sm" valueText={formatTHB(share.amount, { trimZeroFraction: true })} />
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}

                <Card className="gap-0 py-0">
                  {model.days.map((day) => (
                    <TransactionGroup
                      key={day.date}
                      headingLevel={2}
                      title={
                        <time dateTime={day.date}>
                          {day.label}
                          {day.dateLabel && <span className="font-normal"> · {day.dateLabel}</span>}
                        </time>
                      }
                      summary={
                        <span>
                          {t('expenses.dayTotal')} <MoneyDisplay amount={day.total} size="sm" className="font-medium text-foreground" />
                        </span>
                      }
                    >
                      {day.rows.map((row) => (
                        <TransactionRow
                          key={row.id}
                          type={row.type}
                          title={row.title}
                          amount={row.amount}
                          categoryLabel={row.categoryLabel}
                          categoryIcon={row.categoryIcon}
                          accountLabel={row.accountLabel}
                          hasAttachment={row.hasAttachment}
                          onSelect={() => setTx(row.id)}
                        />
                      ))}
                    </TransactionGroup>
                  ))}
                </Card>
                <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
                  <p>{t('expenses.count', { shown: model.shownCount, total: model.matchCount })}</p>
                  {model.shownCount < model.matchCount && (
                    <SecondaryButton onClick={() => setPaging({ key: filterKey, limit: limit + EXPENSE_PAGE_SIZE })}>
                      {t('ledger.loadMore', { count: Math.min(EXPENSE_PAGE_SIZE, model.matchCount - model.shownCount) })}
                    </SecondaryButton>
                  )}
                </div>
              </>
            )}
          </section>
        </>
      )}

      <TransactionDetailSheet transactionId={searchParams.get('tx')} onClose={() => setTx(null)} today={today} {...detail} />
    </div>
  )
}

/** Route entry (lazy-loaded). */
export function ExpensesPage() {
  const [today] = useState(todayISO)
  return <DailyExpenses today={today} />
}
