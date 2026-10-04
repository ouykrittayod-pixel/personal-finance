import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeftRight, CalendarRange, CreditCard, HandCoins, Plus, Receipt } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { PrimaryButton, SecondaryButton } from '@/components/actions/buttons'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { LoadingState } from '@/components/feedback/LoadingState'
import { MoneyDisplay } from '@/components/finance/MoneyDisplay'
import type { MoneyTone } from '@/components/finance/money-format'
import { StatusBadge, type StatusKind } from '@/components/finance/StatusBadge'
import { PageHeader } from '@/components/layout/PageHeader'
import { MonthSelector } from '@/components/navigation/MonthSelector'
import { Card } from '@/components/ui/card'
import type { ISODate, RecurringObligation, ScheduledPayment } from '@/domain/entities'
import type { Satang } from '@/domain/money'
import type { PlanGroup, PlanItem } from '@/domain/plan'
import { EditAmountDialog } from '@/features/recurring/components/EditAmountDialog'
import { PayScheduledSheet } from '@/features/recurring/components/PayScheduledSheet'
import { RecurringDetailSheet } from '@/features/recurring/components/RecurringDetailSheet'
import { RecurringFormSheet, type RecurringFormInitial } from '@/features/recurring/components/RecurringFormSheet'
import { defaultRecurringOps, type RecurringOps } from '@/features/recurring/recurring-ops'
import { formatYearMonth, isYearMonth, todayISO } from '@/lib/dates'
import { formatDate, formatTHB } from '@/lib/formatting'
import { t, type MessageKey } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { buildPlanModel, loadPlanData, type MonthSummary, type PlanRawData } from './plan-data'

export interface PlanProps {
  today: ISODate
  /** Injected in tests. */
  load?: () => Promise<PlanRawData>
  ops?: RecurringOps
}

type LoadResult = { ok: true; raw: PlanRawData } | { ok: false }

const GROUP: Record<PlanGroup, { icon: typeof Receipt; iconClass: string; tone: MoneyTone; pay: MessageKey }> = {
  income: { icon: HandCoins, iconClass: 'bg-income-muted text-income', tone: 'income', pay: 'plan.action.received' },
  bill: { icon: Receipt, iconClass: 'bg-expense-muted text-expense', tone: 'expense', pay: 'plan.action.paid' },
  debt: { icon: CreditCard, iconClass: 'bg-debt-muted text-debt', tone: 'debt', pay: 'plan.action.paid' },
  transfer: { icon: ArrowLeftRight, iconClass: 'bg-neutral-muted text-foreground', tone: 'neutral', pay: 'plan.action.transferred' },
}

function statusOf(item: PlanItem): { kind: StatusKind; label: string } {
  const income = item.group === 'income'
  switch (item.status) {
    case 'paid':
      return { kind: 'paid', label: t(income ? 'income.status.received' : item.group === 'transfer' ? 'plan.status.transferred' : 'status.paid') }
    case 'skipped':
      return { kind: 'skipped', label: t('status.skipped') }
    case 'overdue':
      return { kind: 'overdue', label: t(income ? 'plan.status.notReceived' : 'status.overdue') }
    case 'projected':
      return { kind: 'pending', label: t('plan.status.projected') }
    case 'pending':
      return { kind: 'pending', label: t(income ? 'income.status.pending' : 'recurring.unpaid') }
  }
}

function Tag({ children }: { children: ReactNode }) {
  return <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[0.6875rem] leading-none text-muted-foreground">{children}</span>
}

