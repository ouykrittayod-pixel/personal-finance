import { useLiveQuery } from 'dexie-react-hooks'
import { Gauge, List, Pencil, PiggyBank, Plus, Receipt, Trash2, Wallet } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { PrimaryButton, SecondaryButton } from '@/components/actions/buttons'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { LoadingState } from '@/components/feedback/LoadingState'
import { ProgressBar } from '@/components/feedback/ProgressBar'
import { useToast } from '@/components/feedback/toast-context'
import { MoneyDisplay } from '@/components/finance/MoneyDisplay'
import { StatCard } from '@/components/finance/StatCard'
import { StatusBadge } from '@/components/finance/StatusBadge'
import { PageHeader } from '@/components/layout/PageHeader'
import { MonthSelector } from '@/components/navigation/MonthSelector'
import { Dialog } from '@/components/overlays/Dialog'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { OVERALL_BUDGET } from '@/domain/budget'
import type { Budget, ISODate } from '@/domain/entities'
import { formatMoney, negate, type Satang } from '@/domain/money'
import { ExpenseSetup } from '@/features/expenses/quick-expense/ExpenseSetup'
import { ledgerLinkFor } from '@/features/transactions/ledger-data'
import { formatYearMonth, isYearMonth, todayISO, yearMonthOf } from '@/lib/dates'
import { formatTHB } from '@/lib/formatting'
import { APP_LOCALE, t } from '@/lib/i18n'
import { buildBudgetModel, describeBudgetRow, formatUsage, loadBudgetData, STATUS_BADGE, STATUS_TONE, type BudgetRawData, type BudgetRow } from './budget-data'
import { budgetFailureToErrors, defaultBudgetOps, type BudgetOps } from './budget-ops'
import { BudgetFormSheet } from './components/BudgetFormSheet'

export interface BudgetProps {
  today: ISODate
  /** Injected in tests. */
  load?: () => Promise<BudgetRawData>
  ops?: BudgetOps
}

type LoadResult = { ok: true; raw: BudgetRawData } | { ok: false }

const money = (amount: Satang) => formatTHB(amount, { trimZeroFraction: true })
/** Plain number for screen-reader sentences ("6,000"). */
const baht = (amount: Satang) => formatMoney(amount, { locale: APP_LOCALE, symbol: false, trimZeroFraction: true })

function BudgetCard({ row, month, onEdit, onDelete }: { row: BudgetRow; month: string; onEdit: () => void; onDelete: () => void }) {
  const unused = row.spent === 0
  return (
    <li>
      <Card className="h-full gap-stack px-card">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-neutral-muted text-lg">
            {row.overall ? <Gauge className="size-5" /> : (row.icon ?? <Wallet className="size-5" />)}
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <h3 className="truncate text-sm font-semibold">
              {row.name}
              {row.archivedCategory && <span className="font-normal text-muted-foreground"> {t('budget.archivedCategory')}</span>}
            </h3>
            <p className="text-xs text-muted-foreground" aria-hidden="true">
              {t('budget.line.limit', { amount: money(row.limit) })}
            </p>
          </div>
          <StatusBadge status={STATUS_BADGE[row.status]} label={t(`budget.status.${row.status}`)} />
        </div>

        {/* One sentence for screen readers; the visual figures below are hidden from them. */}
        <p className="sr-only">{describeBudgetRow(row, baht)}</p>
        <div aria-hidden="true" className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span>{unused ? t('budget.line.unused', { amount: money(row.limit) }) : t('budget.line.spent', { amount: money(row.spent) })}</span>
            {!unused && (
              <span className={row.overBy > 0 ? 'font-medium text-expense' : 'text-muted-foreground'}>
                {row.overBy > 0 ? t('budget.line.over', { amount: money(row.overBy) }) : t('budget.line.left', { amount: money(row.remaining) })}
              </span>
            )}
          </div>
          <ProgressBar
            value={(row.usageBps ?? 0) / 100}
            label={row.name}
            valueText={row.usageBps === null ? '—' : formatUsage(row.usageBps)}
            tone={STATUS_TONE[row.status]}
            size="sm"
          />
          <span className="text-xs text-muted-foreground">{t('budget.line.progress', { percent: row.usageBps === null ? '—' : formatUsage(row.usageBps) })}</span>
        </div>

        <div className="flex flex-wrap gap-2">
          <SecondaryButton asChild>
            <Link to={ledgerLinkFor(month, row.overall ? undefined : row.budget.categoryId)} aria-label={t('budget.action.viewFor', { name: row.name })}>
              <List aria-hidden="true" />
              {t('budget.action.view')}
            </Link>
          </SecondaryButton>
          <SecondaryButton onClick={onEdit} aria-label={t('budget.action.editFor', { name: row.name })}>
            <Pencil aria-hidden="true" />
            {t('budget.action.edit')}
          </SecondaryButton>
          <Button variant="ghost" size="touch" onClick={onDelete} aria-label={t('budget.action.deleteFor', { name: row.name })}>
            <Trash2 aria-hidden="true" />
            <span className="max-sm:sr-only">{t('budget.action.delete')}</span>
          </Button>
        </div>
      </Card>
    </li>
  )
}

