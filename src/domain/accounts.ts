/**
 * Accounts and transfers. Pure.
 *
 * Balances are always DERIVED (never stored): opening balance at its opening
 * date + the account effects of transactions dated on/after it
 * (see accountEffects). Liabilities are negative (−8,000 = 8,000 owed).
 * The opening balance is the account's starting state — never a transaction,
 * never income or expense.
 *
 * Transfers move money between two ASSET accounts only. Money into or out of a
 * credit card goes through its own rules (a purchase is an expense on the card,
 * paying it is a debt payment), so a generic transfer can never bypass them.
 */
import type { Account, AccountKind, ID, ISODate, Transaction } from './entities'
import { accountBalanceAsOf } from './debts'
import { add, negate, sum, ZERO, type Satang } from './money'
import { isValidDate } from './recurrence'
import { availableMoney, LIQUID_ACCOUNT_KINDS, type AvailableMoney } from './reporting'
import { accountClassOf, accountEffects, type AccountEffect } from './transactions'

/** Kinds the account form offers ('loan' is tracked as a Debt, not created as an account). */
export const CREATABLE_ACCOUNT_KINDS: readonly AccountKind[] = ['cash', 'bank', 'savings', 'e_wallet', 'credit_card', 'investment', 'other']

/** Usable for NEW transactions, transfers and recurring rules. Archived accounts only keep their history. */
export const isAccountSelectable = (account: Pick<Account, 'archivedAt'>) => !account.archivedAt

/** An account exists (for reporting) from its opening date on. */
export const isAccountActiveAtDate = (account: Pick<Account, 'openingDate'>, date: ISODate) => account.openingDate <= date

export const isLiquid = (account: Pick<Account, 'kind'>) => LIQUID_ACCOUNT_KINDS.has(account.kind)

// ---------------------------------------------------------------------------
// Balances (derived)
// ---------------------------------------------------------------------------

/** Balance as of a date (default: all history). Before the opening date the account did not exist: null. */
export function calculateAccountBalance(account: Account, transactions: readonly Transaction[], asOf?: ISODate): Satang | null {
  if (asOf !== undefined && !isAccountActiveAtDate(account, asOf)) return null
  return accountBalanceAsOf(account, transactions, asOf)
}

/**
 * "เงินที่มีอยู่" as of a date — the Dashboard's definition (cash, bank,
 * savings, e-wallet; not investment, credit cards, loans or archived accounts),
 * leaving out accounts not yet opened on that date.
 */
export function calculateAvailableMoney(accounts: readonly Account[], transactions: readonly Transaction[], asOf?: ISODate): AvailableMoney {
  const balances = new Map(accounts.map((a) => [a.id, calculateAccountBalance(a, transactions, asOf) ?? ZERO]))
  return availableMoney(accounts, balances, asOf)
}

/** What is owed on active credit cards (positive), from the same card-account balances debts use. */
export function creditCardOwed(accounts: readonly Account[], transactions: readonly Transaction[]): Satang {
  return sum(
    accounts
      .filter((a) => isAccountSelectable(a) && a.kind === 'credit_card')
      .map((a) => {
        const balance = calculateAccountBalance(a, transactions) ?? ZERO
        return balance < 0 ? negate(balance) : ZERO
      }),
  )
}

// ---------------------------------------------------------------------------
// Per-account activity
// ---------------------------------------------------------------------------

export interface AccountActivity {
  /** Income received into the account. */
  incomeIn: Satang
  /** Expenses paid from the account (on a credit card: purchases charged to it). */
  expensesOut: Satang
  transfersIn: Satang
  transfersOut: Satang
  /** Debt payments made FROM this account. */
  debtPaymentsOut: Satang
  /** Debt payments received BY this account (a credit card being paid off). */
  debtPaymentsIn: Satang
  adjustments: Satang
  count: number
}

/** Totals of transactions touching one account (counted from its opening date, like its balance). */
export function accountActivity(account: Pick<Account, 'id' | 'openingDate'>, transactions: readonly Transaction[]): AccountActivity {
  const a: AccountActivity = { incomeIn: ZERO, expensesOut: ZERO, transfersIn: ZERO, transfersOut: ZERO, debtPaymentsOut: ZERO, debtPaymentsIn: ZERO, adjustments: ZERO, count: 0 }
  for (const tx of transactions) {
    if (tx.date < account.openingDate) continue
    const from = tx.accountId === account.id
    const to = tx.toAccountId === account.id
    if (!from && !to) continue
    a.count += 1
    switch (tx.type) {
      case 'income':
        a.incomeIn = add(a.incomeIn, tx.amountSatang)
        break
      case 'expense':
        a.expensesOut = add(a.expensesOut, tx.amountSatang)
        break
      case 'transfer':
        if (from) a.transfersOut = add(a.transfersOut, tx.amountSatang)
        if (to) a.transfersIn = add(a.transfersIn, tx.amountSatang)
        break
      case 'debt_payment':
        if (from) a.debtPaymentsOut = add(a.debtPaymentsOut, tx.amountSatang)
        if (to) a.debtPaymentsIn = add(a.debtPaymentsIn, tx.amountSatang)
        break
      case 'adjustment':
        a.adjustments = add(a.adjustments, tx.amountSatang)
        break
    }
  }
  return a
}

