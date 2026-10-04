/**
 * Transaction model rules.
 *
 * One unified Transaction entity with distinct types:
 *
 * | type         | accountId          | toAccountId                  | counts as spending? |
 * |--------------|--------------------|------------------------------|---------------------|
 * | expense      | −amount            | —                            | yes                 |
 * | income       | +amount            | —                            | no (income)         |
 * | transfer     | −amount            | +amount (required)           | no                  |
 * | debt_payment | −amount            | +amount (liability, if any)  | NO                  |
 * | adjustment   | ±amount (signed)   | —                            | no                  |
 *
 * Example — credit card:
 * 1. Buy groceries ฿500 on the card → `expense` from the card account.
 *    Card balance −500 (liability grows). Spending +500.
 * 2. Pay the card ฿500 from the bank → `debt_payment` bank → card.
 *    Bank −500, card +500 (liability shrinks). Spending unchanged — the
 *    expense was already recorded at purchase time and must not be counted twice.
 *
 * Detailed transaction features are built later; this module fixes the invariants.
 */
import type { Account, AccountClass, AccountKind, DebtKind, ID, ISODate, Transaction, TransactionType } from './entities'
import { LIABILITY_ACCOUNT_KINDS } from './entities'
import { negate, sum as sumMoney, type Satang } from './money'

export function accountClassOf(kind: AccountKind): AccountClass {
  return (LIABILITY_ACCOUNT_KINDS as readonly string[]).includes(kind) ? 'liability' : 'asset'
}

export interface AccountEffect {
  accountId: ID
  deltaSatang: Satang
}

/** How a transaction changes account balances (see sign convention in entities.ts). */
export function accountEffects(tx: Pick<Transaction, 'type' | 'amountSatang' | 'accountId' | 'toAccountId'>): AccountEffect[] {
  switch (tx.type) {
    case 'expense':
      return [{ accountId: tx.accountId, deltaSatang: negate(tx.amountSatang) }]
    case 'income':
    case 'adjustment':
      return [{ accountId: tx.accountId, deltaSatang: tx.amountSatang }]
    case 'transfer':
    case 'debt_payment': {
      const effects: AccountEffect[] = [{ accountId: tx.accountId, deltaSatang: negate(tx.amountSatang) }]
      if (tx.toAccountId) effects.push({ accountId: tx.toAccountId, deltaSatang: tx.amountSatang })
      return effects
    }
  }
}

/** Only `expense` transactions count toward spending, budgets and expense analytics. */
export function countsAsSpending(tx: Pick<Transaction, 'type'>): boolean {
  return tx.type === 'expense'
}

export type TransactionIssue =
  | 'amount_not_integer'
  | 'amount_must_be_positive'
  | 'adjustment_must_be_non_zero'
  | 'unknown_account'
  | 'unknown_to_account'
  | 'transfer_requires_to_account'
  | 'same_account'
  | 'to_account_not_allowed'
  | 'debt_payment_requires_debt'
  | 'debt_payment_to_account_must_be_liability'
  | 'debt_payment_from_liability'
  | 'category_not_allowed'
  | 'debt_not_allowed'
  | 'breakdown_exceeds_amount'

const TYPES_WITH_CATEGORY: ReadonlySet<TransactionType> = new Set(['expense', 'income'])

/**
 * Check a transaction against the model's invariants.
 * `accounts` is used to verify referenced accounts exist and have the right class.
 */
export function validateTransaction(
  tx: Pick<
    Transaction,
    'type' | 'amountSatang' | 'accountId' | 'toAccountId' | 'categoryId' | 'debtId' | 'interestSatang' | 'feeSatang'
  >,
  accounts: ReadonlyMap<ID, Pick<Account, 'kind'>>,
): TransactionIssue[] {
  const issues: TransactionIssue[] = []

  if (!Number.isSafeInteger(tx.amountSatang)) {
    issues.push('amount_not_integer')
  } else if (tx.type === 'adjustment') {
    if (tx.amountSatang === 0) issues.push('adjustment_must_be_non_zero')
  } else if (tx.amountSatang <= 0) {
    issues.push('amount_must_be_positive')
  }

  const from = accounts.get(tx.accountId)
  if (!from) issues.push('unknown_account')
  const to = tx.toAccountId === undefined ? undefined : accounts.get(tx.toAccountId)
  if (tx.toAccountId !== undefined && !to) issues.push('unknown_to_account')

  if (tx.toAccountId !== undefined && tx.toAccountId === tx.accountId) issues.push('same_account')
  if (tx.toAccountId !== undefined && tx.type !== 'transfer' && tx.type !== 'debt_payment') {
    issues.push('to_account_not_allowed')
  }
  if (tx.categoryId !== undefined && !TYPES_WITH_CATEGORY.has(tx.type)) issues.push('category_not_allowed')
  if (tx.debtId !== undefined && tx.type !== 'debt_payment') issues.push('debt_not_allowed')

  if (tx.type === 'transfer' && tx.toAccountId === undefined) issues.push('transfer_requires_to_account')

  if (tx.type === 'debt_payment') {
    if (tx.debtId === undefined) issues.push('debt_payment_requires_debt')
    if (from && accountClassOf(from.kind) === 'liability') issues.push('debt_payment_from_liability')
    if (to && accountClassOf(to.kind) !== 'liability') issues.push('debt_payment_to_account_must_be_liability')
    const breakdown = (tx.interestSatang ?? 0) + (tx.feeSatang ?? 0)
    if (breakdown > tx.amountSatang) issues.push('breakdown_exceeds_amount')
  }

  return issues
}

