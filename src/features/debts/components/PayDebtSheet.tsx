import { useId, useState } from 'react'
import { PrimaryButton, SecondaryButton } from '@/components/actions/buttons'
import { useToast } from '@/components/feedback/toast-context'
import { MoneyDisplay } from '@/components/finance/MoneyDisplay'
import { Drawer } from '@/components/overlays/Drawer'
import { PaymentAlreadySettledError } from '@/db/repositories'
import { isRevolving } from '@/domain/debts'
import type { ISODate, ScheduledPayment } from '@/domain/entities'
import { accountClassOf } from '@/domain/transactions'
import { AMOUNT_INPUT_ID, TransactionForm } from '@/features/transaction-form'
import { formatDate, formatTHB } from '@/lib/formatting'
import { t } from '@/lib/i18n'
import { newId } from '@/lib/ids'
import type { DebtDetail } from '../debts-data'
import type { DebtsOps } from '../debts-ops'
import { debtActionFailureMessage } from '../errors'

/** What is being paid: a scheduled occurrence, or an unscheduled (extra) repayment. */
export type PayTarget = { kind: 'occurrence'; payment: ScheduledPayment } | { kind: 'extra' }

export interface PayDebtSheetProps {
  target: PayTarget | null
  detail: DebtDetail
  today: ISODate
  onClose: () => void
  ops: Pick<DebtsOps, 'markPaid' | 'pay'>
}

/**
 * Record a real repayment with the shared TransactionForm: actual date,
 * amount, source account, receipts — and, for loans, the principal /
 * interest / fee split. One debt_payment transaction; a scheduled
 * occurrence is linked and marked paid in the same atomic write.
 */
export function PayDebtSheet({ target, detail, today, onClose, ops }: PayDebtSheetProps) {
  const formId = useId()
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  // One transaction id per dialog: repeated confirms can never create a second payment.
  const [transactionId, setTransactionId] = useState(newId)
  const [shown, setShown] = useState(target)
  if (shown !== target) {
    setShown(target)
    setSaving(false)
    if (target) setTransactionId(newId())
  }

  const { debt, position, owner } = detail
  const payment = target?.kind === 'occurrence' ? target.payment : undefined
  const hasPending = detail.occurrences.some((p) => p.status === 'pending')
  const defaultAccountId =
    (payment?.sourceType === 'obligation' ? owner?.defaultAccountId : undefined) ??
    detail.accounts.find((a) => !a.archivedAt && accountClassOf(a.kind) === 'asset')?.id

  return (
    <Drawer
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
      // "Extra" only when there are installments to pay besides it.
      title={target?.kind === 'extra' && hasPending ? t('debts.pay.extraTitle', { name: debt.name }) : t('debts.pay.title', { name: debt.name })}
      description={isRevolving(debt) ? t('debts.detail.cardPaymentsNote') : t('debts.pay.hint')}
      size="full"
      onOpenAutoFocus={(event) => {
        event.preventDefault()
        document.getElementById(AMOUNT_INPUT_ID)?.focus()
      }}
      footer={
        target ? (
          <>
            <SecondaryButton size="lg" onClick={onClose} disabled={saving}>
              {t('detail.cancel')}
            </SecondaryButton>
            <PrimaryButton type="submit" form={formId} size="lg" loading={saving}>
              {t('debts.pay.confirm')}
            </PrimaryButton>
          </>
        ) : undefined
      }
    >
      {target && (
        <div className="flex flex-col gap-section">
          <dl className="grid grid-cols-2 gap-stack rounded-lg border p-card">
            {payment && (
              <>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs text-muted-foreground">{t('debts.pay.due')}</dt>
                  <dd className="font-medium">
                    <time dateTime={payment.dueDate}>{formatDate(payment.dueDate)}</time>
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs text-muted-foreground">{t('debts.pay.expected')}</dt>
                  <dd>
                    <MoneyDisplay amount={payment.expectedAmountSatang} size="md" />
                  </dd>
                </div>
              </>
            )}
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">{position.model === 'loan' ? t('debts.pay.outstanding') : t('debts.pay.cardOwed')}</dt>
              <dd>{position.outstanding === null ? t('debts.unknown') : <MoneyDisplay amount={position.outstanding} size="md" tone="debt" />}</dd>
            </div>
          </dl>
          <TransactionForm
            key={transactionId}
            formId={formId}
            type="debt_payment"
            detailsInitiallyOpen
            data={{ categories: [], accounts: detail.accounts.filter((a) => !a.archivedAt), debts: detail.debts }}
            defaults={{
              amountSatang: payment?.expectedAmountSatang,
              accountId: defaultAccountId,
              debtId: debt.id,
              date: today,
              description: debt.name,
            }}
            today={today}
            onSavingChange={setSaving}
            onSubmit={async (draft, attachments) => {
              try {
                if (payment) await ops.markPaid(payment.id, draft, attachments.add, transactionId)
                else await ops.pay(draft, attachments.add, transactionId)
              } catch (error) {
                // Already paid (e.g. in another tab) or skipped: nothing left to do here.
                if (error instanceof PaymentAlreadySettledError) {
                  toast.show({ message: debtActionFailureMessage(error), tone: 'info' })
                  setSaving(false)
                  onClose()
                  return
                }
                throw error
              }
              toast.show({ message: t('debts.toast.paid', { name: debt.name, amount: formatTHB(draft.amountSatang!, { trimZeroFraction: true }) }) })
              setSaving(false)
              onClose()
            }}
          />
        </div>
      )}
    </Drawer>
  )
}