/** Every transaction touching the account, newest first. */
export function transactionsForAccount(accountId: ID, transactions: readonly Transaction[]): Transaction[] {
  return transactions
    .filter((tx) => tx.accountId === accountId || tx.toAccountId === accountId)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
}

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

export type TransferIssue = 'transfer_liability_not_allowed'

/**
 * Transfer rule beyond the generic transaction checks (source/destination
 * required, different, existing, active, amount > 0): both sides must be asset
 * accounts. Returns [] when allowed.
 */
export function validateTransferAccounts(from: Pick<Account, 'kind'> | undefined, to: Pick<Account, 'kind'> | undefined): TransferIssue[] {
  if ((from && accountClassOf(from.kind) === 'liability') || (to && accountClassOf(to.kind) === 'liability')) return ['transfer_liability_not_allowed']
  return []
}

/** The balance change a transfer causes: −amount on the source, +amount on the destination. Total unchanged. */
export const calculateTransferEffect = (tx: Pick<Transaction, 'amountSatang' | 'accountId' | 'toAccountId'>): AccountEffect[] =>
  accountEffects({ ...tx, type: 'transfer' })

// ---------------------------------------------------------------------------
// Creating and editing accounts
// ---------------------------------------------------------------------------

export interface AccountDraft {
  name: string
  kind: AccountKind
  /**
   * As the user enters it: money held for assets; the amount OWED for a credit
   * card (stored negative). Null = not entered (treated as zero).
   */
  openingAmountSatang: Satang | null
  openingDate: ISODate
  note?: string
}

export type AccountIssue =
  | 'name_required'
  | 'kind_invalid'
  | 'opening_invalid'
  | 'opening_date_invalid'
  | 'kind_change_not_allowed'
  | 'kind_linked_to_debt'
  | 'opening_after_transactions'
  | 'name_taken'

export interface AccountContext {
  /** Other accounts (unique names among active accounts). */
  accounts: readonly Pick<Account, 'id' | 'name' | 'archivedAt'>[]
  /** Transactions touching this account (edits only). */
  transactions: readonly Pick<Transaction, 'date' | 'accountId' | 'toAccountId'>[]
  /** Whether a live debt links this account (a card's liability is that debt). */
  linkedToDebt: boolean
}

const signedOpening = (kind: AccountKind, entered: Satang) => (accountClassOf(kind) === 'liability' ? negate(entered) : entered)

/** Amount shown in the form: owed for liabilities (positive), held for assets. */
export const openingAmountOf = (account: Pick<Account, 'kind' | 'openingBalanceSatang'>): Satang =>
  accountClassOf(account.kind) === 'liability' ? negate(account.openingBalanceSatang) : account.openingBalanceSatang

/**
 * Validate and build the account to store (create or edit). Edits keep id,
 * createdAt, sort order and fields the form does not edit. Rules for edits:
 * - the kind may change only within its class (asset ↔ asset), never for a card
 *   a debt is linked to — the sign of the balance would flip;
 * - the opening date may not move after the account's first transaction
 *   (those transactions would silently drop out of the balance);
 * - a new opening balance is applied as the starting state: every derived
 *   balance moves by the difference (no transaction is created).
 */
export function buildAccount(
  draft: AccountDraft,
  context: AccountContext,
  meta: { id: ID; now: string; sortOrder: number; existing?: Account },
): { ok: true; account: Account } | { ok: false; issues: AccountIssue[] } {
  const issues: AccountIssue[] = []
  const { existing } = meta
  const id = existing?.id ?? meta.id
  const name = draft.name.trim()
  if (!name) issues.push('name_required')
  else if (context.accounts.some((a) => a.id !== id && !a.archivedAt && a.name.trim().toLowerCase() === name.toLowerCase())) issues.push('name_taken')

  const kinds: readonly string[] = [...CREATABLE_ACCOUNT_KINDS, ...(existing ? [existing.kind] : [])]
  if (!kinds.includes(draft.kind)) issues.push('kind_invalid')
  if (draft.openingAmountSatang !== null && (!Number.isSafeInteger(draft.openingAmountSatang) || draft.openingAmountSatang < 0)) issues.push('opening_invalid')
  if (!isValidDate(draft.openingDate)) issues.push('opening_date_invalid')

  if (existing && draft.kind !== existing.kind) {
    if (accountClassOf(draft.kind) !== accountClassOf(existing.kind)) issues.push('kind_change_not_allowed')
    else if (context.linkedToDebt) issues.push('kind_linked_to_debt')
  }
  if (existing && isValidDate(draft.openingDate)) {
    const first = context.transactions.map((tx) => tx.date).sort()[0]
    if (first !== undefined && draft.openingDate > first) issues.push('opening_after_transactions')
  }
  if (issues.length > 0) return { ok: false, issues }

  const account: Account = {
    ...(existing ?? {}),
    id,
    name,
    kind: draft.kind,
    currency: 'THB',
    openingBalanceSatang: signedOpening(draft.kind, draft.openingAmountSatang ?? ZERO),
    openingDate: draft.openingDate,
    sortOrder: existing?.sortOrder ?? meta.sortOrder,
    note: draft.note?.trim() || undefined,
    createdAt: existing?.createdAt ?? meta.now,
    updatedAt: meta.now,
  }
  if (account.note === undefined) delete account.note
  return { ok: true, account }
}
