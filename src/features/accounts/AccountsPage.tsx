import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeftRight, CreditCard, LineChart, Plus, Search, SearchX, Wallet, WalletCards } from 'lucide-react'
import { createElement, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useOptionalQuickEntry } from '@/app/providers/quick-entry-context'
import { PrimaryButton, SecondaryButton } from '@/components/actions/buttons'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { LoadingState } from '@/components/feedback/LoadingState'
import { ACCOUNT_KIND_VISUALS } from '@/components/finance/account-visuals'
import { MoneyDisplay } from '@/components/finance/MoneyDisplay'
import { StatCard } from '@/components/finance/StatCard'
import { StatusBadge } from '@/components/finance/StatusBadge'
import { ChoiceGroup } from '@/components/forms/ChoiceGroup'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { Account, ISODate } from '@/domain/entities'
import { TransactionDetailSheet, type TransactionDetailSheetProps } from '@/features/transactions/detail/TransactionDetailSheet'
import { todayISO } from '@/lib/dates'
import { t } from '@/lib/i18n'
import { buildAccountDetail, buildAccountsModel, loadAccountsData, ACCOUNT_FILTERS, type AccountFilter, type AccountRow, type AccountsRawData } from './accounts-data'
import { defaultAccountsOps, type AccountsOps } from './accounts-ops'
import { AccountDetailSheet, LiabilityBalance } from './components/AccountDetailSheet'
import { AccountFormSheet } from './components/AccountFormSheet'

export interface AccountsProps {
  today: ISODate
  /** Injected in tests. */
  load?: () => Promise<AccountsRawData>
  ops?: AccountsOps
  detail?: Pick<TransactionDetailSheetProps, 'load' | 'update' | 'remove'>
}

type LoadResult = { ok: true; raw: AccountsRawData } | { ok: false }

function AccountCard({ row, onOpen }: { row: AccountRow; onOpen: () => void }) {
  const kindLabel = t(ACCOUNT_KIND_VISUALS[row.kind].labelKey)
  return (
    <li>
      <Card className="h-full py-0">
        <button
          type="button"
          onClick={onOpen}
          className="focus-ring flex h-full min-h-touch w-full items-center gap-3 rounded-xl p-card text-left transition-colors duration-(--duration-fast) hover:bg-muted/60"
        >
          <span aria-hidden="true" className={row.liability ? 'flex size-10 shrink-0 items-center justify-center rounded-full bg-debt-muted text-debt' : 'flex size-10 shrink-0 items-center justify-center rounded-full bg-neutral-muted'}>
            {createElement(ACCOUNT_KIND_VISUALS[row.kind].icon, { className: 'size-5' })}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-semibold">{row.name}</span>
            <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {kindLabel}
              {row.archived && <StatusBadge status="closed" label={t('accounts.status.archived')} />}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="sr-only">{t('accounts.balanceLabel')} </span>
            {row.liability ? <LiabilityBalance balance={row.balance} size="md" /> : <MoneyDisplay amount={row.balance} size="md" />}
          </span>
        </button>
      </Card>
    </li>
  )
}

/**
 * Accounts: where money is held (and card balances owed). Balances are derived
 * from opening balance + transactions; this page never creates transactions
 * except through the shared transfer form. The open account lives in the URL
 * (`#/accounts?id=`, a transaction from it at `&tx=`), so the phone's back button closes it.
 */
