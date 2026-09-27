import { createElement, useRef, useState, type ReactNode } from 'react'
import { Archive, ArchiveRestore, ArrowLeftRight, Pencil, SearchX } from 'lucide-react'
import { PrimaryButton, SecondaryButton } from '@/components/actions/buttons'
import { EmptyState } from '@/components/feedback/EmptyState'
import { LoadingState } from '@/components/feedback/LoadingState'
import { useToast } from '@/components/feedback/toast-context'
import { ACCOUNT_KIND_VISUALS } from '@/components/finance/account-visuals'
import { MoneyDisplay } from '@/components/finance/MoneyDisplay'
import { StatusBadge } from '@/components/finance/StatusBadge'
import { TransactionRow } from '@/components/finance/TransactionRow'
import { Dialog } from '@/components/overlays/Dialog'
import { Drawer } from '@/components/overlays/Drawer'
import { Button } from '@/components/ui/button'
import { openingAmountOf } from '@/domain/accounts'
import type { Account } from '@/domain/entities'
import { negate, type Satang } from '@/domain/money'
import { formatDate, formatTHB } from '@/lib/formatting'
import { t } from '@/lib/i18n'
import type { AccountDetail } from '../accounts-data'
import { accountActionFailureMessage, type AccountsOps } from '../accounts-ops'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-sm break-words">{children}</dd>
    </div>
  )
}

function Total({ label, amount }: { label: string; amount: Satang }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>
        <MoneyDisplay amount={amount} size="md" />
      </dd>
    </div>
  )
}

/** A liability's balance in words: what is owed (or in credit), never a positive "money". */
export function LiabilityBalance({ balance, size = 'xl' }: { balance: Satang; size?: 'xl' | 'lg' | 'md' }) {
  if (balance > 0) return <span className="text-sm text-income">{t('accounts.inCredit', { amount: formatTHB(balance, { trimZeroFraction: true }) })}</span>
  return (
    <span className="flex flex-col">
      <MoneyDisplay amount={balance} tone="debt" size={size} />
      <span className="text-xs text-muted-foreground">{t('accounts.owed', { amount: formatTHB(negate(balance), { trimZeroFraction: true }) })}</span>
    </span>
  )
}

export interface AccountDetailSheetProps {
  detail: AccountDetail | null
  /** Data still loading (the account may exist). */
  loading?: boolean
  /** The account id in the URL (null = closed). */
  accountId: string | null
  onClose: () => void
  onEdit: (account: Account) => void
  onTransfer: (fromAccountId: string) => void
  onOpenTransaction: (id: string) => void
  ops: Pick<AccountsOps, 'archive' | 'restore'>
}

