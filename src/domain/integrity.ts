/**
 * Read-only database integrity audit.
 *
 * Pure: takes a snapshot of every table (attachment binaries only as id/size/
 * type) and reports problems. It never changes data and never repairs
 * anything. Every rule here is an existing domain rule — the audit reuses the
 * domain functions (validateTransaction, validateRecurrence, balances, debt
 * positions) and only cross-checks them; it defines no second calculation.
 *
 * Severity:
 * - error: the data breaks a rule the app relies on (would show wrong numbers or break a screen).
 * - info:  allowed by the model but worth knowing when checking real data
 *          (e.g. a card in credit, a transaction before its account's opening date).
 */
import { accountBalanceAsOf, debtPosition, isRevolving, loanPosition, validateLoanTimeline } from './debts'
import { calculateAccountBalance } from './accounts'
import { OVERALL_BUDGET } from './budget'
import type { Account, Attachment, Budget, Category, Debt, ID, MetaEntry, RecurringObligation, ScheduledPayment, Transaction } from './entities'
import { ACCOUNT_KINDS, DEBT_KINDS, TRANSACTION_TYPES } from './entities'
import type { Satang } from './money'
import { validateRecurrence } from './recurrence'
import { accountBalances } from './reporting'
import { paymentTypeFor } from './scheduling'
import { accountClassOf, accountEffects, isCalendarDate, validateTransaction } from './transactions'

export interface BlobInfo {
  id: ID
  size: number
  type: string
}

export interface IntegritySnapshot {
  accounts: Account[]
  categories: Category[]
  transactions: Transaction[]
  recurringObligations: RecurringObligation[]
  scheduledPayments: ScheduledPayment[]
  debts: Debt[]
  budgets: Budget[]
  attachments: Attachment[]
  blobs: BlobInfo[]
  meta: MetaEntry[]
}

export const INTEGRITY_CATEGORIES = [
  'orphan',
  'duplicate_id',
  'duplicate_key',
  'money',
  'date',
  'transaction',
  'account',
  'debt',
  'card',
  'recurring',
  'scheduled',
  'budget',
  'attachment',
] as const
export type IntegrityCategory = (typeof INTEGRITY_CATEGORIES)[number]

export interface IntegrityIssue {
  category: IntegrityCategory
  severity: 'error' | 'info'
  table: string
  id: ID
  /** Machine-readable reason, e.g. "account_missing". Never contains record contents. */
  code: string
}

export type CheckResult = 'PASS' | 'FAIL'

export interface IntegrityReport {
  counts: Record<'accounts' | 'categories' | 'transactions' | 'recurring' | 'scheduled' | 'debts' | 'budgets' | 'attachments' | 'blobs', number>
  issues: IntegrityIssue[]
  errors: Record<IntegrityCategory, number>
  info: number
  checks: {
    accountReconciliation: CheckResult
    debtReconciliation: CheckResult
    creditCards: CheckResult
    recurring: CheckResult
    scheduledPayments: CheckResult
    budgetIntegrity: CheckResult
    attachmentIntegrity: CheckResult
  }
  ok: boolean
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/
const isTimestamp = (value: unknown) => typeof value === 'string' && TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value))
const isMoney = (value: unknown): value is Satang => typeof value === 'number' && Number.isSafeInteger(value)
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