export function Accounts({ today, load = loadAccountsData, ops = defaultAccountsOps, detail }: AccountsProps) {
  const quickEntry = useOptionalQuickEntry()
  const [searchParams, setSearchParams] = useSearchParams()
  const [filter, setFilter] = useState<AccountFilter>('active')
  const [search, setSearch] = useState('')
  const [formTarget, setFormTarget] = useState<null | 'create' | Account>(null)
  const [attempt, setAttempt] = useState(0)

  const result = useLiveQuery<LoadResult>(
    () => load().then((raw) => ({ ok: true as const, raw }), () => ({ ok: false as const })),
    [load, attempt],
  )
  const raw = result?.ok ? result.raw : null
  const model = useMemo(() => (raw ? buildAccountsModel(raw, { filter, search }) : null), [raw, filter, search])
  const selectedId = searchParams.get('id')
  const accountDetail = useMemo(() => (raw && selectedId ? buildAccountDetail(raw, selectedId) : null), [raw, selectedId])

  const setParam = (key: 'id' | 'tx', value: string | null) =>
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params)
        if (value) next.set(key, value)
        else next.delete(key)
        if (key === 'id' && !value) next.delete('tx')
        return next
      },
      { replace: value === null },
    )

  const addButton = (
    <PrimaryButton onClick={() => setFormTarget('create')} disabled={!raw}>
      <Plus aria-hidden="true" />
      {t('accounts.add')}
    </PrimaryButton>
  )
  const transferButton = quickEntry && (
    <SecondaryButton onClick={() => quickEntry.openTransfer()} disabled={!raw}>
      <ArrowLeftRight aria-hidden="true" />
      {t('accounts.transfer')}
    </SecondaryButton>
  )
  const editing = formTarget && formTarget !== 'create' ? formTarget : null
  const editingHistory = editing && raw ? raw.transactions.filter((tx) => tx.accountId === editing.id || tx.toAccountId === editing.id).length : 0

  return (
    <div className="flex flex-col gap-section">
      <PageHeader
        title={t('accounts.title')}
        description={t('accounts.subtitle')}
        actions={
          <>
            {transferButton}
            {addButton}
          </>
        }
      />

      {result === undefined && <LoadingState variant="cards" count={4} />}
      {result && !result.ok && <ErrorState onRetry={() => setAttempt((n) => n + 1)} />}

      {model && model.emptyReason === 'no_data' && <EmptyState icon={WalletCards} title={t('accounts.empty')} description={t('accounts.emptyHint')} action={addButton} />}

      {model && model.emptyReason !== 'no_data' && (
        <>
          <section aria-label={t('accounts.summary')} className="grid grid-cols-2 gap-stack lg:grid-cols-4">
            <StatCard
              className="col-span-2 lg:col-span-1"
              label={t('accounts.metric.available')}
              icon={Wallet}
              tone="primary"
              value={<MoneyDisplay amount={model.summary.available} size="lg" />}
              hint={t('accounts.metric.availableHint')}
            />
            <StatCard
              label={t('accounts.metric.count')}
              icon={WalletCards}
              tone="neutral"
              value={<span className="amount-lg">{model.summary.activeCount}</span>}
              hint={t('accounts.metric.countValue', { active: model.summary.activeCount, total: model.summary.totalCount })}
            />
            {model.summary.hasCards && (
              <StatCard
                label={t('accounts.metric.cardOwed')}
                icon={CreditCard}
                tone="debt"
                value={<MoneyDisplay amount={model.summary.cardOwed} tone="debt" size="lg" />}
                hint={t('accounts.metric.cardOwedHint')}
              />
            )}
            {model.summary.hasInvestments && (
              <StatCard
                label={t('accounts.metric.investment')}
                icon={LineChart}
                tone="info"
                value={<MoneyDisplay amount={model.summary.investment} size="lg" />}
                hint={t('accounts.metric.investmentHint')}
              />
            )}
          </section>

          <div className="flex flex-col gap-stack lg:flex-row lg:items-center lg:justify-between">
            <div className="relative lg:w-80">
              <label htmlFor="accounts-search" className="sr-only">
                {t('accounts.searchLabel')}
              </label>
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input id="accounts-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('accounts.search')} autoComplete="off" className="pl-9" />
            </div>
            <ChoiceGroup
              legend={t('accounts.filter')}
              hideLegend
              layout="scroll"
              name="accounts-filter"
              options={ACCOUNT_FILTERS.map((value) => ({ value, label: t(`accounts.filter.${value}`) }))}
              value={filter}
              onValueChange={(value) => setFilter(value as AccountFilter)}
            />
          </div>

          {model.emptyReason === 'no_match' ? (
            <EmptyState icon={SearchX} title={t('accounts.noMatch')} />
          ) : (
            <ul aria-label={t('accounts.list')} className="grid gap-stack sm:grid-cols-2 xl:grid-cols-3">
              {model.rows.map((row) => (
                <AccountCard key={row.id} row={row} onOpen={() => setParam('id', row.id)} />
              ))}
            </ul>
          )}
        </>
      )}

      <AccountFormSheet target={formTarget} historyCount={editingHistory} onClose={() => setFormTarget(null)} today={today} ops={ops} onCreated={(id) => setParam('id', id)} />
      <AccountDetailSheet
        detail={accountDetail}
        loading={result === undefined}
        accountId={selectedId}
        onClose={() => setParam('id', null)}
        onEdit={setFormTarget}
        onTransfer={(from) => quickEntry?.openTransfer(from)}
        onOpenTransaction={(id) => setParam('tx', id)}
        ops={ops}
      />
      <TransactionDetailSheet transactionId={searchParams.get('tx')} onClose={() => setParam('tx', null)} today={today} {...detail} />
    </div>
  )
}

/** Route entry (lazy-loaded). */
export function AccountsPage() {
  const [today] = useState(todayISO)
  return <Accounts today={today} />
}
