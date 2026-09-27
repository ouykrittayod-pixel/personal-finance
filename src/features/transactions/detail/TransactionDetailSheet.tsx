import { useLiveQuery } from 'dexie-react-hooks'
import { Pencil, SearchX, Trash2 } from 'lucide-react'
import { useId, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { PrimaryButton, SecondaryButton } from '@/components/actions/buttons'
import { AttachmentPreview } from '@/components/data/AttachmentPreview'
import { EmptyState } from '@/components/feedback/EmptyState'
import { ErrorState } from '@/components/feedback/ErrorState'
import { LoadingState } from '@/components/feedback/LoadingState'
import { useToast } from '@/components/feedback/toast-context'
import { describeTransaction, payDebtLabel } from '@/components/finance/describe-transaction'
import { MoneyDisplay } from '@/components/finance/MoneyDisplay'
import { TRANSACTION_VISUALS } from '@/components/finance/transaction-visuals'
import { Dialog } from '@/components/overlays/Dialog'
import { Drawer } from '@/components/overlays/Drawer'
import { Button } from '@/components/ui/button'
import { transactionsRepository, type AttachmentChanges } from '@/db/repositories'
import type { ID, ISODate } from '@/domain/entities'
import { allocationOf } from '@/domain/debts'
import type { EditableType, TransactionDraft } from '@/domain/transactions'
import { AMOUNT_INPUT_ID, TransactionForm, type AttachmentEdits } from '@/features/transaction-form'
import { formatDate, formatDateTime, formatTHB } from '@/lib/formatting'
import { t } from '@/lib/i18n'
import { newId } from '@/lib/ids'
import { cn } from '@/lib/utils'
import { loadTransactionDetail, type TransactionDetail } from './detail-data'

export type UpdateTransaction = (id: ID, draft: TransactionDraft, attachments: AttachmentChanges) => Promise<void>
export type DeleteTransaction = (id: ID) => Promise<void>

const defaultUpdate: UpdateTransaction = async (id, draft, attachments) => {
  await transactionsRepository.update(id, draft, attachments, { now: new Date().toISOString(), newId })
}
const defaultRemove: DeleteTransaction = async (id) => {
  await transactionsRepository.delete(id, { now: new Date().toISOString() })
}

const EDITABLE = new Set<string>(['expense', 'income', 'debt_payment', 'transfer'])

export interface TransactionDetailSheetProps {
  /** The transaction to show; null = closed. */
  transactionId: ID | null
  onClose: () => void
  today: ISODate
  /** Injected in tests. */
  load?: (id: ID) => Promise<TransactionDetail | null>
  update?: UpdateTransaction
  remove?: DeleteTransaction
}

type LoadResult = { ok: true; detail: TransactionDetail | null } | { ok: false } | null

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-sm break-words">{children}</dd>
    </div>
  )
}