// ---------------------------------------------------------------------------
// Creating and editing transactions
// ---------------------------------------------------------------------------

/** Transaction types the forms can create or edit (adjustments are system-level). */
export const EDITABLE_TYPES = ['expense', 'income', 'debt_payment', 'transfer'] as const
export type EditableType = (typeof EDITABLE_TYPES)[number]

/** What a transaction form collects. Money is already integer satang (null = not entered / unparsable). */
export interface TransactionDraft {
  type: EditableType
  amountSatang: Satang | null
  accountId: ID | undefined
  date: string
  /** expense (required) / income (optional). */
  categoryId?: ID
  /** transfer (required). debt_payment: set from the debt's linked liability account. */
  toAccountId?: ID
  /** debt_payment (required). */
  debtId?: ID
  /**
   * debt_payment to a loan: 'split' (default) requires principal, interest and
   * fees with principal + interest + fees = amount; 'unallocated' stores no
   * split and never reduces principal. Card payments take no split.
   */
  allocation?: 'split' | 'unallocated'
  principalSatang?: Satang | null
  interestSatang?: Satang | null
  feeSatang?: Satang | null
  description?: string
  note?: string
  /** Set when paying a scheduled payment (the bridge from obligation to transaction). */
  scheduledPaymentId?: ID
}

/** Quick Expense's draft: an expense without the explicit type. */
export type ExpenseDraft = Omit<TransactionDraft, 'type' | 'toAccountId' | 'debtId' | 'allocation' | 'principalSatang' | 'interestSatang' | 'feeSatang'> & {
  categoryId: ID | undefined
}

