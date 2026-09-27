/**
 * Debts page data: loader (repositories → raw) and pure view-model builders.
 * Balance rules live in domain/debts; this file only shapes them for the UI.
 */
import type { StatusKind } from '@/components/finance/StatusBadge'
import {
  accountsRepository,
  attachmentsRepository,
  categoriesRepository,
  debtsRepository,
  recurringObligationsRepository,
  scheduledPaymentsRepository,
  transactionsRepository,
} from '@/db/repositories'
import { estimatePayoff, type PayoffEstimate } from '@/domain/amortization'
import { debtPosition, isDebtActive, isRevolving, loanProgress, obligationOwningDebt, owedOf, type DebtPosition } from '@/domain/debts'
import type { Account, CardStatement, Category, Debt, ID, ISODate, RecurringObligation, ScheduledPayment, Transaction } from '@/domain/entities'
import { add, ratioBps, sum, ZERO, type BasisPoints, type Satang } from '@/domain/money'
import { addDays } from '@/domain/recurrence'
import { daysOverdue, paymentState } from '@/domain/scheduling'
import { formatDate, formatPercentBps, formatTHB } from '@/lib/formatting'
import { t } from '@/lib/i18n'

/** "Upcoming installments" covers overdue plus the next 30 days. */
export const UPCOMING_DAYS = 30

export interface DebtsRawData {
  debts: Debt[]
  accounts: Account[]
  categories: Category[]
  transactions: Transaction[]
  /** Scheduled payments of debts and of obligations that pay a debt. */
  payments: ScheduledPayment[]
  obligations: RecurringObligation[]
}

export async function loadDebtsData(): Promise<DebtsRawData> {
  const [debts, accounts, categories, transactions, payments, obligations] = await Promise.all([
    debtsRepository.listAll(),
    accountsRepository.listAll(),
    categoriesRepository.listAll(),
    transactionsRepository.listAll(),
    scheduledPaymentsRepository.listAll(),
    recurringObligationsRepository.listAll(),
  ])
  return { debts, accounts, categories, transactions, payments, obligations }
}

/** Occurrences that pay this debt, from whichever source owns its schedule. */
export function occurrencesForDebt(debt: Debt, payments: readonly ScheduledPayment[], obligations: readonly RecurringObligation[]): ScheduledPayment[] {
  const owner = obligationOwningDebt(debt.id, obligations)
  return payments.filter((p) => (p.sourceType === 'debt' && p.sourceId === debt.id) || (owner !== undefined && p.sourceType === 'obligation' && p.sourceId === owner.id))
}

const byDue = (a: ScheduledPayment, b: ScheduledPayment) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id)

/** The occurrence to act on: oldest overdue, else the next unpaid. */
export const nextOccurrence = (occurrences: readonly ScheduledPayment[]) => [...occurrences].filter((p) => p.status === 'pending').sort(byDue)[0]

export function describeOccurrence(payment: Pick<ScheduledPayment, 'status' | 'dueDate'>, today: ISODate): { kind: StatusKind; label: string } {
  const state = paymentState(payment, today)
  switch (state) {
    case 'overdue':
      return { kind: 'overdue', label: t('recurring.overdueDays', { days: daysOverdue(payment, today) }) }
    case 'due_soon':
      return { kind: 'due_soon', label: payment.dueDate === today ? t('recurring.dueToday') : t('status.due_soon') }
    case 'pending':
      return { kind: 'pending', label: t('recurring.unpaid') }
    case 'paid':
      return { kind: 'paid', label: t('status.paid') }
    case 'skipped':
      return { kind: 'skipped', label: t('status.skipped') }
  }
}

/** The latest statement the user entered (never the live card balance). */
export const latestStatement = (debt: Debt): CardStatement | undefined =>
  [...(debt.statements ?? [])].sort((a, b) => b.statementDate.localeCompare(a.statementDate))[0]

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export interface DebtRow {
  id: ID
  name: string
  kindLabel: string
  lender?: string
  isCard: boolean
  /** Null = unknown (e.g. the card account is missing) — never shown as zero. */
  outstanding: Satang | null
  /** "งวดละ ฿18,000" / "ขั้นต่ำ ฿1,200 ตามใบแจ้งยอด" — only when known. */
  dueAmountText?: string
  nextDue?: { dueDate: ISODate; amount: Satang; status: { kind: StatusKind; label: string } }
  /** Loans only: explicitly repaid principal vs. opening (+ increases). */
  progress?: { paidBps: BasisPoints; text: string }
  paidOff: boolean
  hasUnallocated: boolean
}

export interface DebtsModel {
  metrics: {
    totalOutstanding: Satang
    /** Loans with unknown outstanding (card account missing) are excluded from the total. */
    unknownCount: number
    paidThisMonth: Satang
    paidThisMonthCount: number
    upcomingTotal: Satang
    upcomingCount: number
    upcomingUntil: ISODate
    activeCount: number
  }
  rows: DebtRow[]
}