export function auditIntegrity(s: IntegritySnapshot): IntegrityReport {
  const issues: IntegrityIssue[] = []
  /** Derived calculations reject invalid money by throwing; the audit reports that instead of stopping. */
  const attempt = (run: () => void, onFail: () => void) => {
    try {
      run()
    } catch {
      onFail()
    }
  }
  const report = (category: IntegrityCategory, table: string, id: ID, code: string, severity: 'error' | 'info' = 'error') =>
    issues.push({ category, severity, table, id: String(id), code })

  // --- Duplicate primary IDs (impossible in IndexedDB, possible in a file) ---
  const index = <T extends { id: ID }>(table: string, rows: readonly T[]) => {
    const map = new Map<ID, T>()
    for (const row of rows) {
      if (map.has(row.id)) report('duplicate_id', table, row.id, 'duplicate_id')
      map.set(row.id, row)
    }
    return map
  }
  const accounts = index('accounts', s.accounts)
  const categories = index('categories', s.categories)
  const transactions = index('transactions', s.transactions)
  const obligations = index('recurringObligations', s.recurringObligations)
  const payments = index('scheduledPayments', s.scheduledPayments)
  const debts = index('debts', s.debts)
  index('budgets', s.budgets)
  const attachments = index('attachments', s.attachments)
  const blobs = index('attachmentBlobs', s.blobs)

  // --- Money & dates on every stored field ---
  const money = (table: string, id: ID, field: string, value: unknown, optional = false) => {
    if (value === undefined && optional) return
    if (!isMoney(value)) report('money', table, id, `${field}_not_integer`)
  }
  const date = (table: string, id: ID, field: string, value: unknown, optional = false) => {
    if (value === undefined && optional) return
    if (typeof value !== 'string' || !isCalendarDate(value)) report('date', table, id, `${field}_invalid`)
  }
  const stamps = (table: string, row: { id: ID; createdAt?: unknown; updatedAt?: unknown }, withUpdated = true) => {
    if (!isTimestamp(row.createdAt)) report('date', table, row.id, 'createdAt_invalid')
    if (withUpdated && !isTimestamp(row.updatedAt)) report('date', table, row.id, 'updatedAt_invalid')
  }

  for (const a of s.accounts) {
    if (!ACCOUNT_KINDS.includes(a.kind)) report('account', 'accounts', a.id, 'kind_invalid')
    money('accounts', a.id, 'openingBalance', a.openingBalanceSatang)
    money('accounts', a.id, 'creditLimit', a.creditLimitSatang, true)
    date('accounts', a.id, 'openingDate', a.openingDate)
    stamps('accounts', a)
  }
  for (const c of s.categories) {
    if (c.kind !== 'expense' && c.kind !== 'income') report('transaction', 'categories', c.id, 'category_kind_invalid')
    if (c.parentId !== undefined && !categories.has(c.parentId)) report('orphan', 'categories', c.id, 'parent_missing')
    stamps('categories', c)
  }

  // --- Transactions: references, type rules (validateTransaction), categories, money, dates ---
  const accountKinds = new Map(s.accounts.map((a) => [a.id, a]))
  for (const tx of s.transactions) {
    const t = 'transactions'
    if (!TRANSACTION_TYPES.includes(tx.type)) {
      report('transaction', t, tx.id, 'type_invalid')
      continue
    }
    money(t, tx.id, 'amount', tx.amountSatang)
    for (const field of ['principalSatang', 'interestSatang', 'feeSatang'] as const) {
      money(t, tx.id, field, tx[field], true)
      if (isMoney(tx[field]) && (tx[field] as number) < 0) report('money', t, tx.id, `${field}_negative`)
    }
    date(t, tx.id, 'date', tx.date)
    stamps(t, tx)

    if (!accounts.has(tx.accountId)) report('orphan', t, tx.id, 'account_missing')
    if (tx.toAccountId !== undefined && !accounts.has(tx.toAccountId)) report('orphan', t, tx.id, 'to_account_missing')
    if (tx.categoryId !== undefined && !categories.has(tx.categoryId)) report('orphan', t, tx.id, 'category_missing')
    if (tx.debtId !== undefined && !debts.has(tx.debtId)) report('orphan', t, tx.id, 'debt_missing')
    if (tx.scheduledPaymentId !== undefined && !payments.has(tx.scheduledPaymentId)) report('orphan', t, tx.id, 'scheduled_payment_missing')

    // The model's own invariants (unknown accounts are reported above as orphans).
    for (const issue of validateTransaction(tx, accountKinds)) {
      if (issue === 'unknown_account' || issue === 'unknown_to_account') continue
      report(issue === 'amount_not_integer' ? 'money' : 'transaction', t, tx.id, issue)
    }
    const category = tx.categoryId ? categories.get(tx.categoryId) : undefined
    if (tx.type === 'expense') {
      if (tx.categoryId === undefined) report('transaction', t, tx.id, 'expense_without_category')
      else if (category && category.kind !== 'expense') report('transaction', t, tx.id, 'category_not_expense')
    }
    if (tx.type === 'income' && category && category.kind !== 'income') report('transaction', t, tx.id, 'category_not_income')
    if (tx.type === 'transfer') {
      const ends = [tx.accountId, tx.toAccountId].map((id) => (id ? accounts.get(id) : undefined))
      if (ends.some((a) => a && accountClassOf(a.kind) === 'liability')) report('transaction', t, tx.id, 'transfer_liability_not_allowed')
    }
    if (tx.type === 'debt_payment' && tx.principalSatang !== undefined) {
      const parts = [tx.principalSatang, tx.interestSatang ?? 0, tx.feeSatang ?? 0]
      if (parts.every(isMoney) && parts.reduce((a, b) => a + b, 0) !== tx.amountSatang) report('money', t, tx.id, 'allocation_mismatch')
    }
    // Allowed by the model (the opening balance already includes earlier history) — listed for review.
    const from = accounts.get(tx.accountId)
    if (from && isCalendarDate(tx.date) && tx.date < from.openingDate) report('account', t, tx.id, 'before_account_opening', 'info')
  }

  // --- Account reconciliation: the two existing balance functions must agree with the ledger ---
  let ledger: Map<ID, Satang> | null = null
  attempt(
    () => (ledger = accountBalances(s.accounts, s.transactions)),
    () => report('account', 'accounts', '*', 'balances_uncomputable'),
  )
  for (const account of s.accounts) {
    attempt(
      () => {
        let expected: number = account.openingBalanceSatang
        for (const tx of s.transactions) {
          if (tx.date < account.openingDate) continue
          for (const effect of accountEffects(tx)) if (effect.accountId === account.id) expected += effect.deltaSatang
        }
        const single = calculateAccountBalance(account, s.transactions)
        if (!isMoney(expected) || (ledger as Map<ID, Satang> | null)?.get(account.id) !== expected || single !== expected) {
          report('account', 'accounts', account.id, 'balance_mismatch')
        }
      },
      () => report('account', 'accounts', account.id, 'balance_uncomputable'),
    )
  }

  // --- Debts & credit cards ---
  const cardOwners = new Map<ID, ID[]>()
  for (const debt of s.debts) {
    const t = 'debts'
    if (!DEBT_KINDS.includes(debt.kind)) report('debt', t, debt.id, 'kind_invalid')
    money(t, debt.id, 'openingBalance', debt.openingBalanceSatang)
    money(t, debt.id, 'principal', debt.principalSatang, true)
    money(t, debt.id, 'installment', debt.installmentSatang, true)
    date(t, debt.id, 'openingDate', debt.openingDate)
    date(t, debt.id, 'startDate', debt.startDate, true)
    date(t, debt.id, 'maturityDate', debt.maturityDate, true)
    stamps(t, debt)
    for (const adj of debt.principalAdjustments ?? []) {
      money(t, debt.id, 'adjustment', adj.amountSatang)
      date(t, debt.id, 'adjustment_date', adj.date)
    }
    for (const st of debt.statements ?? []) {
      money(t, debt.id, 'statement_balance', st.balanceSatang)
      money(t, debt.id, 'statement_minimum', st.minimumDueSatang, true)
      date(t, debt.id, 'statement_date', st.statementDate)
      date(t, debt.id, 'statement_due', st.dueDate)
    }

    if (isRevolving(debt)) {
      const account = debt.linkedAccountId ? accounts.get(debt.linkedAccountId) : undefined
      if (!debt.linkedAccountId || !account) report('card', t, debt.id, 'card_account_missing')
      else if (account.kind !== 'credit_card') report('card', t, debt.id, 'card_account_not_credit_card')
      if (debt.linkedAccountId && !debt.archivedAt && debt.status !== 'closed')
        cardOwners.set(debt.linkedAccountId, [...(cardOwners.get(debt.linkedAccountId) ?? []), debt.id])
      if (account) {
        // The card's balance is the linked account's balance — the debt must not have a second one.
        attempt(
          () => {
            const position = debtPosition(debt, s.accounts, s.transactions)
            const owed = -accountBalanceAsOf(account, s.transactions)
            if (position.outstanding !== owed) report('card', t, debt.id, 'card_balance_mismatch')
            if (owed < 0) report('card', t, debt.id, 'card_in_credit', 'info')
          },
          () => report('card', t, debt.id, 'card_balance_uncomputable'),
        )
      }
    } else {
      if (isMoney(debt.openingBalanceSatang) && debt.openingBalanceSatang < 0) report('money', t, debt.id, 'opening_negative')
      attempt(
        () => {
          const loan = loanPosition(debt, s.transactions)
          const adjustments = (debt.principalAdjustments ?? []).filter((a) => a.date >= debt.openingDate).reduce((sum, a) => sum + a.amountSatang, 0)
          const principal = s.transactions
            .filter((tx) => tx.type === 'debt_payment' && tx.debtId === debt.id && tx.date >= debt.openingDate && tx.principalSatang !== undefined)
            .reduce((sum, tx) => sum + (tx.principalSatang ?? 0), 0)
          if (loan.outstanding !== debt.openingBalanceSatang + adjustments - principal) report('debt', t, debt.id, 'outstanding_mismatch')
          if (!validateLoanTimeline(debt, s.transactions).ok) report('debt', t, debt.id, 'principal_overpaid')
        },
        () => report('debt', t, debt.id, 'outstanding_uncomputable'),
      )
      if (debt.linkedAccountId !== undefined && !accounts.has(debt.linkedAccountId)) report('orphan', t, debt.id, 'linked_account_missing')
    }
  }
  for (const [accountId, owners] of cardOwners) if (owners.length > 1) for (const id of owners) report('card', 'debts', id, `card_account_shared:${accountId}`)
  for (const tx of s.transactions) {
    const debt = tx.debtId ? debts.get(tx.debtId) : undefined
    if (tx.type !== 'debt_payment' || !debt) continue
    if (isRevolving(debt)) {
      // A card payment moves money into the card account, with no principal/interest split.
      if (tx.toAccountId !== debt.linkedAccountId) report('card', 'transactions', tx.id, 'card_payment_not_to_card')
      if (tx.principalSatang !== undefined || tx.interestSatang !== undefined || tx.feeSatang !== undefined)
        report('card', 'transactions', tx.id, 'card_payment_split')
    } else if (tx.date < debt.openingDate) report('debt', 'transactions', tx.id, 'payment_before_opening')
  }

  // --- Recurring rules ---
  for (const rule of s.recurringObligations) {
    const t = 'recurringObligations'
    money(t, rule.id, 'expectedAmount', rule.expectedAmountSatang)
    if (isMoney(rule.expectedAmountSatang) && rule.expectedAmountSatang <= 0) report('money', t, rule.id, 'expectedAmount_not_positive')
    for (const issue of validateRecurrence(rule.recurrence)) report('recurring', t, rule.id, issue)
    date(t, rule.id, 'scheduleFrom', rule.scheduleFrom, true)
    stamps(t, rule)
    if (rule.defaultAccountId !== undefined && !accounts.has(rule.defaultAccountId)) report('orphan', t, rule.id, 'account_missing')
    if (rule.categoryId !== undefined && !categories.has(rule.categoryId)) report('orphan', t, rule.id, 'category_missing')
    if (rule.debtId !== undefined && !debts.has(rule.debtId)) report('orphan', t, rule.id, 'debt_missing')
    const category = rule.categoryId ? categories.get(rule.categoryId) : undefined
    if (category && !rule.debtId && category.kind !== (rule.kind === 'income' ? 'income' : 'expense')) report('recurring', t, rule.id, 'category_kind_mismatch')
  }

  // --- Scheduled payments: source, uniqueness, status ⇄ transaction linkage ---
  const occurrenceKeys = new Set<string>()
  const payingTx = new Map<ID, Transaction[]>()
  for (const tx of s.transactions) if (tx.scheduledPaymentId) payingTx.set(tx.scheduledPaymentId, [...(payingTx.get(tx.scheduledPaymentId) ?? []), tx])
  for (const p of s.scheduledPayments) {
    const t = 'scheduledPayments'
    const source = p.sourceType === 'obligation' ? obligations.get(p.sourceId) : p.sourceType === 'debt' ? debts.get(p.sourceId) : undefined
    if (p.sourceType !== 'obligation' && p.sourceType !== 'debt') report('scheduled', t, p.id, 'source_type_invalid')
    else if (!source) report('orphan', t, p.id, p.sourceType === 'obligation' ? 'rule_missing' : 'debt_missing')
    const key = `${p.sourceType}|${p.sourceId}|${p.dueDate}`
    if (occurrenceKeys.has(key)) report('duplicate_key', t, p.id, 'duplicate_occurrence')
    occurrenceKeys.add(key)
    money(t, p.id, 'expectedAmount', p.expectedAmountSatang)
    date(t, p.id, 'dueDate', p.dueDate)
    date(t, p.id, 'paidDate', p.paidDate, true)
    stamps(t, p)

    const linked = payingTx.get(p.id) ?? []
    if (p.status === 'paid') {
      const tx = p.transactionId ? transactions.get(p.transactionId) : undefined
      if (!p.transactionId || !tx) report('scheduled', t, p.id, 'paid_without_transaction')
      else {
        if (tx.scheduledPaymentId !== p.id) report('scheduled', t, p.id, 'transaction_not_linked_back')
        if (p.paidDate !== tx.date) report('scheduled', t, p.id, 'paid_date_mismatch')
        if (source) {
          const expected = paymentTypeFor(p, p.sourceType === 'obligation' ? (source as RecurringObligation) : undefined)
          if (tx.type !== expected.type) report('scheduled', t, p.id, 'transaction_type_mismatch')
        }
      }
      if (linked.length > 1) report('scheduled', t, p.id, 'paid_twice')
    } else if (p.status === 'pending' || p.status === 'skipped') {
      if (p.transactionId !== undefined || p.paidDate !== undefined) report('scheduled', t, p.id, `${p.status}_has_payment_fields`)
      if (linked.length > 0) report('scheduled', t, p.id, `${p.status}_has_transaction`)
      // Deleting (archiving) a rule or debt removes all its unpaid occurrences.
      if (p.status === 'pending' && source?.archivedAt) report('recurring', t, p.id, 'pending_on_archived_source')
    } else report('scheduled', t, p.id, 'status_invalid')
  }

  // --- Budgets (plans only: no spending is stored) ---
  const budgetKeys = new Set<string>()
  for (const b of s.budgets) {
    const t = 'budgets'
    if (typeof b.month !== 'string' || !MONTH.test(b.month)) report('date', t, b.id, 'month_invalid')
    if (b.categoryId !== OVERALL_BUDGET) {
      const category = categories.get(b.categoryId)
      if (!category) report('orphan', t, b.id, 'category_missing')
      else if (category.kind !== 'expense') report('budget', t, b.id, 'category_not_expense')
    }
    money(t, b.id, 'limit', b.limitSatang)
    if (isMoney(b.limitSatang) && b.limitSatang <= 0) report('budget', t, b.id, 'limit_not_positive')
    const key = `${b.month}|${b.categoryId}`
    if (budgetKeys.has(key)) report('duplicate_key', t, b.id, 'duplicate_month_category')
    budgetKeys.add(key)
    stamps(t, b)
    const extra = Object.keys(b).filter((k) => !['id', 'month', 'categoryId', 'limitSatang', 'note', 'createdAt', 'updatedAt'].includes(k))
    if (extra.length) report('budget', t, b.id, 'stored_derived_fields')
  }

  // --- Attachments: metadata ⇄ binary, size, type, owner ---
  for (const a of s.attachments) {
    const t = 'attachments'
    if (!a.fileName) report('attachment', t, a.id, 'file_name_missing')
    if (!MIME.test(a.mimeType ?? '')) report('attachment', t, a.id, 'mime_type_invalid')
    if (!Number.isSafeInteger(a.sizeBytes) || a.sizeBytes < 0) report('attachment', t, a.id, 'size_invalid')
    if (!isTimestamp(a.createdAt)) report('date', t, a.id, 'createdAt_invalid')
    if (a.transactionId === undefined) report('orphan', t, a.id, 'no_owner')
    else if (!transactions.has(a.transactionId)) report('orphan', t, a.id, 'transaction_missing')
    const blob = blobs.get(a.id)
    if (!blob) report('attachment', t, a.id, 'blob_missing')
    else if (blob.size !== a.sizeBytes) report('attachment', t, a.id, 'size_mismatch')
  }
  for (const blob of s.blobs) if (!attachments.has(blob.id)) report('orphan', 'attachmentBlobs', blob.id, 'metadata_missing')

  const errors = Object.fromEntries(INTEGRITY_CATEGORIES.map((c) => [c, 0])) as Record<IntegrityCategory, number>
  for (const issue of issues) if (issue.severity === 'error') errors[issue.category] += 1
  const pass = (...categories: IntegrityCategory[]): CheckResult => (categories.some((c) => errors[c] > 0) ? 'FAIL' : 'PASS')
  return {
    counts: {
      accounts: s.accounts.length,
      categories: s.categories.length,
      transactions: s.transactions.length,
      recurring: s.recurringObligations.length,
      scheduled: s.scheduledPayments.length,
      debts: s.debts.length,
      budgets: s.budgets.length,
      attachments: s.attachments.length,
      blobs: s.blobs.length,
    },
    issues,
    errors,
    info: issues.filter((i) => i.severity === 'info').length,
    checks: {
      accountReconciliation: pass('account'),
      debtReconciliation: pass('debt'),
      creditCards: pass('card'),
      recurring: pass('recurring'),
      scheduledPayments: pass('scheduled'),
      budgetIntegrity: pass('budget'),
      attachmentIntegrity: pass('attachment'),
    },
    ok: issues.every((i) => i.severity !== 'error'),
  }
}

