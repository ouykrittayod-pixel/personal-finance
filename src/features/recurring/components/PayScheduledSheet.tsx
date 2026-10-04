import { useId, useState } from 'react'
import { PrimaryButton, SecondaryButton } from '@/components/actions/buttons'
import { useToast } from '@/components/feedback/toast-context'
import { MoneyDisplay } from '@/components/finance/MoneyDisplay'
import { Drawer } from '@/components/overlays/Drawer'
import { PaymentAlreadySettledError, paymentTypeFor } from '@/db/repositories'
import type { ISODate, RecurringObligation, ScheduledPayment } from '@/domain/entities'
import { AMOUNT_INPUT_ID, TransactionForm } from '@/features/transaction-form'
import { formatDate, formatTHB } from '@/lib/formatting'
import { t } from '@/lib/i18n'
import { newId } from '@/lib/ids'
import { actionFailureMessage } from '../errors'
import type { RecurringDetail } from '../recurring-data'
import type { RecurringOps } from '../recurring-ops'

export interface PayScheduledSheetProps {
  payment: ScheduledPayment | null
  obligation: RecurringObligation
  detail: Pick<RecurringDetail, 'categories' | 'accounts' | 'debts'>
  today: ISODate
  onClose: () => void
  markPaid: RecurringOps['markPaid']
}

/**
 * "ชำระรายการนี้แล้ว": confirm the real payment — actual date, amount,
 * account (and receipts) — using the shared TransactionForm. The transaction
 * is created, linked and the occurrence marked paid in one atomic write.
 */
export function PayScheduledSheet({ payment, obligation, detail, today, onClose, markPaid }: PayScheduledSheetProps) {
  const formId = useId()
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  // One transaction id per dialog: repeated confirms can never create a second transaction.
  const [transactionId, setTransactionId] = useState(newId)
  const [shownId, setShownId] = useState(payment?.id)
  if (shownId !== payment?.id) {
    setShownId(payment?.id)
    setSaving(false)
    if (payment) setTransactionId(newId())
  }

  const { type, debtId, toAccountId } = payment ? paymentTypeFor(payment, obligation) : { type: 'expense' as const, debtId: undefined, toAccountId: undefined }
  const income = obligation.kind === 'income'

  return (
    <Drawer
      open={payment !== null}
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
      title={t(income ? 'income.receive.title' : 'recurring.pay.title', { name: obligation.name })}
      description={t(income ? 'income.receive.hint' : 'recurring.pay.hint')}
      size="full"
      onOpenAutoFocus={(event) => {
        event.preventDefault()
        document.getElementById(AMOUNT_INPUT_ID)?.focus()
      }}
      footer={
        payment ? (
          <>
            <SecondaryButton size="lg" onClick={onClose} disabled={saving}>
              {t('detail.cancel')}
            </SecondaryButton>
            <PrimaryButton type="submit" form={formId} size="lg" loading={saving}>
              {t(income ? 'income.receive.confirm' : 'recurring.pay.confirm')}
            </PrimaryButton>
          </>
        ) : undefined
      }
    >
      {payment && (
        <div className="flex flex-col gap-section">
          <dl className="grid grid-cols-2 gap-stack rounded-lg border p-card">
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">{t(income ? 'income.receive.dueDate' : 'recurring.pay.dueDate')}</dt>
              <dd className="font-medium">
                <time dateTime={payment.dueDate}>{formatDate(payment.dueDate)}</time>
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">{t(income ? 'income.receive.expected' : 'recurring.pay.expected')}</dt>
              <dd>
                <MoneyDisplay amount={payment.expectedAmountSatang} size="md" />
              </dd>
            </div>
          </dl>
          <TransactionForm
            key={transactionId}
            formId={formId}
            type={type}
            // Date and account are what the user confirms here, so show them.
            detailsInitiallyOpen
            data={{
              categories: detail.categories.filter((c) => c.kind === (income ? 'income' : 'expense') && (!c.archivedAt || c.id === obligation.categoryId)),
              accounts: detail.accounts.filter((a) => !a.archivedAt),
              debts: detail.debts,
            }}
            defaults={{
              amountSatang: payment.expectedAmountSatang,
              categoryId: obligation.categoryId,
              accountId: obligation.defaultAccountId,
              debtId,
              toAccountId,
              date: today,
              description: obligation.name,
            }}
            today={today}
            onSavingChange={setSaving}
            onSubmit={async (draft, attachments) => {
              try {
                await markPaid(payment.id, draft, attachments.add, transactionId)
              } catch (error) {
                // Already paid (e.g. in another tab) or skipped: nothing to do here any more.
                if (error instanceof PaymentAlreadySettledError) {
                  toast.show({ message: actionFailureMessage(error), tone: 'info' })
                  setSaving(false)
                  onClose()
                  return
                }
                throw error
              }
              toast.show({ message: t(income ? 'income.receive.done' : 'recurring.toast.paid', { name: obligation.name, amount: formatTHB(draft.amountSatang!, { trimZeroFraction: true }) }) })
              setSaving(false)
              onClose()
            }}
          />
        </div>
      )}
    </Drawer>
  )
}
