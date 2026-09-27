import { useLiveQuery } from 'dexie-react-hooks'
import { Archive, Banknote, CreditCard, Landmark, Paperclip, Pause, Pencil, Play, Plus, SearchX, Trash2 } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { PrimaryButton, SecondaryButton } from '@/components/actions/buttons'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { LoadingState } from '@/components/feedback/LoadingState'
import { ProgressBar } from '@/components/feedback/ProgressBar'
import { useToast } from '@/components/feedback/toast-context'
import { MoneyDisplay } from '@/components/finance/MoneyDisplay'
import { StatusBadge } from '@/components/finance/StatusBadge'
import { Dialog } from '@/components/overlays/Dialog'
import { Drawer } from '@/components/overlays/Drawer'
import { Button } from '@/components/ui/button'
import { allocationOf, formatBpsAsPercent, isRevolving, loanProgress } from '@/domain/debts'
import type { Debt, ID, ISODate, ScheduledPayment } from '@/domain/entities'
import { abs, ratioBps, ZERO, type Satang } from '@/domain/money'
import { addMonthsYM, formatYearMonth } from '@/lib/dates'
import { formatDate, formatPercentBps, formatTHB } from '@/lib/formatting'
import { t } from '@/lib/i18n'
import { describeOccurrence, loadDebtDetail, type DebtDetail } from '../debts-data'
import type { DebtsOps } from '../debts-ops'
import { debtActionFailureMessage } from '../errors'
import { AdjustmentDialog, StatementDialog } from './DebtRecordDialogs'
import { PayDebtSheet, type PayTarget } from './PayDebtSheet'

/** How many scheduled occurrences the detail lists (newest first). */
export const OCCURRENCE_LIMIT = 12

const money = (amount: Satang) => formatTHB(amount, { trimZeroFraction: true })

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-sm break-words">{children}</dd>
    </div>
  )
}

const Unknown = ({ children = t('debts.unknown') }: { children?: string }) => <span className="text-muted-foreground">{children}</span>

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <div className="flex min-h-touch items-center justify-between gap-2 md:min-h-9">
        <h3 className="text-sm font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function EstimateText({ detail, today }: { detail: DebtDetail; today: ISODate }) {
  const { estimate, debt } = detail
  if (estimate.kind === 'unavailable') return <p className="text-sm text-muted-foreground">{t('debts.detail.estimateUnavailable')}</p>
  if (estimate.kind === 'never') return <p className="text-sm text-warning">{t('debts.detail.estimateNever')}</p>
  return (
    <p className="text-sm">
      {t('debts.detail.estimatePayoff', {
        amount: money(debt.installmentSatang ?? ZERO),
        month: formatYearMonth(addMonthsYM(today.slice(0, 7), estimate.months)),
        months: estimate.months,
        interest: money(estimate.totalInterest),
      })}
    </p>
  )
}

export interface DebtDetailSheetProps {
  debtId: ID | null
  onClose: () => void
  onEdit: (debt: Debt) => void
  today: ISODate
  ops: DebtsOps
  load?: (id: ID) => Promise<DebtDetail | null>
}

type LoadResult = { ok: true; detail: DebtDetail | null } | { ok: false } | null