/**
 * Budget: monthly plans (per expense category, plus an optional overall limit)
 * against actual expense transactions. The month lives in the URL
 * (`#/budget?month=2026-09`); the current month has no parameter.
 */
export function BudgetView({ today, load = loadBudgetData, ops = defaultBudgetOps }: BudgetProps) {
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const currentMonth = yearMonthOf(today)
  const param = searchParams.get('month')
  const month = isYearMonth(param) ? param : currentMonth
  const [formTarget, setFormTarget] = useState<null | 'create' | Budget>(null)
  const [deleting, setDeleting] = useState<BudgetRow | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [attempt, setAttempt] = useState(0)

  const result = useLiveQuery<LoadResult>(
    () => load().then((raw) => ({ ok: true as const, raw }), () => ({ ok: false as const })),
    [load, attempt],
  )
  const raw = result?.ok ? result.raw : null
  const model = useMemo(() => (raw ? buildBudgetModel(raw, month) : null), [raw, month])

  const setMonth = (next: string) => setSearchParams(next === currentMonth ? {} : { month: next }, { replace: true })
  const nameOf = (budget: Pick<Budget, 'categoryId'>) =>
    budget.categoryId === OVERALL_BUDGET ? t('budget.overall.name') : (raw?.categories.find((c) => c.id === budget.categoryId)?.name ?? '')

  async function confirmDelete(row: BudgetRow) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await ops.remove(row.id)
      toast.show({ message: t('budget.toast.deleted', { name: row.name }) })
      setDeleting(null)
    } catch (error) {
      const errors = budgetFailureToErrors(error)
      toast.show({ message: errors.form ?? t('budget.error.failed'), tone: 'error' })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const addButton = (
    <PrimaryButton onClick={() => setFormTarget('create')} disabled={!raw}>
      <Plus aria-hidden="true" />
      {t('budget.add')}
    </PrimaryButton>
  )
  const headline = model?.headline
  const overallScope = headline?.scope === 'overall'

  return (
    <div className="flex flex-col gap-section">
      <PageHeader
        title={t('budget.title')}
        description={month === currentMonth ? t('budget.subtitle') : t('budget.subtitleMonth', { month: formatYearMonth(month) })}
        actions={
          <>
            <MonthSelector value={month} onChange={setMonth} currentMonth={currentMonth} />
            {addButton}
          </>
        }
      />

      {result === undefined && <LoadingState variant="cards" count={4} />}
      {result && !result.ok && <ErrorState onRetry={() => setAttempt((n) => n + 1)} />}

      {model && !model.hasExpenseCategories && (
        <Card className="px-card">
          <p className="text-sm text-muted-foreground">{t('budget.needCategories')}</p>
          <ExpenseSetup hasCategories={false} hasAccounts today={today} />
        </Card>
      )}

      {model && !headline && (
        <EmptyState icon={PiggyBank} title={t('budget.empty')} description={t('budget.emptyHint')} action={addButton} />
      )}

      {model && headline && (
        <>
          <section aria-label={t('budget.summary')} className="grid grid-cols-2 gap-stack lg:grid-cols-4">
            <StatCard
              label={overallScope ? t('budget.summary.overallLimit') : t('budget.summary.categoryLimit')}
              icon={PiggyBank}
              tone="primary"
              value={<MoneyDisplay amount={headline.limit} size="lg" />}
              hint={overallScope ? t('budget.summary.overallHint') : t('budget.summary.categoryHint')}
            />
            <StatCard
              label={t('budget.summary.spent')}
              icon={Receipt}
              tone="expense"
              value={<MoneyDisplay amount={headline.spent} size="lg" />}
              hint={overallScope ? t('budget.summary.spentOverallHint') : t('budget.summary.spentCategoryHint')}
            />
            <StatCard
              label={headline.remaining < 0 ? t('budget.summary.over') : t('budget.summary.remaining')}
              icon={Wallet}
              tone={headline.remaining < 0 ? 'expense' : 'income'}
              value={<MoneyDisplay amount={headline.remaining < 0 ? negate(headline.remaining) : headline.remaining} size="lg" />}
            />
            <StatCard
              label={t('budget.summary.usage')}
              icon={Gauge}
              tone={STATUS_TONE[headline.status] === 'expense' ? 'expense' : STATUS_TONE[headline.status] === 'warning' ? 'warning' : 'income'}
              value={<span className="amount-lg">{headline.usageBps === null ? t('budget.summary.noUsage') : formatUsage(headline.usageBps)}</span>}
              hint={t(`budget.status.${headline.status}`)}
            />
          </section>

          {model.overall && (
            <ul aria-label={t('budget.overall.name')} className="grid gap-stack">
              <BudgetCard row={model.overall} month={month} onEdit={() => setFormTarget(model.overall!.budget)} onDelete={() => setDeleting(model.overall)} />
            </ul>
          )}

          {model.rows.length > 0 && (
            <section className="flex flex-col gap-stack">
              <h2 className="text-base font-semibold">{t('budget.list')}</h2>
              <ul aria-label={t('budget.list')} className="grid gap-stack md:grid-cols-2">
                {model.rows.map((row) => (
                  <BudgetCard key={row.id} row={row} month={month} onEdit={() => setFormTarget(row.budget)} onDelete={() => setDeleting(row)} />
                ))}
              </ul>
            </section>
          )}

          {model.unbudgetedSpent > 0 && <p className="text-sm text-muted-foreground">{t('budget.unbudgeted', { amount: money(model.unbudgetedSpent) })}</p>}
        </>
      )}

      {raw && (
        <BudgetFormSheet
          target={formTarget}
          month={month}
          currentMonth={currentMonth}
          categories={raw.categories}
          budgets={raw.budgets}
          onClose={() => setFormTarget(null)}
          onEditExisting={(budget) => setFormTarget(budget)}
          ops={ops}
          nameOf={nameOf}
        />
      )}

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null)
        }}
        title={t('budget.delete.title')}
        description={t('budget.delete.hint')}
        footer={
          <>
            <SecondaryButton onClick={() => setDeleting(null)} disabled={busy}>
              {t('detail.cancel')}
            </SecondaryButton>
            <Button variant="destructive" size="touch" disabled={busy} onClick={() => deleting && void confirmDelete(deleting)}>
              <Trash2 aria-hidden="true" />
              {t('budget.action.delete')}
            </Button>
          </>
        }
      >
        {deleting && (
          <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-sm">
            <span className="min-w-0 truncate font-medium">{deleting.name}</span>
            <MoneyDisplay amount={deleting.limit} />
          </div>
        )}
      </Dialog>
    </div>
  )
}

/** Route entry (lazy-loaded). */
export function BudgetPage() {
  const [today] = useState(todayISO)
  return <BudgetView today={today} />
}