/** One account: derived balance, opening state, totals by type, recent transactions and actions. */
export function AccountDetailSheet({ detail, loading = false, accountId, onClose, onEdit, onTransfer, onOpenTransaction, ops }: AccountDetailSheetProps) {
  const toast = useToast()
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  async function run(action: () => Promise<unknown>, success: string, after?: () => void) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await action()
      toast.show({ message: success })
      after?.()
    } catch (error) {
      toast.show({ message: accountActionFailureMessage(error), tone: 'error' })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const account = detail?.account
  const card = account?.kind === 'credit_card'
  const canTransfer = Boolean(account && !account.archivedAt && !detail?.liability)

  return (
    <>
      <Drawer
        open={accountId !== null}
        onOpenChange={(open) => {
          if (!open && !busy) onClose()
        }}
        title={t('accounts.detail.title')}
        size="full"
        footer={
          account ? (
            <>
              <SecondaryButton size="lg" onClick={() => onEdit(account)} disabled={busy}>
                <Pencil aria-hidden="true" />
                {t('accounts.action.edit')}
              </SecondaryButton>
              {canTransfer && (
                <SecondaryButton size="lg" onClick={() => onTransfer(account.id)} disabled={busy}>
                  <ArrowLeftRight aria-hidden="true" />
                  {t('accounts.action.transferFrom')}
                </SecondaryButton>
              )}
              {account.archivedAt ? (
                <SecondaryButton size="lg" disabled={busy} onClick={() => void run(() => ops.restore(account.id), t('accounts.toast.restored', { name: account.name }))}>
                  <ArchiveRestore aria-hidden="true" />
                  {t('accounts.action.restore')}
                </SecondaryButton>
              ) : (
                <Button variant="outline" size="touch-lg" onClick={() => setConfirmArchive(true)} disabled={busy} aria-label={t('accounts.action.archive')}>
                  <Archive aria-hidden="true" />
                  <span className="max-sm:sr-only">{t('accounts.action.archive')}</span>
                </Button>
              )}
            </>
          ) : undefined
        }
      >
        {accountId && loading && <LoadingState />}
        {accountId && !loading && !detail && <EmptyState icon={SearchX} title={t('accounts.detail.notFound')} className="border-none" />}
        {detail && account && (
          <div className="flex flex-col gap-section">
            <div className="flex items-start gap-3">
              <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-neutral-muted">
                {createElement(ACCOUNT_KIND_VISUALS[account.kind].icon, { className: 'size-5' })}
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-base font-semibold">{account.name}</p>
                <p className="text-sm text-muted-foreground">{t(ACCOUNT_KIND_VISUALS[account.kind].labelKey)}</p>
                <StatusBadge status={account.archivedAt ? 'closed' : 'active'} label={t(account.archivedAt ? 'accounts.status.archived' : 'accounts.status.active')} className="self-start" />
              </div>
            </div>

            <div className="flex flex-col gap-1 rounded-lg border p-card">
              <span className="text-sm text-muted-foreground">{detail.liability ? t('accounts.detail.currentOwed') : t('accounts.detail.current')}</span>
              {detail.liability ? <LiabilityBalance balance={detail.balance} /> : <MoneyDisplay amount={detail.balance} size="xl" />}
              {card && <p className="pt-1 text-xs text-muted-foreground">{t('accounts.detail.cardNote')}</p>}
            </div>

            <dl className="divide-y divide-border border-y">
              <Row label={detail.liability ? t('accounts.detail.openingOwed') : t('accounts.detail.opening')}>{formatTHB(openingAmountOf(account), { trimZeroFraction: true })}</Row>
              <Row label={t('accounts.detail.openingDate')}>{formatDate(account.openingDate, 'long')}</Row>
              <Row label={t('accounts.detail.status')}>{t(account.archivedAt ? 'accounts.status.archived' : 'accounts.status.active')}</Row>
              <Row label={t('accounts.detail.inAvailable')}>{t(detail.inAvailable ? 'accounts.detail.inAvailableYes' : 'accounts.detail.inAvailableNo')}</Row>
              {account.note && <Row label={t('accounts.form.note')}>{account.note}</Row>}
            </dl>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">{t('accounts.detail.totals')}</h3>
              <dl className="grid grid-cols-2 gap-stack sm:grid-cols-3">
                {card ? (
                  <>
                    {/* A card has no "income" or transfers: purchases raise what is owed, payments lower it. */}
                    <Total label={t('accounts.detail.cardPurchases')} amount={detail.activity.expensesOut} />
                    <Total label={t('accounts.detail.cardPayments')} amount={detail.activity.debtPaymentsIn} />
                  </>
                ) : (
                  <>
                    <Total label={t('accounts.detail.incomeIn')} amount={detail.activity.incomeIn} />
                    <Total label={t('accounts.detail.expensesOut')} amount={detail.activity.expensesOut} />
                    <Total label={t('accounts.detail.transfersIn')} amount={detail.activity.transfersIn} />
                    <Total label={t('accounts.detail.transfersOut')} amount={detail.activity.transfersOut} />
                    <Total label={t('accounts.detail.debtPaymentsOut')} amount={detail.activity.debtPaymentsOut} />
                  </>
                )}
                {detail.activity.adjustments !== 0 && <Total label={t('accounts.detail.adjustments')} amount={detail.activity.adjustments} />}
              </dl>
            </section>

            <section className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold">{t('accounts.detail.recent')}</h3>
              {detail.recent.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">{t('accounts.detail.recentEmpty')}</p>
              ) : (
                <>
                  <ul aria-label={t('accounts.detail.recent')} className="-mx-card divide-y divide-border">
                    {detail.recent.map((row) => (
                      <TransactionRow
                        key={row.id}
                        type={row.type}
                        title={row.title}
                        amount={row.amount}
                        date={row.date}
                        categoryLabel={row.categoryLabel}
                        categoryIcon={row.categoryIcon}
                        accountLabel={row.accountLabel}
                        toAccountLabel={row.toAccountLabel}
                        hasAttachment={row.hasAttachment}
                        onSelect={() => onOpenTransaction(row.id)}
                      />
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground">{t('accounts.detail.more', { shown: detail.recent.length, total: detail.totalTransactions })}</p>
                </>
              )}
            </section>
          </div>
        )}
      </Drawer>

      {account && detail && (
        <Dialog
          open={confirmArchive}
          onOpenChange={(open) => {
            if (!busy) setConfirmArchive(open)
          }}
          title={t('accounts.archive.title')}
          description={t('accounts.archive.hint')}
          footer={
            <>
              <SecondaryButton onClick={() => setConfirmArchive(false)} disabled={busy}>
                {t('detail.cancel')}
              </SecondaryButton>
              <PrimaryButton disabled={busy} onClick={() => void run(() => ops.archive(account.id), t('accounts.toast.archived', { name: account.name }), () => setConfirmArchive(false))}>
                <Archive aria-hidden="true" />
                {t('accounts.action.archive')}
              </PrimaryButton>
            </>
          }
        >
          <div className="flex flex-col gap-2 text-sm text-muted-foreground">
            <p>{t('accounts.archive.detail', { amount: formatTHB(detail.balance, { trimZeroFraction: true }) })}</p>
            {detail.ruleCount > 0 && <p>{t('accounts.archive.rules', { count: detail.ruleCount })}</p>}
            {detail.linkedDebt && <p className="text-warning">{t('accounts.error.linked_to_debt')}</p>}
          </div>
        </Dialog>
      )}
    </>
  )
}