/** One debt: balance and how it is derived, schedule, repayment history, and every action. */
export function DebtDetailSheet({ debtId, onClose, onEdit, today, ops, load = loadDebtDetail }: DebtDetailSheetProps) {
  const toast = useToast()
  const [paying, setPaying] = useState<PayTarget | null>(null)
  const [dialog, setDialog] = useState<null | 'archive' | 'adjust' | 'statement'>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [attempt, setAttempt] = useState(0)
  const [shownId, setShownId] = useState(debtId)
  if (shownId !== debtId) {
    setShownId(debtId)
    setPaying(null)
    setDialog(null)
  }

  const result = useLiveQuery<LoadResult>(
    () => (debtId ? load(debtId).then((detail) => ({ ok: true as const, detail }), () => ({ ok: false as const })) : null),
    [debtId, load, attempt],
  )
  const detail = result?.ok ? result.detail : null
  const debt = detail?.debt

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
      toast.show({ message: debtActionFailureMessage(error), tone: 'error' })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const pending = detail ? [...detail.occurrences].filter((p) => p.status === 'pending').sort((a, b) => a.dueDate.localeCompare(b.dueDate)) : []
  const next = pending[0]
  const card = debt ? isRevolving(debt) : false
  const hasSchedule = Boolean(debt && !card && debt.scheduleEnabled)

  return (
    <>
      <Drawer
        open={debtId !== null}
        onOpenChange={(open) => {
          if (!open && !busy) onClose()
        }}
        title={t('debts.detail.title')}
        size="full"
        footer={
          debt ? (
            <>
              <SecondaryButton size="lg" onClick={() => onEdit(debt)} disabled={busy}>
                <Pencil aria-hidden="true" />
                {t('debts.action.edit')}
              </SecondaryButton>
              {hasSchedule &&
                (debt.schedulePausedAt ? (
                  <SecondaryButton size="lg" disabled={busy} onClick={() => void run(() => ops.resumeSchedule(debt.id), t('debts.toast.resumed'))}>
                    <Play aria-hidden="true" />
                    {t('debts.action.resumeSchedule')}
                  </SecondaryButton>
                ) : (
                  <SecondaryButton size="lg" disabled={busy} onClick={() => void run(() => ops.pauseSchedule(debt.id), t('debts.toast.paused'))}>
                    <Pause aria-hidden="true" />
                    {t('debts.action.pauseSchedule')}
                  </SecondaryButton>
                ))}
              <Button variant="outline" size="touch-lg" onClick={() => setDialog('archive')} disabled={busy} aria-label={t('debts.action.archive')}>
                <Archive aria-hidden="true" />
                <span className="max-sm:sr-only">{t('debts.action.archive')}</span>
              </Button>
            </>
          ) : undefined
        }
      >
        {debtId && result === undefined && <LoadingState />}
        {result && !result.ok && <ErrorState onRetry={() => setAttempt((n) => n + 1)} />}
        {result?.ok && !detail && <EmptyState icon={SearchX} title={t('debts.detail.notFound')} className="border-none" />}
        {detail && debt && <DetailBody detail={detail} today={today} busy={busy} next={next} onPay={setPaying} onDialog={setDialog} run={run} ops={ops} />}
      </Drawer>

      {detail && <PayDebtSheet target={paying} detail={detail} today={today} onClose={() => setPaying(null)} ops={ops} />}
      {debt && !card && <AdjustmentDialog debt={debt} open={dialog === 'adjust'} onClose={() => setDialog(null)} today={today} ops={ops} />}
      {debt && card && <StatementDialog debt={debt} open={dialog === 'statement'} onClose={() => setDialog(null)} today={today} ops={ops} />}

      {debt && (
        <Dialog
          open={dialog === 'archive'}
          onOpenChange={(open) => {
            if (!busy) setDialog(open ? 'archive' : null)
          }}
          title={t('debts.archive.title')}
          description={t('debts.archive.hint')}
          footer={
            <>
              <SecondaryButton onClick={() => setDialog(null)} disabled={busy}>
                {t('detail.cancel')}
              </SecondaryButton>
              <Button
                variant="destructive"
                size="touch"
                disabled={busy}
                onClick={() =>
                  void run(() => ops.archive(debt.id), t('debts.toast.archived', { name: debt.name }), () => {
                    setDialog(null)
                    onClose()
                  })
                }
              >
                <Archive aria-hidden="true" />
                {t('debts.action.archive')}
              </Button>
            </>
          }
        >
          {pending.length > 0 && <p className="text-sm text-muted-foreground">{t('debts.archive.unpaid', { count: pending.length })}</p>}
        </Dialog>
      )}
    </>
  )
}