/** Plain-text report (counts, error totals, check results, then each issue as table/id/code). */
export function formatIntegrityReport(r: IntegrityReport): string {
  const e = r.errors
  const lines = [
    'TABLE COUNTS',
    `accounts: ${r.counts.accounts}`,
    `categories: ${r.counts.categories}`,
    `transactions: ${r.counts.transactions}`,
    `recurring: ${r.counts.recurring}`,
    `scheduled: ${r.counts.scheduled}`,
    `debts: ${r.counts.debts}`,
    `budgets: ${r.counts.budgets}`,
    `attachments: ${r.counts.attachments} (files: ${r.counts.blobs})`,
    '',
    'ERRORS',
    `orphans: ${e.orphan}`,
    `duplicates: ${e.duplicate_id + e.duplicate_key}`,
    `invalid money: ${e.money}`,
    `invalid dates: ${e.date}`,
    `invalid transactions: ${e.transaction}`,
    '',
    `account reconciliation: ${r.checks.accountReconciliation}`,
    `debt reconciliation: ${r.checks.debtReconciliation}`,
    `credit cards: ${r.checks.creditCards}`,
    `recurring: ${r.checks.recurring}`,
    `scheduled payments: ${r.checks.scheduledPayments}`,
    `budget integrity: ${r.checks.budgetIntegrity}`,
    `attachment integrity: ${r.checks.attachmentIntegrity}`,
    '',
    `RESULT: ${r.ok ? 'OK' : 'PROBLEMS FOUND'} (${r.issues.length - r.info} errors, ${r.info} notes)`,
  ]
  if (r.issues.length)
    lines.push('', 'DETAILS', ...r.issues.map((i) => `${i.severity === 'error' ? 'ERROR' : 'note '} ${i.category} ${i.table}[${i.id}] ${i.code}`))
  return lines.join('\n')
}