function PlanRow({
  item,
  icon,
  onOpen,
  openHref,
  onPay,
  onEditAmount,
}: {
  item: PlanItem
  icon?: string
  onOpen?: () => void
  openHref?: string
  onPay?: () => void
  onEditAmount?: () => void
}) {
  const visual = GROUP[item.group]
  const Icon = visual.icon
  const status = statusOf(item)
  const muted = item.status === 'skipped'
  const due = formatDate(item.dueDate)
  const body = (
    <>
      <span aria-hidden="true" className={cn('flex size-10 shrink-0 items-center justify-center rounded-full text-lg', visual.iconClass)}>
        {icon ?? <Icon className="size-5" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={cn('truncate text-sm font-medium', muted && 'text-muted-foreground line-through')}>{item.name}</span>
        <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <time dateTime={item.dueDate}>{t(item.group === 'income' ? 'plan.expectedOn' : 'recurring.due', { date: due })}</time>
          {item.carriedOver && <Tag>{t('plan.tag.carried', { month: formatYearMonth(item.dueDate.slice(0, 7), 'short') })}</Tag>}
          {item.adjusted && <Tag>{t('plan.tag.adjusted')}</Tag>}
          {item.variable && item.status !== 'paid' && <Tag>{t('plan.tag.variable')}</Tag>}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <MoneyDisplay amount={item.amountSatang} tone={muted ? 'muted' : item.status === 'paid' ? visual.tone : 'neutral'} size="md" />
        {item.actualSatang !== undefined && item.actualSatang !== item.expectedSatang && (
          <span className="text-[0.6875rem] text-muted-foreground">{t('plan.plannedWas', { amount: formatTHB(item.expectedSatang, { trimZeroFraction: true }) })}</span>
        )}
        <StatusBadge status={status.kind} label={status.label} />
      </span>
    </>
  )
  const rowClass = 'focus-ring -m-1 flex min-h-touch min-w-0 flex-1 items-center gap-3 rounded-md p-1 text-left hover:bg-muted/60'
  return (
    <li className="flex flex-col gap-2 px-card py-3">
      {openHref ? (
        <Link to={openHref} className={rowClass}>
          {body}
        </Link>
      ) : onOpen ? (
        <button type="button" onClick={onOpen} className={rowClass}>
          {body}
        </button>
      ) : (
        <div className="-m-1 flex min-w-0 flex-1 items-center gap-3 p-1">{body}</div>
      )}
      {(onPay || onEditAmount) && (
        <div className="flex flex-wrap gap-2 pl-[3.25rem]">
          {onPay && (
            <PrimaryButton onClick={onPay} aria-label={`${t(visual.pay)}: ${item.name} ${due}`}>
              {t(visual.pay)}
            </PrimaryButton>
          )}
          {onEditAmount && (
            <SecondaryButton onClick={onEditAmount} aria-label={t('plan.action.editAmountNamed', { name: item.name, date: due })}>
              {t('plan.action.editAmount')}
            </SecondaryButton>
          )}
        </div>
      )}
    </li>
  )
}

function SummaryLine({ label, amount, tone = 'neutral', hint, strong = false }: { label: string; amount: Satang; tone?: MoneyTone; hint?: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className={cn('text-sm', strong ? 'font-medium' : 'text-muted-foreground')}>
        {label}
        {hint && <span className="block text-xs font-normal text-muted-foreground">{hint}</span>}
      </dt>
      <dd>
        <MoneyDisplay amount={amount} tone={tone} size={strong ? 'md' : 'sm'} />
      </dd>
    </div>
  )
}

function AheadStrip({ months, selected, onSelect }: { months: MonthSummary[]; selected: string; onSelect: (month: string) => void }) {
  return (
    <section aria-labelledby="plan-ahead" className="flex flex-col gap-stack">
      <h2 id="plan-ahead" className="text-base font-semibold">
        {t('plan.ahead.title')}
      </h2>
      <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label={t('plan.ahead.title')}>
        {months.map((m) => {
          const short = m.remaining < 0
          return (
            <li key={m.month} className="shrink-0">
              <button
                type="button"
                onClick={() => onSelect(m.month)}
                aria-pressed={m.month === selected}
                className={cn(
                  'focus-ring flex min-w-28 flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors',
                  m.month === selected ? 'border-primary bg-primary/5' : 'hover:bg-muted/60',
                )}
              >
                <span className="text-xs text-muted-foreground">{formatYearMonth(m.month, 'shortYear')}</span>
                <MoneyDisplay amount={m.remaining} tone={short ? 'expense' : 'income'} size="sm" />
                <span className="text-[0.6875rem] text-muted-foreground">{t(short ? 'plan.ahead.short' : 'plan.ahead.left')}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/**
 * The monthly plan: expected income − what has to be paid = what is left,
 * month by month (the "คงเหลือ" line of a budgeting sheet). Amounts of single
 * months can be planned here (the bill arrived; next month's card payment),
 * one-off items added, and items paid. URL keeps the month (`?month=`) and an
 * open rule (`?rule=`), so back closes it.
 */
export function Plan({ today, load = loadPlanData, ops = defaultRecurringOps }: PlanProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const currentMonth = today.slice(0, 7)
  const monthParam = searchParams.get('month')
  const month = isYearMonth(monthParam) ? monthParam : currentMonth
  const [attempt, setAttempt] = useState(0)
  const [form, setForm] = useState<{ target: 'create' | RecurringObligation; mode: 'outgoing' | 'income'; initial?: RecurringFormInitial } | null>(null)
  const [paying, setPaying] = useState<{ payment: ScheduledPayment; obligation: RecurringObligation } | null>(null)
  const [editing, setEditing] = useState<PlanItem | null>(null)

  // Bring generated months up to date (idempotent; never pays anything by itself).
  useEffect(() => {
    ops.generate().catch(() => {})
  }, [ops, today])

  const result = useLiveQuery<LoadResult>(
    () => load().then((raw) => ({ ok: true as const, raw }), () => ({ ok: false as const })),
    [load, attempt],
  )
  const raw = result?.ok ? result.raw : null
  const model = useMemo(() => (raw ? buildPlanModel(raw, month, today) : null), [raw, month, today])

  const setParam = (key: 'month' | 'rule', value: string | null) =>
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params)
        if (value && !(key === 'month' && value === currentMonth)) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: key === 'month' || value === null },
    )

  const categories = useMemo(() => new Map((raw?.categories ?? []).map((c) => [c.id, c])), [raw])
  const obligations = useMemo(() => new Map((raw?.obligations ?? []).map((o) => [o.id, o])), [raw])
  const payments = useMemo(() => new Map((raw?.payments ?? []).map((p) => [p.id, p])), [raw])
  const formData = raw ? { categories: raw.categories, accounts: raw.accounts, debts: raw.debts } : null
  const newItemDate = month === currentMonth ? today : `${month}-01`

  const open = (item: PlanItem) => item.status !== 'paid' && item.status !== 'skipped'
  const row = (item: PlanItem) => {
    const obligation = item.sourceType === 'obligation' ? obligations.get(item.sourceId) : undefined
    const payment = item.paymentId ? payments.get(item.paymentId) : undefined
    const payTarget = open(item) && item.status !== 'projected' && obligation && payment && !obligation.archivedAt ? { payment, obligation } : null
    return (
      <PlanRow
        key={item.key}
        item={item}
        icon={item.categoryId ? categories.get(item.categoryId)?.icon : undefined}
        onOpen={obligation && !obligation.archivedAt ? () => setParam('rule', obligation.id) : undefined}
        openHref={item.sourceType === 'debt' ? `/debts?id=${item.sourceId}` : undefined}
        onPay={payTarget ? () => setPaying(payTarget) : undefined}
        onEditAmount={open(item) ? () => setEditing(item) : undefined}
      />
    )
  }

  const addButtons = (
    <>
      <SecondaryButton onClick={() => setForm({ target: 'create', mode: 'income', initial: { frequency: 'once', startDate: newItemDate } })}>
        <HandCoins aria-hidden="true" />
        {t('plan.addIncome')}
      </SecondaryButton>
      <PrimaryButton onClick={() => setForm({ target: 'create', mode: 'outgoing', initial: { frequency: 'once', startDate: newItemDate } })}>
        <Plus aria-hidden="true" />
        {t('plan.addOutgoing')}
      </PrimaryButton>
    </>
  )

  const totals = model?.plan.totals
  const short = totals ? totals.remaining < 0 : false

  return (
    <div className="flex flex-col gap-section">
      <PageHeader
        title={t('plan.title')}
        description={t('plan.subtitle')}
        actions={<MonthSelector value={month} onChange={(next) => setParam('month', next)} currentMonth={currentMonth} />}
      />

      {result === undefined && <LoadingState variant="cards" count={3} />}
      {result && !result.ok && <ErrorState onRetry={() => setAttempt((n) => n + 1)} />}

      {model && totals && model.empty && (
        <EmptyState icon={CalendarRange} title={t('plan.empty')} description={t('plan.emptyHint')} action={<div className="flex flex-wrap justify-center gap-2">{addButtons}</div>} />
      )}

      {model && totals && !model.empty && (
        <>
          <Card className="gap-3 px-card" aria-labelledby="plan-summary">
            <div className="flex flex-col gap-1">
              <h2 id="plan-summary" className="text-sm text-muted-foreground">
                {t('plan.summary.remaining', { month: formatYearMonth(month) })}
              </h2>
              <MoneyDisplay amount={totals.remaining} tone={short ? 'expense' : 'income'} size="xl" />
              <p className={cn('text-sm', short ? 'text-expense' : 'text-muted-foreground')}>{t(short ? 'plan.summary.shortHint' : 'plan.summary.leftHint')}</p>
            </div>
            <dl className="divide-y divide-border border-t">
              <SummaryLine
                label={t('plan.summary.income')}
                amount={totals.income}
                tone="income"
                hint={totals.incomeReceived > 0 ? t('plan.summary.incomeSplit', { received: formatTHB(totals.incomeReceived, { trimZeroFraction: true }), expected: formatTHB(totals.incomeExpected, { trimZeroFraction: true }) }) : undefined}
              />
              <SummaryLine
                label={t('plan.summary.outgoing')}
                amount={totals.outgoing}
                tone="expense"
                hint={t('plan.summary.outgoingSplit', { paid: formatTHB(totals.outgoingPaid, { trimZeroFraction: true }), unpaid: formatTHB(totals.outgoingUnpaid, { trimZeroFraction: true }) })}
              />
              {totals.otherSpending > 0 && (
                <>
                  <SummaryLine label={t('plan.summary.otherSpending')} amount={totals.otherSpending} tone="expense" hint={t('plan.summary.otherSpendingHint')} />
                  <SummaryLine label={t('plan.summary.afterSpending')} amount={totals.remainingAfterSpending} tone={totals.remainingAfterSpending < 0 ? 'expense' : 'income'} strong />
                </>
              )}
            </dl>
          </Card>

          <AheadStrip months={model.ahead} selected={month} onSelect={(next) => setParam('month', next)} />

          <div className="flex flex-wrap gap-2">{addButtons}</div>

          <section aria-labelledby="plan-income" className="flex flex-col gap-stack">
            <div className="flex items-baseline justify-between gap-2">
              <h2 id="plan-income" className="text-base font-semibold">
                {t('plan.income.title')}
              </h2>
              <MoneyDisplay amount={totals.income} tone="income" size="sm" />
            </div>
            {model.plan.income.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('plan.income.empty')}</p>
            ) : (
              <Card className="py-0">
                <ul aria-label={t('plan.income.title')} className="divide-y divide-border">
                  {model.plan.income.map(row)}
                </ul>
              </Card>
            )}
          </section>

          <section aria-labelledby="plan-outgoing" className="flex flex-col gap-stack">
            <div className="flex items-baseline justify-between gap-2">
              <h2 id="plan-outgoing" className="text-base font-semibold">
                {t('plan.outgoing.title')}
              </h2>
              <MoneyDisplay amount={totals.outgoing} tone="expense" size="sm" />
            </div>
            {model.plan.outgoing.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('plan.outgoing.empty')}</p>
            ) : (
              <Card className="py-0">
                <ul aria-label={t('plan.outgoing.title')} className="divide-y divide-border">
                  {model.plan.outgoing.map(row)}
                </ul>
              </Card>
            )}
            <p className="text-xs text-muted-foreground">{t('plan.projectedNote')}</p>
          </section>
        </>
      )}

      <RecurringDetailSheet
        obligationId={searchParams.get('rule')}
        onClose={() => setParam('rule', null)}
        onEdit={(obligation) => setForm({ target: obligation, mode: obligation.kind === 'income' ? 'income' : 'outgoing' })}
        today={today}
        ops={ops}
      />
      <RecurringFormSheet
        target={form?.target ?? null}
        onClose={() => setForm(null)}
        data={formData}
        today={today}
        ops={ops}
        mode={form?.mode}
        initial={form?.initial}
      />
      {paying && raw && (
        <PayScheduledSheet
          payment={paying.payment}
          obligation={paying.obligation}
          detail={{ categories: raw.categories, accounts: raw.accounts, debts: raw.debts }}
          today={today}
          onClose={() => setPaying(null)}
          markPaid={ops.markPaid}
        />
      )}
      <EditAmountDialog
        target={editing ? { name: editing.name, dueDate: editing.dueDate, amountSatang: editing.expectedSatang, income: editing.group === 'income' } : null}
        onClose={() => setEditing(null)}
        onSave={(amount) => ops.setAmount({ sourceType: editing!.sourceType, sourceId: editing!.sourceId, dueDate: editing!.dueDate }, amount)}
      />
    </div>
  )
}

/** Route entry (lazy-loaded). */
export function PlanPage() {
  const [today] = useState(todayISO)
  return <Plan today={today} />
}