export function buildDebtsModel(raw: DebtsRawData, today: ISODate): DebtsModel {
  const month = today.slice(0, 7)
  const visible = raw.debts.filter((d) => !d.archivedAt)
  const active = visible.filter(isDebtActive)
  const upcomingUntil = addDays(today, UPCOMING_DAYS)
  const liveDebtIds = new Set(visible.map((d) => d.id))

  let totalOutstanding = ZERO
  let unknownCount = 0
  let upcomingTotal = ZERO
  let upcomingCount = 0

  const rows = visible.map((debt): DebtRow & { rank: number; sortDue: string } => {
    const position = debtPosition(debt, raw.accounts, raw.transactions, today)
    const occurrences = occurrencesForDebt(debt, raw.payments, raw.obligations)
    const next = nextOccurrence(occurrences)
    const activeDebt = isDebtActive(debt)
    if (activeDebt) {
      if (position.outstanding === null) unknownCount += 1
      totalOutstanding = add(totalOutstanding, owedOf(position))
      for (const p of occurrences) {
        if (p.status === 'pending' && p.dueDate <= upcomingUntil) {
          upcomingTotal = add(upcomingTotal, p.expectedAmountSatang)
          upcomingCount += 1
        }
      }
    }

    let dueAmountText: string | undefined
    if (isRevolving(debt)) {
      const statement = latestStatement(debt)
      if (statement) {
        dueAmountText =
          statement.minimumDueSatang !== undefined
            ? t('debts.row.minimumDue', { amount: money(statement.minimumDueSatang) })
            : t('debts.row.statementDue', { amount: money(statement.balanceSatang) })
      }
    } else if (debt.installmentSatang) {
      dueAmountText = t('debts.row.installment', { amount: money(debt.installmentSatang) })
    }

    const progress = rowProgress(position)
    const status = next ? describeOccurrence(next, today) : undefined
    const paidOff = debt.status === 'paid_off' || (position.model === 'loan' && position.outstanding === 0 && position.loan.paymentCount > 0)
    return {
      id: debt.id,
      name: debt.name,
      kindLabel: t(`debts.kind.${debt.kind}`),
      lender: debt.lender,
      isCard: isRevolving(debt),
      outstanding: position.outstanding,
      dueAmountText,
      nextDue: next && status ? { dueDate: next.dueDate, amount: next.expectedAmountSatang, status } : undefined,
      progress,
      paidOff,
      hasUnallocated: position.model === 'loan' && position.loan.unallocatedCount > 0,
      rank: !activeDebt ? 3 : status?.kind === 'overdue' ? 0 : status?.kind === 'due_soon' ? 1 : 2,
      sortDue: next?.dueDate ?? '9999',
    }
  })

  const monthPayments = raw.transactions.filter((tx) => tx.type === 'debt_payment' && tx.debtId && liveDebtIds.has(tx.debtId) && tx.date.startsWith(`${month}-`) && tx.date <= today)

  return {
    metrics: {
      totalOutstanding,
      unknownCount,
      paidThisMonth: sum(monthPayments.map((tx) => tx.amountSatang)),
      paidThisMonthCount: monthPayments.length,
      upcomingTotal,
      upcomingCount,
      upcomingUntil,
      activeCount: active.length,
    },
    rows: rows
      .sort((a, b) => a.rank - b.rank || a.sortDue.localeCompare(b.sortDue) || (b.outstanding ?? 0) - (a.outstanding ?? 0) || a.name.localeCompare(b.name))
      .map(({ rank: _rank, sortDue: _sortDue, ...row }) => row),
  }
}

const money = (amount: Satang) => formatTHB(amount, { trimZeroFraction: true })

function rowProgress(position: DebtPosition): DebtRow['progress'] {
  if (position.model !== 'loan') return undefined
  const progress = loanProgress(position.loan)
  if (!progress) return undefined
  const paidBps = ratioBps(progress.paid, progress.base)
  return { paidBps, text: t('debts.row.progress', { percent: formatPercentBps(paidBps) }) }
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export interface DebtDetail {
  debt: Debt
  position: DebtPosition
  /** Newest first. */
  occurrences: ScheduledPayment[]
  /** Recurring obligation that owns this debt's schedule, if any. */
  owner?: RecurringObligation
  /** Debt payments, newest first. */
  payments: Transaction[]
  withReceipts: Set<ID>
  estimate: PayoffEstimate
  /** For forms. */
  accounts: Account[]
  categories: Category[]
  debts: Debt[]
  obligations: RecurringObligation[]
}

export function buildDebtDetail(raw: DebtsRawData, id: ID, withReceipts: Set<ID>): DebtDetail | null {
  const debt = raw.debts.find((d) => d.id === id)
  if (!debt || debt.archivedAt) return null
  const position = debtPosition(debt, raw.accounts, raw.transactions)
  const payments = raw.transactions
    .filter((tx) => tx.type === 'debt_payment' && tx.debtId === id)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
  return {
    debt,
    position,
    occurrences: occurrencesForDebt(debt, raw.payments, raw.obligations).sort((a, b) => b.dueDate.localeCompare(a.dueDate)),
    owner: obligationOwningDebt(id, raw.obligations),
    payments,
    withReceipts,
    estimate: position.model === 'loan' ? estimatePayoff(debt, position.outstanding) : { kind: 'unavailable' },
    accounts: raw.accounts,
    categories: raw.categories,
    debts: raw.debts,
    obligations: raw.obligations,
  }
}

export async function loadDebtDetail(id: ID, load: () => Promise<DebtsRawData> = loadDebtsData): Promise<DebtDetail | null> {
  const raw = await load()
  const paymentIds = raw.transactions.filter((tx) => tx.type === 'debt_payment' && tx.debtId === id).map((tx) => tx.id)
  const withReceipts = await attachmentsRepository.transactionIdsWithAttachments(paymentIds)
  return buildDebtDetail(raw, id, withReceipts)
}

/** Label for a due date shown in lists. */
export const dueText = (date: ISODate) => t('debts.row.nextDue', { date: formatDate(date) })
