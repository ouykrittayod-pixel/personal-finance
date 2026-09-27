/**
 * Income page data: the Transactions loader (no second data layer) plus
 * recurring income rules, and a pure view-model builder. Income = `income`
 * transactions only — transfers, expenses and debt payments never appear here.
 */
import type { StatusKind } from '@/components/finance/StatusBadge'
import { describeTransaction } from '@/components/finance/describe-transaction'
import { recurringObligationsRepository, scheduledPaymentsRepository } from '@/db/repositories'
import type { Category, ID, ISODate, RecurringObligation, ScheduledPayment } from '@/domain/entities'
import { incomePeriodTotal, isIncome, type IncomeFilter, type IncomeTotal } from '@/domain/income'
import { compareNewestFirst, groupByDate, inRange, matchesSearch, normalizeSearch, type DateRange } from '@/domain/ledger'
import type { Satang } from '@/domain/money'
import { isIncomeObligation, obligationStatus } from '@/domain/scheduling'
import { describePayment } from '@/features/recurring/recurring-data'
import { defaultFilters, loadLedgerData, resolveRange, type LedgerFilters, type LedgerRawData, type LedgerRow } from '@/features/transactions/ledger-data'
import { formatDate } from '@/lib/formatting'
import { t } from '@/lib/i18n'

export const INCOME_PAGE_SIZE = 50
export const ALL = 'all'

export interface IncomeFilters extends LedgerFilters {
  /** Income category id, or 'all'. */
  categoryId: string
  /** Receiving account id, or 'all'. */
  accountId: string
}

export function defaultIncomeFilters(today: ISODate): IncomeFilters {
  return { ...defaultFilters(today), type: 'income', categoryId: ALL, accountId: ALL }
}

export interface IncomeRawData extends LedgerRawData {
  obligations: RecurringObligation[]
  /** Scheduled payments of recurring obligations (income rules are picked out in the builder). */
  payments: ScheduledPayment[]
}

export async function loadIncomeData(): Promise<IncomeRawData> {
  const [ledger, obligations, payments] = await Promise.all([loadLedgerData(), recurringObligationsRepository.listAll(), scheduledPaymentsRepository.listAll()])
  return { ...ledger, obligations, payments: payments.filter((p) => p.sourceType === 'obligation') }
}

export interface IncomeRuleRow {
  id: ID
  name: string
  icon?: string
  amount: Satang
  categoryLabel?: string
  accountLabel?: string
  paused: boolean
  /** The occurrence to receive next (oldest overdue first). */
  current?: ScheduledPayment
  dueText: string
  status: { kind: StatusKind; label: string }
}

export interface IncomeModel {
  range: DateRange
  rangeReversed: boolean
  /** Selected period (and category/account); independent of search. */
  summary: IncomeTotal
  groups: { date: ISODate; label: string; rows: LedgerRow[] }[]
  matchCount: number
  shownCount: number
  emptyReason: 'no_data' | 'no_match' | null
  categoryOptions: { value: string; label: string }[]
  accountOptions: { value: string; label: string }[]
  rules: IncomeRuleRow[]
}

const pick = (value: string): string | undefined => (value === ALL ? undefined : value)

