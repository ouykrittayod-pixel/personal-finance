/**
 * Accounts page data: loader (repositories → raw) and pure view-model
 * builders. Balances and totals come from domain/accounts (derived from
 * transactions; nothing is stored).
 */
import { describeTransaction } from '@/components/finance/describe-transaction'
import { accountsRepository, attachmentsRepository, categoriesRepository, debtsRepository, recurringObligationsRepository, transactionsRepository } from '@/db/repositories'
import {
  accountActivity,
  calculateAccountBalance,
  calculateAvailableMoney,
  creditCardOwed,
  isLiquid,
  transactionsForAccount,
  type AccountActivity,
} from '@/domain/accounts'
import { isDebtActive } from '@/domain/debts'
import type { Account, Category, Debt, ID, RecurringObligation, Transaction } from '@/domain/entities'
import { normalizeSearch, matchesSearch } from '@/domain/ledger'
import { sum, ZERO, type Satang } from '@/domain/money'
import { accountClassOf } from '@/domain/transactions'
import type { LedgerRow } from '@/features/transactions/ledger-data'

/** Transactions listed in an account's detail (newest first). */
export const RECENT_LIMIT = 20

export type AccountFilter = 'all' | 'active' | 'archived'
export const ACCOUNT_FILTERS: readonly AccountFilter[] = ['active', 'archived', 'all']

export interface AccountsRawData {
  accounts: Account[]
  transactions: Transaction[]
  categories: Category[]
  debts: Debt[]
  obligations: RecurringObligation[]
  transactionIdsWithAttachments: Set<ID>
}

export async function loadAccountsData(): Promise<AccountsRawData> {
  const [accounts, transactions, categories, debts, obligations, transactionIdsWithAttachments] = await Promise.all([
    accountsRepository.listAll(),
    transactionsRepository.listAll(),
    categoriesRepository.listAll(),
    debtsRepository.listAll(),
    recurringObligationsRepository.listAll(),
    // Index keys only — no attachment blobs.
    attachmentsRepository.allTransactionIdsWithAttachments(),
  ])
  return { accounts, transactions, categories, debts, obligations, transactionIdsWithAttachments }
}

export interface AccountRow {
  id: ID
  name: string
  kind: Account['kind']
  archived: boolean
  liability: boolean
  /** Derived current balance (liabilities negative). */
  balance: Satang
}

export interface AccountsModel {
  summary: {
    available: Satang
    availableCount: number
    activeCount: number
    totalCount: number
    /** Owed on active credit cards (from their accounts). */
    cardOwed: Satang
    hasCards: boolean
    /** Active investment accounts, shown apart from available money. */
    investment: Satang
    hasInvestments: boolean
  }
  rows: AccountRow[]
  emptyReason: 'no_data' | 'no_match' | null
}

export function buildAccountsModel(raw: AccountsRawData, filters: { filter: AccountFilter; search: string }): AccountsModel {
  const available = calculateAvailableMoney(raw.accounts, raw.transactions)
  const active = raw.accounts.filter((a) => !a.archivedAt)
  const investments = active.filter((a) => a.kind === 'investment')
  const query = normalizeSearch(filters.search)

  const rows = raw.accounts
    .filter((a) => (filters.filter === 'all' ? true : filters.filter === 'active' ? !a.archivedAt : Boolean(a.archivedAt)))
    .filter((a) => !query || matchesSearch(normalizeSearch(a.name), query))
    .map(
      (a): AccountRow => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        archived: Boolean(a.archivedAt),
        liability: accountClassOf(a.kind) === 'liability',
        balance: calculateAccountBalance(a, raw.transactions) ?? ZERO,
      }),
    )

  return {
    summary: {
      available: available.total,
      availableCount: available.accountCount,
      activeCount: active.length,
      totalCount: raw.accounts.length,
      cardOwed: creditCardOwed(raw.accounts, raw.transactions),
      hasCards: active.some((a) => a.kind === 'credit_card'),
      investment: sum(investments.map((a) => calculateAccountBalance(a, raw.transactions) ?? ZERO)),
      hasInvestments: investments.length > 0,
    },
    rows,
    emptyReason: raw.accounts.length === 0 ? 'no_data' : rows.length === 0 ? 'no_match' : null,
  }
}

export interface AccountDetail {
  account: Account
  balance: Satang
  liability: boolean
  /** Counted in "เงินที่มีอยู่" (active cash/bank/savings/e-wallet). */
  inAvailable: boolean
  activity: AccountActivity
  recent: LedgerRow[]
  totalTransactions: number
  /** A live debt tracks this card (archiving must wait for the debt). */
  linkedDebt?: Debt
  /** Active recurring rules that use this account by default. */
  ruleCount: number
}

export function buildAccountDetail(raw: AccountsRawData, id: ID): AccountDetail | null {
  const account = raw.accounts.find((a) => a.id === id)
  if (!account) return null
  const categories = new Map(raw.categories.map((c) => [c.id, c]))
  const names = new Map(raw.accounts.map((a) => [a.id, a.name]))
  const debts = new Map(raw.debts.map((d) => [d.id, d.name]))
  const history = transactionsForAccount(id, raw.transactions)
  return {
    account,
    balance: calculateAccountBalance(account, raw.transactions) ?? ZERO,
    liability: accountClassOf(account.kind) === 'liability',
    inAvailable: !account.archivedAt && isLiquid(account),
    activity: accountActivity(account, raw.transactions),
    recent: history.slice(0, RECENT_LIMIT).map((tx) => {
      const category = tx.categoryId ? categories.get(tx.categoryId) : undefined
      return {
        id: tx.id,
        type: tx.type,
        title: describeTransaction(tx, { categoryName: category?.name, debtName: tx.debtId ? debts.get(tx.debtId) : undefined, toAccountName: tx.toAccountId ? names.get(tx.toAccountId) : undefined }),
        amount: tx.amountSatang,
        date: tx.date,
        categoryLabel: category?.name,
        categoryIcon: category?.icon,
        accountLabel: names.get(tx.accountId),
        toAccountLabel: tx.toAccountId ? names.get(tx.toAccountId) : undefined,
        hasAttachment: raw.transactionIdsWithAttachments.has(tx.id),
      }
    }),
    totalTransactions: history.length,
    linkedDebt: raw.debts.find((d) => d.linkedAccountId === id && isDebtActive(d)),
    ruleCount: raw.obligations.filter((o) => o.defaultAccountId === id && !o.archivedAt).length,
  }
}