function DetailBody({
  detail,
  today,
  busy,
  next,
  onPay,
  onDialog,
  run,
  ops,
}: {
  detail: DebtDetail
  today: ISODate
  busy: boolean
  next?: ScheduledPayment
  onPay: (target: PayTarget) => void
  onDialog: (dialog: 'adjust' | 'statement') => void
  run: (action: () => Promise<unknown>, success: string) => Promise<void>
  ops: DebtsOps
}) {
  const { debt, position } = detail
  const card = isRevolving(debt)
  const loan = position.model === 'loan' ? position.loan : null
  const progress = loan ? loanProgress(loan) : null
  const accountName = position.model === 'card' ? position.card?.accountName : undefined

  return (
    <div className="flex flex-col gap-section">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-debt-muted text-debt">
          {card ? <CreditCard className="size-5" /> : <Landmark className="size-5" />}
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-base font-semibold">{debt.name}</p>
          <p className="text-sm text-muted-foreground">{[t(`debts.kind.${debt.kind}`), debt.lender].filter(Boolean).join(' · ')}</p>
          <div className="flex flex-wrap gap-1.5">
            {debt.status !== 'active' && <StatusBadge status="closed" label={t(`debts.status.${debt.status}`)} />}
            {debt.schedulePausedAt && <StatusBadge status="paused" label={t('debts.detail.schedulePaused')} />}
            {next && <StatusBadge {...(({ kind, label }) => ({ status: kind, label }))(describeOccurrence(next, today))} />}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1 rounded-lg border p-card">
        <span className="text-sm text-muted-foreground">{card ? t('debts.detail.cardLiability') : t('debts.detail.currentPrincipal')}</span>
        {position.outstanding === null ? (
          <p className="text-sm text-warning">{t('debts.detail.cardAccountMissing')}</p>
        ) : (
          <MoneyDisplay amount={position.outstanding} tone="debt" size="xl" />
        )}
        {card && accountName && <p className="text-xs text-muted-foreground">{t('debts.detail.cardSource', { account: accountName })}</p>}
        {progress && progress.base > 0 && (
          <ProgressBar
            className="mt-2"
            value={ratioBps(progress.paid, progress.base) / 100}
            label={t('debts.row.progress', { percent: formatPercentBps(ratioBps(progress.paid, progress.base)) })}
            valueText={formatPercentBps(ratioBps(progress.paid, progress.base))}
            tone="debt"
          />
        )}
        {loan && loan.unallocatedCount > 0 && (
          <p role="note" className="mt-2 rounded-md bg-warning-muted px-3 py-2 text-xs text-foreground">
            {t('debts.unallocatedWarning', { amount: money(loan.unallocatedPaid) })}
          </p>
        )}
      </div>

      <div className={next ? 'grid grid-cols-2 gap-stack' : 'grid gap-stack'}>
        <PrimaryButton size="lg" disabled={busy || debt.status !== 'active'} onClick={() => onPay(next ? { kind: 'occurrence', payment: next } : { kind: 'extra' })}>
          <Banknote aria-hidden="true" />
          {next ? t('debts.action.payFor', { date: formatDate(next.dueDate) }) : t('debts.action.pay')}
        </PrimaryButton>
        {/* Without a due installment the main button already records an unscheduled payment. */}
        {next && (
          <SecondaryButton size="lg" disabled={busy || debt.status !== 'active'} onClick={() => onPay({ kind: 'extra' })}>
            <Plus aria-hidden="true" />
            {t('debts.action.extra')}
          </SecondaryButton>
        )}
      </div>

      <dl className="divide-y divide-border border-y">
        {loan && (
          <Row label={t('debts.detail.opening')}>{t('debts.detail.openingValue', { amount: money(loan.opening), date: formatDate(loan.openingDate, 'long') })}</Row>
        )}
        {!card && <Row label={t('debts.detail.original')}>{debt.principalSatang ? money(debt.principalSatang) : <Unknown>{t('debts.notSet')}</Unknown>}</Row>}
        <Row label={t('debts.detail.rate')}>
          {debt.interestMethod === 'none' ? (
            t('debts.detail.basis.none')
          ) : debt.annualInterestRateBps !== undefined ? (
            t('debts.detail.rateValue', { rate: formatBpsAsPercent(debt.annualInterestRateBps), basis: t(`debts.detail.basis.${debt.interestMethod}`) })
          ) : (
            <Unknown />
          )}
        </Row>
        {!card && <Row label={t('debts.detail.installment')}>{debt.installmentSatang ? money(debt.installmentSatang) : <Unknown>{t('debts.notSet')}</Unknown>}</Row>}
        {debt.startDate && <Row label={t('debts.detail.startDate')}>{formatDate(debt.startDate, 'long')}</Row>}
        {!card && <Row label={t('debts.detail.maturity')}>{debt.maturityDate ? formatDate(debt.maturityDate, 'long') : <Unknown>{t('debts.notSet')}</Unknown>}</Row>}
        <Row label={t('debts.detail.schedule')}>
          {[
            detail.owner
              ? t('debts.detail.scheduleByObligation', { name: detail.owner.name })
              : debt.schedulePausedAt
                ? t('debts.detail.schedulePaused')
                : debt.scheduleEnabled
                  ? t('debts.detail.scheduleOn')
                  : t('debts.detail.scheduleOff'),
            !card && debt.dueDay ? t('debts.detail.dueDay', { day: debt.dueDay }) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Row>
        {debt.note && <Row label={t('debts.form.note')}>{debt.note}</Row>}
      </dl>

      {loan && (
        <Section title={t('debts.detail.estimate')}>
          <EstimateText detail={detail} today={today} />
        </Section>
      )}

      <Section title={t('debts.detail.totals')}>
        <dl className="grid grid-cols-2 gap-stack sm:grid-cols-3">
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">{t('debts.detail.totalPaid')}</dt>
            <dd>
              <MoneyDisplay amount={loan ? loan.totalPaid : position.model === 'card' && position.card ? position.card.paymentsTotal : ZERO} size="md" />
            </dd>
          </div>
          {loan && (
            <>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">{t('debts.detail.principalPaid')}</dt>
                <dd>
                  <MoneyDisplay amount={loan.principalPaid} size="md" />
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">{t('debts.detail.interestPaid')}</dt>
                <dd>
                  <MoneyDisplay amount={loan.interestPaid} size="md" />
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">{t('debts.detail.feesPaid')}</dt>
                <dd>
                  <MoneyDisplay amount={loan.feesPaid} size="md" />
                </dd>
              </div>
              {loan.unallocatedCount > 0 && (
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs text-muted-foreground">{t('debts.detail.unallocatedPaid')}</dt>
                  <dd>
                    <MoneyDisplay amount={loan.unallocatedPaid} size="md" />
                  </dd>
                </div>
              )}
            </>
          )}
        </dl>
        {card && <p className="pt-2 text-xs text-muted-foreground">{t('debts.detail.cardPaymentsNote')}</p>}
      </Section>

      {detail.occurrences.length > 0 && (
        <Section title={t('debts.detail.occurrences')}>
          <ul aria-label={t('debts.detail.occurrences')} className="divide-y divide-border">
            {detail.occurrences.slice(0, OCCURRENCE_LIMIT).map((payment) => {
              const status = describeOccurrence(payment, today)
              const dueLabel = formatDate(payment.dueDate)
              return (
                <li key={payment.id} className="flex flex-col gap-2 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-col">
                      <span className="text-sm font-medium">{formatYearMonth(payment.dueDate.slice(0, 7))}</span>
                      <span className="text-xs text-muted-foreground">
                        <time dateTime={payment.dueDate}>{t('recurring.due', { date: dueLabel })}</time>
                      </span>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <MoneyDisplay amount={payment.expectedAmountSatang} size="md" />
                      <StatusBadge status={status.kind} label={status.label} />
                    </div>
                  </div>
                  {payment.status === 'pending' && payment.sourceType === 'debt' && (
                    <div className="flex flex-wrap gap-2">
                      <PrimaryButton onClick={() => onPay({ kind: 'occurrence', payment })} disabled={busy} aria-label={t('debts.action.payFor', { date: dueLabel })}>
                        {t('recurring.action.pay')}
                      </PrimaryButton>
                      <SecondaryButton
                        onClick={() => void run(() => ops.skip(payment.id), t('debts.toast.skipped', { date: dueLabel }))}
                        disabled={busy}
                        aria-label={t('debts.action.skipFor', { date: dueLabel })}
                      >
                        {t('recurring.action.skip')}
                      </SecondaryButton>
                    </div>
                  )}
                  {payment.status === 'pending' && payment.sourceType === 'obligation' && (
                    <PrimaryButton className="self-start" onClick={() => onPay({ kind: 'occurrence', payment })} disabled={busy} aria-label={t('debts.action.payFor', { date: dueLabel })}>
                      {t('recurring.action.pay')}
                    </PrimaryButton>
                  )}
                </li>
              )
            })}
          </ul>
        </Section>
      )}

      {card && (
        <Section
          title={t('debts.detail.statements')}
          action={
            <SecondaryButton onClick={() => onDialog('statement')} disabled={busy || Boolean(detail.owner)}>
              <Plus aria-hidden="true" />
              {t('debts.action.addStatement')}
            </SecondaryButton>
          }
        >
          {(debt.statements ?? []).length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">{t('debts.detail.statementsEmpty')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {[...(debt.statements ?? [])]
                .sort((a, b) => b.statementDate.localeCompare(a.statementDate))
                .map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="flex min-w-0 flex-col">
                      <span>{t('debts.detail.statementItem', { date: formatDate(s.statementDate), balance: money(s.balanceSatang) })}</span>
                      <span className="text-xs text-muted-foreground">
                        {[s.minimumDueSatang !== undefined ? t('debts.detail.statementMinimum', { amount: money(s.minimumDueSatang) }) : null, t('debts.detail.statementDue', { date: formatDate(s.dueDate) })]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-touch"
                      disabled={busy}
                      aria-label={t('debts.action.removeStatement')}
                      onClick={() => void run(() => ops.removeStatement(debt.id, s.id), t('debts.toast.updated'))}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </li>
                ))}
            </ul>
          )}
        </Section>
      )}

      {!card && (
        <Section
          title={t('debts.detail.adjustments')}
          action={
            <SecondaryButton onClick={() => onDialog('adjust')} disabled={busy}>
              <Plus aria-hidden="true" />
              {t('debts.action.addAdjustment')}
            </SecondaryButton>
          }
        >
          {(debt.principalAdjustments ?? []).length > 0 && (
            <ul className="divide-y divide-border">
              {[...(debt.principalAdjustments ?? [])]
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="flex min-w-0 flex-col">
                      <span>{formatDate(a.date)}</span>
                      {a.note && <span className="truncate text-xs text-muted-foreground">{a.note}</span>}
                    </span>
                    <span className="tabular-nums">{`${a.amountSatang > 0 ? '+' : '−'}${money(abs(a.amountSatang))}`}</span>
                  </li>
                ))}
            </ul>
          )}
        </Section>
      )}

      <Section title={t('debts.detail.history')}>
        {detail.payments.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{t('debts.detail.historyEmpty')}</p>
        ) : (
          <ul aria-label={t('debts.detail.history')} className="divide-y divide-border">
            {detail.payments.map((tx) => {
              const split = allocationOf(tx)
              return (
                <li key={tx.id}>
                  <Link
                    to={`/transactions?tx=${tx.id}`}
                    className="focus-ring flex min-h-touch items-center justify-between gap-3 rounded-md py-2.5 hover:bg-muted/60"
                    aria-label={`${t('debts.action.viewTransaction')} ${formatDate(tx.date)} ${money(tx.amountSatang)}`}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="flex items-center gap-1.5 text-sm">
                        {formatDate(tx.date)}
                        {detail.withReceipts.has(tx.id) && (
                          <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                            <Paperclip className="size-3.5" aria-hidden="true" />
                            {t('debts.detail.receipt')}
                          </span>
                        )}
                      </span>
                      {!card && (
                        <span className="truncate text-xs text-muted-foreground">
                          {split ? t('debts.detail.split', { principal: money(split.principal), interest: money(split.interest), fee: money(split.fee) }) : t('debts.unallocated')}
                        </span>
                      )}
                    </span>
                    <MoneyDisplay amount={tx.amountSatang} size="md" />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </Section>
    </div>
  )
}
