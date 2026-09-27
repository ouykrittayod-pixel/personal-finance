import { useLiveQuery } from 'dexie-react-hooks'
import { CreditCard, HandCoins, Pause, Pencil, Play, Repeat, SearchX, Trash2 } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { PrimaryButton, SecondaryButton } from '@/components/actions/buttons'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { LoadingState } from '@/components/feedback/LoadingState'
import { useToast } from '@/components/feedback/toast-context'
import { MoneyDisplay } from '@/components/finance/MoneyDisplay'
import { StatusBadge } from '@/components/finance/StatusBadge'
import { Dialog } from '@/components/overlays/Dialog'
import { Drawer } from '@/components/overlays/Drawer'
import { Button } from '@/components/ui/button'
import type { ID, ISODate, RecurringObligation, ScheduledPayment } from '@/domain/entities'
import { obligationStatus } from '@/domain/scheduling'
import { formatYearMonth } from '@/lib/dates'
import { formatDate, formatTHB } from '@/lib/formatting'
import { t } from '@/lib/i18n'
import { actionFailureMessage } from '../errors'
import { describePayment, loadRecurringDetail, perLabel, scheduleLabel, type RecurringDetail } from '../recurring-data'
import type { RecurringOps } from '../recurring-ops'
import { PayScheduledSheet } from './PayScheduledSheet'

/** How many occurrences the detail lists (unpaid oldest first, then history newest first). */
export const SCHEDULE_LIMIT = 12

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-sm break-words">{children}</dd>
    </div>
  )
}