function DetailView({ detail }: { detail: TransactionDetail }) {
  const { transaction: tx, category, account, toAccount, debt, attachments } = detail
  const visual = TRANSACTION_VISUALS[tx.type]
  const TypeIcon = visual.icon
  const title = describeTransaction(tx, { categoryName: category?.name, debtName: debt?.name, toAccountName: toAccount?.name })
  const allocation = tx.type === 'debt_payment' ? allocationOf(tx) : null
  const isLoanPayment = tx.type === 'debt_payment' && debt !== undefined && debt.kind !== 'credit_card'

  const openAttachment = (blob: Blob | undefined) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  return (
    <div className="flex flex-col gap-section">
      <div className="flex flex-col items-start gap-2">
        <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', visual.iconClass)}>
          <TypeIcon className="size-3.5" aria-hidden="true" />
          {t(visual.labelKey)}
        </span>
        <MoneyDisplay amount={tx.amountSatang} tone={visual.tone} sign={visual.sign} size="xl" />
        <p className="text-base font-medium">{title}</p>
      </div>

      <dl className="divide-y divide-border border-y">
        <Row label={t('detail.type')}>{t(visual.labelKey)}</Row>
        {tx.description && <Row label={t('detail.description')}>{tx.description}</Row>}
        {(tx.type === 'expense' || tx.type === 'income') && (
          <Row label={t('detail.category')}>{category ? `${category.icon ? `${category.icon} ` : ''}${category.name}` : t('detail.uncategorized')}</Row>
        )}
        {tx.type === 'transfer' || (tx.type === 'debt_payment' && toAccount) ? (
          <>
            <Row label={t('detail.fromAccount')}>{account?.name ?? '—'}</Row>
            <Row label={t('detail.toAccount')}>{toAccount?.name ?? '—'}</Row>
          </>
        ) : (
          <Row label={tx.type === 'income' ? t('txForm.receivedTo') : tx.type === 'expense' || tx.type === 'debt_payment' ? t('detail.fromAccount') : t('detail.account')}>
            {account?.name ?? '—'}
          </Row>
        )}
        {tx.type === 'debt_payment' && (
          <>
            <Row label={t('detail.debt')}>{debt ? payDebtLabel(debt.name) : '—'}</Row>
            {allocation && (
              <>
                <Row label={t('detail.principal')}>
                  <MoneyDisplay amount={allocation.principal} size="sm" />
                </Row>
                <Row label={t('detail.interest')}>
                  <MoneyDisplay amount={allocation.interest} size="sm" />
                </Row>
                <Row label={t('detail.fee')}>
                  <MoneyDisplay amount={allocation.fee} size="sm" />
                </Row>
              </>
            )}
            {!allocation && isLoanPayment && <Row label={t('detail.principal')}>{t('debts.unallocated')}</Row>}
          </>
        )}
        <Row label={t('detail.date')}>
          <time dateTime={tx.date}>{formatDate(tx.date, 'long')}</time>
        </Row>
        {detail.recurring && (
          <Row label={t('detail.recurring')}>
            <Link to={`/recurring?id=${detail.recurring.obligationId}`} className="focus-ring rounded-sm font-medium text-primary hover:underline">
              {t('detail.recurringDue', { name: detail.recurring.name, date: formatDate(detail.recurring.dueDate) })}
            </Link>
          </Row>
        )}
        {tx.note && <Row label={t('detail.note')}>{tx.note}</Row>}
        <Row label={t('detail.createdAt')}>{formatDateTime(tx.createdAt)}</Row>
        {tx.updatedAt !== tx.createdAt && <Row label={t('detail.updatedAt')}>{formatDateTime(tx.updatedAt)}</Row>}
      </dl>

      {attachments.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t('detail.attachments')}</h3>
          <ul className="grid gap-2 sm:grid-cols-2" aria-label={t('detail.attachments')}>
            {attachments.map(({ attachment, blob }) => (
              <li key={attachment.id}>
                <AttachmentPreview
                  fileName={attachment.fileName}
                  mimeType={attachment.mimeType}
                  sizeBytes={attachment.sizeBytes}
                  blob={blob}
                  onOpen={blob ? () => openAttachment(blob) : undefined}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {!EDITABLE.has(tx.type) && <p className="text-sm text-muted-foreground">{t('detail.adjustmentNoEdit')}</p>}
    </div>
  )
}

/**
 * Detail / edit / delete for one transaction. Full-screen on phones,
 * right-side panel on larger screens. Edits reuse the shared TransactionForm
 * (same domain validation as creating); delete asks for confirmation.
 */
export function TransactionDetailSheet({
  transactionId,
  onClose,
  today,
  load = loadTransactionDetail,
  update = defaultUpdate,
  remove = defaultRemove,
}: TransactionDetailSheetProps) {
  const formId = useId()
  const toast = useToast()
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [saving, setSaving] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const deletingRef = useRef(false)

  // A different transaction (or closing) always starts in view mode.
  const [shownId, setShownId] = useState(transactionId)
  if (shownId !== transactionId) {
    setShownId(transactionId)
    setMode('view')
    setSaving(false)
    setConfirmOpen(false)
    setDeleteError(null)
  }

  const result = useLiveQuery<LoadResult>(
    () => (transactionId ? load(transactionId).then((detail) => ({ ok: true as const, detail }), () => ({ ok: false as const })) : null),
    [transactionId, load, attempt],
  )
  const detail = result?.ok ? result.detail : null
  const tx = detail?.transaction
  const canEdit = tx !== undefined && EDITABLE.has(tx.type)
  const label = detail ? describeTransaction(tx!, { categoryName: detail.category?.name, debtName: detail.debt?.name, toAccountName: detail.toAccount?.name }) : ''

  async function confirmDelete() {
    if (!tx || deletingRef.current) return
    deletingRef.current = true
    setDeleting(true)
    setDeleteError(null)
    try {
      await remove(tx.id)
      toast.show({ message: t('detail.deleted', { description: label, amount: formatTHB(tx.amountSatang, { trimZeroFraction: true }) }) })
      setConfirmOpen(false)
      onClose()
    } catch {
      setDeleteError(t('detail.deleteFailed'))
    } finally {
      deletingRef.current = false
      setDeleting(false)
    }
  }

  let footer: ReactNode
  if (detail && mode === 'view') {
    footer = (
      <>
        {canEdit && (
          <SecondaryButton size="lg" onClick={() => setMode('edit')}>
            <Pencil aria-hidden="true" />
            {t('detail.edit')}
          </SecondaryButton>
        )}
        <Button variant="destructive" size="touch-lg" onClick={() => setConfirmOpen(true)}>
          <Trash2 aria-hidden="true" />
          {t('detail.delete')}
        </Button>
      </>
    )
  } else if (detail && mode === 'edit') {
    footer = (
      <>
        <SecondaryButton size="lg" onClick={() => setMode('view')} disabled={saving}>
          {t('detail.cancel')}
        </SecondaryButton>
        <PrimaryButton type="submit" form={formId} size="lg" loading={saving}>
          {t('detail.save')}
        </PrimaryButton>
      </>
    )
  }

  return (
    <>
      <Drawer
        open={transactionId !== null}
        onOpenChange={(open) => {
          if (!open && !saving) onClose()
        }}
        title={mode === 'edit' ? t('detail.editTitle') : t('detail.title')}
        size="full"
        footer={footer}
        onOpenAutoFocus={(event) => {
          if (mode === 'edit') {
            event.preventDefault()
            document.getElementById(AMOUNT_INPUT_ID)?.focus()
          }
        }}
      >
        {transactionId && result === undefined && <LoadingState />}
        {result && !result.ok && <ErrorState onRetry={() => setAttempt((n) => n + 1)} />}
        {result?.ok && !detail && <EmptyState icon={SearchX} title={t('detail.notFound')} className="border-none" />}
        {detail && mode === 'view' && <DetailView detail={detail} />}
        {detail && mode === 'edit' && (
          <TransactionForm
            formId={formId}
            type={detail.transaction.type as EditableType}
            data={detail.formData}
            initial={detail.transaction}
            existingAttachments={detail.attachments}
            today={today}
            onSavingChange={setSaving}
            onSubmit={async (draft, attachments: AttachmentEdits) => {
              await update(detail.transaction.id, draft, { add: attachments.add, remove: attachments.remove })
              toast.show({ message: t('detail.saved') })
              setSaving(false)
              setMode('view')
            }}
          />
        )}
      </Drawer>

      {tx && (
        <Dialog
          open={confirmOpen}
          onOpenChange={(open) => {
            if (!deleting) setConfirmOpen(open)
          }}
          title={t('detail.deleteConfirm')}
          description={tx.type === 'debt_payment' ? `${t('detail.deleteHint')} ${t('detail.deleteHintDebt')}` : t('detail.deleteHint')}
          footer={
            <>
              <SecondaryButton onClick={() => setConfirmOpen(false)} disabled={deleting}>
                {t('detail.cancel')}
              </SecondaryButton>
              <Button variant="destructive" size="touch" onClick={() => void confirmDelete()} disabled={deleting} aria-busy={deleting || undefined}>
                <Trash2 aria-hidden="true" />
                {t('detail.delete')}
              </Button>
            </>
          }
        >
          <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
            <span className="min-w-0 truncate font-medium">{label}</span>
            <MoneyDisplay amount={tx.amountSatang} tone={TRANSACTION_VISUALS[tx.type].tone} sign={TRANSACTION_VISUALS[tx.type].sign} />
          </div>
          {deleteError && (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          )}
        </Dialog>
      )}
    </>
  )
}