export function buildIncomeModel(raw: IncomeRawData, filters: IncomeFilters, today: ISODate, limit: number): IncomeModel {
  const { range, reversed } = resolveRange(filters, today)
  const categories = new Map(raw.categories.map((c) => [c.id, c]))
  const accounts = new Map(raw.accounts.map((a) => [a.id, a]))
  const filter: IncomeFilter = { categoryId: pick(filters.categoryId), accountId: pick(filters.accountId) }
  const query = normalizeSearch(filters.search)

  const matches: LedgerRow[] = []
  for (const tx of [...raw.transactions].sort(compareNewestFirst)) {
    if (!isIncome(tx) || !inRange(tx.date, range)) continue
    if (filter.categoryId !== undefined && tx.categoryId !== filter.categoryId) continue
    if (filter.accountId !== undefined && tx.accountId !== filter.accountId) continue
    const category = tx.categoryId ? categories.get(tx.categoryId) : undefined
    const accountName = accounts.get(tx.accountId)?.name
    const title = describeTransaction(tx, { categoryName: category?.name })
    // Search: description, category and account names (never attachment contents).
    if (query && !matchesSearch(normalizeSearch([title, tx.description, tx.payee, tx.note, category?.name, accountName].filter(Boolean).join(' ')), query)) continue
    matches.push({
      id: tx.id,
      type: tx.type,
      title,
      amount: tx.amountSatang,
      date: tx.date,
      categoryLabel: category?.name,
      categoryIcon: category?.icon,
      accountLabel: accountName,
      hasAttachment: raw.transactionIdsWithAttachments.has(tx.id),
    })
  }
  const shown = matches.slice(0, limit)
  const anyIncome = raw.transactions.some(isIncome)

  // Filter choices: live income categories, plus archived ones still used by income records.
  const usedCategoryIds = new Set(raw.transactions.filter(isIncome).map((tx) => tx.categoryId))
  const incomeCategories = raw.categories
    .filter((c): c is Category => c.kind === 'income' && (!c.archivedAt || usedCategoryIds.has(c.id)))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
  const usedAccountIds = new Set(raw.transactions.filter(isIncome).map((tx) => tx.accountId))
  const accountChoices = raw.accounts.filter((a) => !a.archivedAt || usedAccountIds.has(a.id))

  return {
    range,
    rangeReversed: reversed,
    summary: incomePeriodTotal(raw.transactions, range, filter),
    groups: groupByDate(shown).map((group) => ({ date: group.date, label: formatDate(group.date, 'long'), rows: group.items })),
    matchCount: matches.length,
    shownCount: shown.length,
    emptyReason: !anyIncome ? 'no_data' : matches.length === 0 ? 'no_match' : null,
    categoryOptions: [{ value: ALL, label: t('income.filter.all') }, ...incomeCategories.map((c) => ({ value: c.id, label: `${c.icon ? `${c.icon} ` : ''}${c.name}` }))],
    accountOptions: [{ value: ALL, label: t('income.filter.all') }, ...accountChoices.map((a) => ({ value: a.id, label: a.name }))],
    rules: buildIncomeRules(raw, today),
  }
}

/** Active (and paused) recurring income rules with their next occurrence. Deleted rules are hidden. */
export function buildIncomeRules(raw: Pick<IncomeRawData, 'obligations' | 'payments' | 'categories' | 'accounts'>, today: ISODate): IncomeRuleRow[] {
  const categories = new Map(raw.categories.map((c) => [c.id, c]))
  const accounts = new Map(raw.accounts.map((a) => [a.id, a.name]))
  return raw.obligations
    .filter((o) => isIncomeObligation(o) && !o.archivedAt)
    .map((rule): IncomeRuleRow => {
      const status = obligationStatus(
        raw.payments.filter((p) => p.sourceId === rule.id),
        today,
      )
      const category = rule.categoryId ? categories.get(rule.categoryId) : undefined
      const paused = Boolean(rule.pausedAt)
      const described = status.current ? describePayment(status.current, today, true) : undefined
      return {
        id: rule.id,
        name: rule.name,
        icon: category?.icon,
        amount: rule.expectedAmountSatang,
        categoryLabel: category?.name,
        accountLabel: rule.defaultAccountId ? accounts.get(rule.defaultAccountId) : undefined,
        paused,
        current: status.current,
        dueText: status.current ? t('income.recurring.next', { date: formatDate(status.current.dueDate) }) : t('income.recurring.noUpcoming'),
        status:
          paused && described?.kind !== 'overdue'
            ? { kind: 'paused', label: t('income.recurring.paused') }
            : described
              ? { kind: described.kind, label: described.label }
              : { kind: 'paid', label: t('income.status.received') },
      }
    })
    .sort((a, b) => (a.current?.dueDate ?? '9999').localeCompare(b.current?.dueDate ?? '9999') || a.name.localeCompare(b.name))
}