export type DraftIssue =
  | 'amount_required'
  | 'amount_must_be_positive'
  | 'amount_not_integer'
  | 'category_required'
  | 'category_not_expense'
  | 'category_not_income'
  | 'account_required'
  | 'to_account_required'
  | 'debt_required'
  | 'breakdown_invalid'
  | 'breakdown_not_allowed'
  | 'allocation_required'
  | 'allocation_mismatch'
  | 'payment_before_opening'
  | 'principal_exceeds_outstanding'
  | 'transfer_liability_not_allowed'
  | 'date_invalid'
  | 'type_change_not_allowed'
  | TransactionIssue

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** A real calendar date in "YYYY-MM-DD" form (e.g. rejects 2026-02-30). */
export function isCalendarDate(value: string): boolean {
  const match = ISO_DATE.exec(value)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

const clean = (value: string | undefined) => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export interface DraftContext {
  accounts: ReadonlyMap<ID, Pick<Account, 'kind'>>
  categories: ReadonlyMap<ID, { kind: 'expense' | 'income' }>
  /** Needed for debt payments: the debt must exist (its kind decides the balance model). */
  debts?: ReadonlyMap<ID, { kind: DebtKind; linkedAccountId?: ID; openingDate: ISODate }>
}

export interface BuildMeta {
  id: ID
  now: string
  /**
   * When editing: the stored transaction. Its id, type, creation time and
   * fields the form does not edit (payee, tags, scheduled payment, debt) are kept.
   */
  existing?: Transaction
}

export type BuildResult = { ok: true; transaction: Transaction } | { ok: false; issues: DraftIssue[] }

function checkOptionalMoney(value: Satang | null | undefined): boolean {
  return value === undefined || (value !== null && Number.isSafeInteger(value) && value >= 0)
}

/**
 * Validate a draft and build the Transaction to store — for both create and
 * edit, so every write goes through the same rules (including
 * validateTransaction: e.g. a debt payment can never be categorised as an expense).
 * Returns issues instead of throwing so forms can show them.
 */
export function buildTransaction(draft: TransactionDraft, context: DraftContext, meta: BuildMeta): BuildResult {
  const issues: DraftIssue[] = []
  const { existing } = meta

  if (existing && existing.type !== draft.type) issues.push('type_change_not_allowed')

  if (draft.amountSatang === null) issues.push('amount_required')
  else if (!Number.isSafeInteger(draft.amountSatang)) issues.push('amount_not_integer')
  else if (draft.amountSatang <= 0) issues.push('amount_must_be_positive')

  if (!draft.accountId) issues.push('account_required')
  if (!isCalendarDate(draft.date)) issues.push('date_invalid')

  let categoryId: ID | undefined
  let toAccountId: ID | undefined
  let debtId: ID | undefined
  let principalSatang: Satang | undefined
  let interestSatang: Satang | undefined
  let feeSatang: Satang | undefined

  switch (draft.type) {
    case 'expense':
      if (!draft.categoryId) issues.push('category_required')
      else if (context.categories.get(draft.categoryId)?.kind !== 'expense') issues.push('category_not_expense')
      categoryId = draft.categoryId
      break
    case 'income':
      if (!draft.categoryId) issues.push('category_required')
      else if (context.categories.get(draft.categoryId)?.kind !== 'income') issues.push('category_not_income')
      categoryId = draft.categoryId || undefined
      break
    case 'transfer': {
      if (!draft.toAccountId) issues.push('to_account_required')
      toAccountId = draft.toAccountId
      // Money into/out of a credit card is a purchase (expense) or a card payment (debt_payment), never a transfer.
      const ends = [draft.accountId, draft.toAccountId].map((id) => (id ? context.accounts.get(id) : undefined))
      if (ends.some((account) => account && accountClassOf(account.kind) === 'liability')) issues.push('transfer_liability_not_allowed')
      break
    }
    case 'debt_payment': {
      debtId = draft.debtId ?? existing?.debtId
      const debt = debtId ? context.debts?.get(debtId) : undefined
      if (!debtId || !debt) {
        issues.push('debt_required')
        break
      }
      const given = [draft.principalSatang, draft.interestSatang, draft.feeSatang].filter((v) => v !== undefined && v !== null)
      if (debt.kind === 'credit_card') {
        // The card account holds the liability: the payment moves money into it, with no split.
        toAccountId = debt.linkedAccountId
        if (given.length > 0) issues.push('breakdown_not_allowed')
        break
      }
      // Loans: money leaves the paying account; principal comes only from an explicit split.
      if (isCalendarDate(draft.date) && draft.date < debt.openingDate) issues.push('payment_before_opening')
      if (draft.allocation === 'unallocated') break
      const parts = [draft.principalSatang, draft.interestSatang, draft.feeSatang]
      if (parts.some((v) => v === undefined || v === null)) issues.push('allocation_required')
      else if (!parts.every((v) => checkOptionalMoney(v))) issues.push('breakdown_invalid')
      else if (draft.amountSatang !== null && sumMoney(parts as Satang[]) !== draft.amountSatang) issues.push('allocation_mismatch')
      principalSatang = draft.principalSatang ?? undefined
      interestSatang = draft.interestSatang ?? undefined
      feeSatang = draft.feeSatang ?? undefined
      break
    }
  }

  if (issues.length > 0) return { ok: false, issues }

  const transaction: Transaction = {
    // Fields the forms don't edit survive an edit untouched.
    ...(existing ? { payee: existing.payee, tags: existing.tags, scheduledPaymentId: existing.scheduledPaymentId } : {}),
    ...(!existing && draft.scheduledPaymentId ? { scheduledPaymentId: draft.scheduledPaymentId } : {}),
    id: existing?.id ?? meta.id,
    type: draft.type,
    date: draft.date,
    amountSatang: draft.amountSatang!,
    accountId: draft.accountId!,
    toAccountId,
    categoryId,
    debtId,
    principalSatang,
    interestSatang,
    feeSatang,
    description: clean(draft.description),
    note: clean(draft.note),
    createdAt: existing?.createdAt ?? meta.now,
    updatedAt: meta.now,
  }
  // Drop undefined optionals so IndexedDB records stay clean.
  for (const key of Object.keys(transaction) as (keyof Transaction)[]) {
    if (transaction[key] === undefined) delete transaction[key]
  }

  const modelIssues = validateTransaction(transaction, context.accounts)
  if (modelIssues.length > 0) return { ok: false, issues: modelIssues }
  return { ok: true, transaction }
}

/** Create an `expense` from the Quick Expense draft. */
export function buildExpense(draft: ExpenseDraft, context: DraftContext, meta: { id: ID; now: string }): BuildResult {
  return buildTransaction({ ...draft, type: 'expense' }, context, meta)
}