function ScheduleItem({
  payment,
  detail,
  today,
  busy,
  onPay,
  onSkip,
  onUnskip,
  income,
}: {
  income: boolean
  payment: ScheduledPayment
  detail: RecurringDetail
  today: ISODate
  busy: boolean
  onPay: () => void
  onSkip: () => void
  onUnskip: () => void
}) {
  const status = describePayment(payment, today, income)
  const tx = payment.transactionId ? detail.paidTransactions.get(payment.transactionId) : undefined
  const dueLabel = formatDate(payment.dueDate)
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium">{formatYearMonth(payment.dueDate.slice(0, 7))}</span>
          <span className="text-xs text-muted-foreground">
            <time dateTime={payment.dueDate}>{t('recurring.due', { date: dueLabel })}</time>
          </span>
          {tx && (
            <span className="text-xs text-muted-foreground">
              {t(income ? 'income.detail.receivedOn' : 'recurring.detail.paidOn', { date: formatDate(tx.date), amount: formatTHB(tx.amountSatang, { trimZeroFraction: true }) })}
            </span>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <MoneyDisplay amount={payment.expectedAmountSatang} size="md" />
          <StatusBadge status={status.kind} label={status.label} />
        </div>
      </div>
      {payment.status === 'pending' && (
        <div className="flex flex-wrap gap-2">
          <PrimaryButton onClick={onPay} disabled={busy} aria-label={t(income ? 'income.recurring.receiveFor' : 'recurring.action.payFor', { date: dueLabel })}>
            {t(income ? 'income.recurring.receive' : 'recurring.action.pay')}
          </PrimaryButton>
          <SecondaryButton onClick={onSkip} disabled={busy} aria-label={t('recurring.action.skipFor', { date: dueLabel })}>
            {t('recurring.action.skip')}
          </SecondaryButton>
        </div>
      )}
      {payment.status === 'skipped' && (
        <SecondaryButton className="self-start" onClick={onUnskip} disabled={busy}>
          {t('recurring.action.unskipFor', { date: dueLabel })}
        </SecondaryButton>
      )}
      {tx && (
        <Link to={`/transactions?tx=${tx.id}`} className="focus-ring self-start rounded-md text-sm font-medium text-primary hover:underline">
          {t('recurring.detail.viewTransaction')}
        </Link>
      )}
    </li>
  )
}

export interface RecurringDetailSheetProps {
  obligationId: ID | null
  onClose: () => void
  onEdit: (obligation: RecurringObligation) => void
  today: ISODate
  ops: RecurringOps
  load?: (id: ID) => Promise<RecurringDetail | null>
}

type LoadResult = { ok: true; detail: RecurringDetail | null } | { ok: false } | null

/** Detail of one recurring obligation: its rule, its scheduled payments, and every action on them. */
export function RecurringDetailSheet({ obligationId, onClose, onEdit, today, ops, load = loadRecurringDetail }: RecurringDetailSheetProps) {
  const toast = useToast()
  const [paying, setPaying] = useState<ScheduledPayment | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [attempt, setAttempt] = useState(0)
  const [shownId, setShownId] = useState(obligationId)
  if (shownId !== obligationId) {
    setShownId(obligationId)
    setPaying(null)
    setConfirmDelete(false)
  }

  const result = useLiveQuery<LoadResult>(
    () => (obligationId ? load(obligationId).then((detail) => ({ ok: true as const, detail }), () => ({ ok: false as const })) : null),
    [obligationId, load, attempt],
  )
  const detail = result?.ok ? result.detail : null
  const obligation = detail?.obligation

  /** Run one action at a time; report success or a Thai failure message. */
  async function run(action: () => Promise<unknown>, success: string, after?: () => void) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await action()
      toast.show({ message: success })
      after?.()
    } catch (error) {
      toast.show({ message: actionFailureMessage(error), tone: 'error' })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const income = obligation?.kind === 'income'
  const status = detail ? obligationStatus(detail.payments, today) : undefined
  const current = status?.current ? describePayment(status.current, today, income) : undefined
  const unpaidCount = detail?.payments.filter((p) => p.status === 'pending').length ?? 0

  return (
    <>
      <Drawer
        open={obligationId !== null}
        onOpenChange={(open) => {
          if (!open && !busy) onClose()
        }}
        title={t(income ? 'income.detail.title' : 'recurring.detail.title')}
        size="full"
        footer={
          obligation ? (
            <>
              <SecondaryButton size="lg" onClick={() => onEdit(obligation)} disabled={busy}>
                <Pencil aria-hidden="true" />
                {t('recurring.action.edit')}
              </SecondaryButton>
              {obligation.pausedAt ? (
                <SecondaryButton
                  size="lg"
                  disabled={busy}
                  onClick={() => void run(() => ops.resume(obligation.id), t('recurring.toast.resumed', { name: obligation.name }))}
                >
                  <Play aria-hidden="true" />
                  {t('recurring.action.resume')}
                </SecondaryButton>
              ) : (
                <SecondaryButton
                  size="lg"
                  disabled={busy}
                  onClick={() => void run(() => ops.pause(obligation.id), t('recurring.toast.paused', { name: obligation.name }))}
                >
                  <Pause aria-hidden="true" />
                  {t('recurring.action.pause')}
                </SecondaryButton>
              )}
              <Button variant="destructive" size="touch-lg" onClick={() => setConfirmDelete(true)} disabled={busy} aria-label={t('recurring.action.delete')}>
                <Trash2 aria-hidden="true" />
                <span className="max-sm:sr-only">{t('recurring.action.delete')}</span>
              </Button>
            </>
          ) : undefined
        }
      >
        {obligationId && result === undefined && <LoadingState />}
        {result && !result.ok && <ErrorState onRetry={() => setAttempt((n) => n + 1)} />}
        {result?.ok && !detail && <EmptyState icon={SearchX} title={t('recurring.detail.notFound')} className="border-none" />}
        {detail && obligation && status && (
          <div className="flex flex-col gap-section">
            <div className="flex items-start gap-3">
              <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-debt-muted text-lg text-debt">
                {obligation.debtId ? <CreditCard className="size-5" /> : (detail.category?.icon ?? (income ? <HandCoins className="size-5" /> : <Repeat className="size-5" />))}
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-base font-semibold">{obligation.name}</p>
                <p className="flex items-baseline gap-1.5">
                  <MoneyDisplay amount={obligation.expectedAmountSatang} size="lg" />
                  <span className="text-sm text-muted-foreground">{perLabel(obligation.recurrence)}</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {obligation.pausedAt && <StatusBadge status="paused" />}
                  {current && <StatusBadge status={current.kind} label={current.label} />}
                </div>
              </div>
            </div>

            <dl className="divide-y divide-border border-y">
              <Row label={t('recurring.detail.frequency')}>{scheduleLabel(obligation.recurrence)}</Row>
              <Row label={t('recurring.detail.nextDue')}>{status.current ? formatDate(status.current.dueDate, 'long') : t('recurring.noUpcoming')}</Row>
              <Row label={obligation.debtId ? t('recurring.detail.debt') : t('recurring.detail.category')}>
                {obligation.debtId ? (detail.debt?.name ?? '—') : detail.category ? `${detail.category.icon ? `${detail.category.icon} ` : ''}${detail.category.name}` : '—'}
              </Row>
              <Row label={t(income ? 'income.detail.account' : 'recurring.detail.account')}>{detail.account?.name ?? '—'}</Row>
              <Row label={t('recurring.detail.startDate')}>{formatDate(obligation.recurrence.startDate, 'long')}</Row>
              {obligation.recurrence.endDate && <Row label={t('recurring.detail.endDate')}>{formatDate(obligation.recurrence.endDate, 'long')}</Row>}
              <Row label={t('recurring.detail.status')}>{obligation.pausedAt ? t('status.paused') : t('recurring.detail.active')}</Row>
              {obligation.note && <Row label={t('recurring.detail.note')}>{obligation.note}</Row>}
            </dl>

            <section className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold">{t(income ? 'income.detail.schedule' : 'recurring.detail.schedule')}</h3>
              {detail.payments.length === 0 ? (
                <p className="py-3 text-sm text-muted-foreground">{t(income ? 'income.detail.scheduleEmpty' : 'recurring.detail.scheduleEmpty')}</p>
              ) : (
                <ul aria-label={t(income ? 'income.detail.schedule' : 'recurring.detail.schedule')} className="divide-y divide-border">
                  {detail.payments.slice(0, SCHEDULE_LIMIT).map((payment) => (
                    <ScheduleItem
                      key={payment.id}
                      payment={payment}
                      detail={detail}
                      today={today}
                      busy={busy}
                      income={income}
                      onPay={() => setPaying(payment)}
                      onSkip={() => void run(() => ops.skip(payment.id), t('recurring.toast.skipped', { date: formatDate(payment.dueDate) }))}
                      onUnskip={() => void run(() => ops.unskip(payment.id), t('recurring.toast.unskipped'))}
                    />
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </Drawer>

      {obligation && detail && (
        <PayScheduledSheet payment={paying} obligation={obligation} detail={detail} today={today} onClose={() => setPaying(null)} markPaid={ops.markPaid} />
      )}

      {obligation && (
        <Dialog
          open={confirmDelete}
          onOpenChange={(open) => {
            if (!busy) setConfirmDelete(open)
          }}
          title={t('recurring.delete.title')}
          description={t(income ? 'income.detail.deleteHint' : 'recurring.delete.hint')}
          footer={
            <>
              <SecondaryButton onClick={() => setConfirmDelete(false)} disabled={busy}>
                {t('detail.cancel')}
              </SecondaryButton>
              <Button
                variant="destructive"
                size="touch"
                disabled={busy}
                onClick={() =>
                  void run(() => ops.archive(obligation.id), t(income ? 'income.toast.deleted' : 'recurring.toast.deleted', { name: obligation.name }), () => {
                    setConfirmDelete(false)
                    onClose()
                  })
                }
              >
                <Trash2 aria-hidden="true" />
                {t('recurring.action.delete')}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
              <span className="min-w-0 truncate font-medium">{obligation.name}</span>
              <MoneyDisplay amount={obligation.expectedAmountSatang} />
            </div>
            {unpaidCount > 0 && <p className="text-muted-foreground">{t('recurring.delete.unpaid', { count: unpaidCount })}</p>}
          </div>
        </Dialog>
      )}
    </>
  )
}
