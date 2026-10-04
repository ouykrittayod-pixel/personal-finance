/**
 * Debts: two balance models, repayment allocation and integrity rules. Pure.
 *
 * LOANS (every kind except credit_card) — amortizing debts tracked by principal:
 *   outstanding principal(asOf) = openingBalance (at openingDate)
 *                               + Σ principal adjustments (openingDate ≤ date ≤ asOf)
 *                               − Σ allocated principal of debt payments (openingDate ≤ date ≤ asOf)
 *   Interest and fees are borrowing costs, reported separately, never principal.
 *   A payment without an explicit allocation is "unallocated": it moved money
 *   (the paying account is debited) but never reduces principal.
 *
 * CREDIT CARDS — revolving: the liability is the linked credit-card account's
 *   balance (purchases, refunds, adjustments, payments). There is no second
 *   balance: card payments carry no split and are never subtracted twice.
 *
 * Reporting: expenses never include debt payments. Loan interest/fees are
 * shown inside debt payments as the cost of borrowing. Card interest/fees are
 * recorded as explicit expenses on the card account (they raise the liability
 * and are spending); paying the card afterwards is a debt payment only.
 */
import type {
  Account,
  CardStatement,
  Debt,
  DebtKind,
  ID,
  ISODate,
  InterestMethod,
  PrincipalAdjustment,
  RecurringObligation,
  Transaction,
} from './entities'
import type { ScheduleSource } from './scheduling'
import { add, negate, subtract, sum, ZERO, type BasisPoints, type Satang } from './money'
import { isValidDate, type RecurrenceRule } from './recurrence'
import { accountEffects } from './transactions'

export const REVOLVING_KINDS: ReadonlySet<DebtKind> = new Set(['credit_card'])

export const isRevolving = (debt: Pick<Debt, 'kind'>) => REVOLVING_KINDS.has(debt.kind)
export const isDebtActive = (debt: Pick<Debt, 'archivedAt' | 'status'>) => !debt.archivedAt && debt.status === 'active'

// ---------------------------------------------------------------------------
// Allocation
// ---------------------------------------------------------------------------

export interface Allocation {
  principal: Satang
  interest: Satang
  fee: Satang
}

/** The explicit split of a loan payment, or null when it is unallocated. */
export function allocationOf(tx: Pick<Transaction, 'principalSatang' | 'interestSatang' | 'feeSatang'>): Allocation | null {
  if (tx.principalSatang === undefined) return null
  return { principal: tx.principalSatang, interest: tx.interestSatang ?? ZERO, fee: tx.feeSatang ?? ZERO }
}

const paymentsFor = (debtId: ID, transactions: readonly Transaction[]) =>
  transactions.filter((tx) => tx.type === 'debt_payment' && tx.debtId === debtId)

// ---------------------------------------------------------------------------
// Loan position
// ---------------------------------------------------------------------------

export interface LoanPosition {
  opening: Satang
  openingDate: ISODate
  adjustments: Satang
  principalPaid: Satang
  interestPaid: Satang
  feesPaid: Satang
  /** Payments whose split is unknown (not counted as principal). */
  unallocatedPaid: Satang
  unallocatedCount: number
  totalPaid: Satang
  paymentCount: number
  outstanding: Satang
}

/** Loan principal position as of a date (default: all history). */
export function loanPosition(debt: Debt, transactions: readonly Transaction[], asOf?: ISODate): LoanPosition {
  const inWindow = (date: ISODate) => date >= debt.openingDate && (asOf === undefined || date <= asOf)
  const adjustments = sum((debt.principalAdjustments ?? []).filter((a) => inWindow(a.date)).map((a) => a.amountSatang))
  let principalPaid = ZERO
  let interestPaid = ZERO
  let feesPaid = ZERO
  let unallocatedPaid = ZERO
  let unallocatedCount = 0
  let totalPaid = ZERO
  let paymentCount = 0
  for (const tx of paymentsFor(debt.id, transactions)) {
    if (!inWindow(tx.date)) continue
    paymentCount += 1
    totalPaid = add(totalPaid, tx.amountSatang)
    const allocation = allocationOf(tx)
    if (!allocation) {
      unallocatedPaid = add(unallocatedPaid, tx.amountSatang)
      unallocatedCount += 1
      continue
    }
    principalPaid = add(principalPaid, allocation.principal)
    interestPaid = add(interestPaid, allocation.interest)
    feesPaid = add(feesPaid, allocation.fee)
  }
  const started = asOf === undefined || asOf >= debt.openingDate
  return {
    opening: debt.openingBalanceSatang,
    openingDate: debt.openingDate,
    adjustments,
    principalPaid,
    interestPaid,
    feesPaid,
    unallocatedPaid,
    unallocatedCount,
    totalPaid,
    paymentCount,
    outstanding: started ? subtract(add(debt.openingBalanceSatang, adjustments), principalPaid) : ZERO,
  }
}

/**
 * Walk the loan's history in date order and report the first point where
 * principal would go below zero (overpayment). Same-day increases are applied
 * before repayments.
 */
export function validateLoanTimeline(
  debt: Debt,
  transactions: readonly Transaction[],
): { ok: true } | { ok: false; date: ISODate; outstanding: Satang } {
  type Event = { date: ISODate; delta: Satang; order: number }
  const events: Event[] = [
    ...(debt.principalAdjustments ?? []).filter((a) => a.date >= debt.openingDate).map((a) => ({ date: a.date, delta: a.amountSatang, order: a.amountSatang >= 0 ? 0 : 1 })),
    ...paymentsFor(debt.id, transactions)
      .filter((tx) => tx.date >= debt.openingDate)
      .flatMap((tx) => {
        const allocation = allocationOf(tx)
        return allocation ? [{ date: tx.date, delta: negate(allocation.principal), order: 1 }] : []
      }),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order)

  let running = debt.openingBalanceSatang
  for (const event of events) {
    running = add(running, event.delta)
    if (running < 0) return { ok: false, date: event.date, outstanding: running }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Credit card position
// ---------------------------------------------------------------------------

/** Balance of one account as of a date (liabilities negative). */
export function accountBalanceAsOf(account: Account, transactions: readonly Transaction[], asOf?: ISODate): Satang {
  if (asOf !== undefined && asOf < account.openingDate) return ZERO
  let balance = account.openingBalanceSatang
  for (const tx of transactions) {
    if (tx.date < account.openingDate || (asOf !== undefined && tx.date > asOf)) continue
    for (const effect of accountEffects(tx)) if (effect.accountId === account.id) balance = add(balance, effect.deltaSatang)
  }
  return balance
}

export interface CardPosition {
  /** What is owed (positive). Negative = the card is in credit (overpaid). */
  liability: Satang
  paymentsTotal: Satang
  paymentCount: number
  accountName?: string
}

/** Null when the linked card account is missing (the balance is then unknown, not zero). */
export function cardPosition(debt: Debt, accounts: readonly Account[], transactions: readonly Transaction[], asOf?: ISODate): CardPosition | null {
  const account = accounts.find((a) => a.id === debt.linkedAccountId)
  if (!account) return null
  const payments = paymentsFor(debt.id, transactions).filter((tx) => asOf === undefined || tx.date <= asOf)
  return {
    liability: negate(accountBalanceAsOf(account, transactions, asOf)),
    paymentsTotal: sum(payments.map((tx) => tx.amountSatang)),
    paymentCount: payments.length,
    accountName: account.name,
  }
}

// ---------------------------------------------------------------------------
// Combined position
// ---------------------------------------------------------------------------

export type DebtPosition =
  | { debt: Debt; model: 'loan'; outstanding: Satang; loan: LoanPosition }
  | { debt: Debt; model: 'card'; outstanding: Satang | null; card: CardPosition | null }

/** Outstanding as of a date: loan principal, or card liability (never negative in totals). */
export function debtPosition(debt: Debt, accounts: readonly Account[], transactions: readonly Transaction[], asOf?: ISODate): DebtPosition {
  if (isRevolving(debt)) {
    const card = cardPosition(debt, accounts, transactions, asOf)
    return { debt, model: 'card', outstanding: card ? card.liability : null, card }
  }
  const loan = loanPosition(debt, transactions, asOf)
  return { debt, model: 'loan', outstanding: loan.outstanding, loan }
}

/** Amount counted in totals: owed amounts only (a card in credit counts as 0; unknown excluded). */
export const owedOf = (position: DebtPosition): Satang => (position.outstanding !== null && position.outstanding > 0 ? position.outstanding : ZERO)

/** Repayment progress for loans with a known starting principal: paid principal vs opening + increases. */
export function loanProgress(loan: LoanPosition): { base: Satang; paid: Satang } | null {
  const base = add(loan.opening, loan.adjustments > 0 ? loan.adjustments : ZERO)
  return base > 0 ? { base, paid: loan.principalPaid } : null
}

// ---------------------------------------------------------------------------
// Installment schedule (loans) — one authoritative schedule source per debt
// ---------------------------------------------------------------------------

/** Shape the scheduling functions need (shared with recurring obligations). */
/** The loan's installment schedule, or null if it has none (disabled, card, or missing installment/due day). */
export function debtScheduleSource(debt: Debt): ScheduleSource | null {
  if (isRevolving(debt) || !debt.scheduleEnabled || !debt.installmentSatang || !debt.dueDay) return null
  const recurrence: RecurrenceRule = {
    frequency: 'monthly',
    interval: 1,
    startDate: debt.startDate ?? debt.openingDate,
    dayOfMonth: debt.dueDay,
    ...(debt.maturityDate ? { endDate: debt.maturityDate } : {}),
  }
  return {
    recurrence,
    expectedAmountSatang: debt.installmentSatang,
    scheduleFrom: debt.scheduleFrom,
    pausedAt: debt.schedulePausedAt,
    // A paid-off or closed debt schedules nothing more.
    archivedAt: debt.archivedAt ?? (debt.status !== 'active' ? debt.updatedAt : undefined),
  }
}

/** Does the debt itself produce scheduled payments (installments or card statements)? */
export const hasOwnSchedule = (debt: Pick<Debt, 'kind' | 'scheduleEnabled' | 'statements'>) =>
  (!REVOLVING_KINDS.has(debt.kind) && Boolean(debt.scheduleEnabled)) || (debt.statements?.length ?? 0) > 0

/** An active recurring obligation that pays this debt (the other possible schedule owner). */
export function obligationOwningDebt(debtId: ID, obligations: readonly RecurringObligation[]): RecurringObligation | undefined {
  return obligations.find((o) => o.debtId === debtId && !o.archivedAt)
}

// ---------------------------------------------------------------------------
// Building / validating a debt
// ---------------------------------------------------------------------------

export interface DebtDraft {
  name: string
  kind: DebtKind
  lender?: string
  /** Original principal, if known. */
  principalSatang?: Satang | null
  /** Loans: principal owed on the effective date. */
  openingBalanceSatang: Satang | null
  openingDate: ISODate
  startDate?: ISODate
  maturityDate?: ISODate
  interestMethod: InterestMethod
  /** Undefined/null = unknown. */
  annualInterestRateBps?: BasisPoints | null
  installmentSatang?: Satang | null
  dueDay?: number
  scheduleEnabled?: boolean
  /** Defaults to the stored status (new debts: active). */
  status?: Debt['status']
  /** Credit cards: the card account. */
  linkedAccountId?: ID
  note?: string
}

export type DebtIssue =
  | 'name_required'
  | 'opening_required'
  | 'opening_invalid'
  | 'opening_date_invalid'
  | 'principal_invalid'
  | 'start_date_invalid'
  | 'maturity_invalid'
  | 'maturity_before_start'
  | 'rate_invalid'
  | 'installment_invalid'
  | 'due_day_invalid'
  | 'schedule_incomplete'
  | 'schedule_owned_by_obligation'
  | 'card_account_required'
  | 'card_account_invalid'
  | 'card_account_in_use'
  | 'opening_below_repaid'

export interface DebtContext {
  accounts: ReadonlyMap<ID, Pick<Account, 'kind' | 'archivedAt'>>
  /** Other debts (to keep one debt per card account). */
  debts: readonly Pick<Debt, 'id' | 'linkedAccountId' | 'archivedAt' | 'status'>[]
  obligations: readonly RecurringObligation[]
  transactions: readonly Transaction[]
}

const isMoney = (v: Satang | null | undefined): v is Satang => v !== null && v !== undefined && Number.isSafeInteger(v)
const firstOfMonth = (date: ISODate) => `${date.slice(0, 7)}-01`

export function buildDebt(
  draft: DebtDraft,
  context: DebtContext,
  meta: { id: ID; now: string; today: ISODate; existing?: Debt },
): { ok: true; debt: Debt } | { ok: false; issues: DebtIssue[] } {
  const issues: DebtIssue[] = []
  const { existing } = meta
  const id = existing?.id ?? meta.id
  const revolving = REVOLVING_KINDS.has(draft.kind)
  const name = draft.name.trim()
  if (!name) issues.push('name_required')

  if (draft.principalSatang !== undefined && draft.principalSatang !== null && (!isMoney(draft.principalSatang) || draft.principalSatang <= 0)) {
    issues.push('principal_invalid')
  }
  if (draft.annualInterestRateBps !== undefined && draft.annualInterestRateBps !== null) {
    if (!Number.isInteger(draft.annualInterestRateBps) || draft.annualInterestRateBps < 0 || draft.annualInterestRateBps > 10_000) issues.push('rate_invalid')
  }

  if (revolving) {
    const account = draft.linkedAccountId ? context.accounts.get(draft.linkedAccountId) : undefined
    if (!draft.linkedAccountId) issues.push('card_account_required')
    else if (!account || account.kind !== 'credit_card' || (account.archivedAt && existing?.linkedAccountId !== draft.linkedAccountId)) issues.push('card_account_invalid')
    else if (context.debts.some((d) => d.id !== id && d.linkedAccountId === draft.linkedAccountId && !d.archivedAt && d.status !== 'closed')) {
      issues.push('card_account_in_use')
    }
  } else {
    if (draft.openingBalanceSatang === null) issues.push('opening_required')
    else if (!isMoney(draft.openingBalanceSatang) || draft.openingBalanceSatang < 0) issues.push('opening_invalid')
    if (!isValidDate(draft.openingDate)) issues.push('opening_date_invalid')
    if (draft.startDate && !isValidDate(draft.startDate)) issues.push('start_date_invalid')
    if (draft.maturityDate) {
      if (!isValidDate(draft.maturityDate)) issues.push('maturity_invalid')
      else if (draft.maturityDate < (draft.startDate ?? draft.openingDate)) issues.push('maturity_before_start')
    }
    if (draft.installmentSatang !== undefined && draft.installmentSatang !== null && (!isMoney(draft.installmentSatang) || draft.installmentSatang <= 0)) {
      issues.push('installment_invalid')
    }
    if (draft.dueDay !== undefined && (!Number.isInteger(draft.dueDay) || draft.dueDay < 1 || draft.dueDay > 31)) issues.push('due_day_invalid')
    if (draft.scheduleEnabled) {
      if (!isMoney(draft.installmentSatang ?? undefined) || !draft.dueDay) issues.push('schedule_incomplete')
      else if (obligationOwningDebt(id, context.obligations)) issues.push('schedule_owned_by_obligation')
    }
  }
  if (issues.length > 0) return { ok: false, issues }

  const scheduleWasOn = Boolean(existing?.scheduleEnabled)
  const startDate = revolving ? undefined : draft.startDate || undefined
  const debt: Debt = {
    ...(existing ?? {}),
    id,
    name,
    kind: draft.kind,
    lender: draft.lender?.trim() || undefined,
    principalSatang: isMoney(draft.principalSatang ?? undefined) ? draft.principalSatang! : undefined,
    openingBalanceSatang: revolving ? ZERO : draft.openingBalanceSatang!,
    openingDate: revolving ? (existing?.openingDate ?? meta.today) : draft.openingDate,
    interestMethod: draft.interestMethod,
    annualInterestRateBps: draft.annualInterestRateBps ?? undefined,
    installmentSatang: revolving ? undefined : (draft.installmentSatang ?? undefined),
    dueDay: revolving ? undefined : draft.dueDay,
    startDate,
    maturityDate: revolving ? undefined : draft.maturityDate || undefined,
    linkedAccountId: revolving ? draft.linkedAccountId : undefined,
    scheduleEnabled: revolving ? undefined : draft.scheduleEnabled || undefined,
    // Installments generate from this month (or a later start) — no back-filled "overdue" history.
    scheduleFrom:
      !revolving && draft.scheduleEnabled
        ? scheduleWasOn && existing?.scheduleFrom
          ? existing.scheduleFrom
          : laterOf(startDate ?? draft.openingDate, firstOfMonth(meta.today))
        : undefined,
    status: draft.status ?? existing?.status ?? 'active',
    note: draft.note?.trim() || undefined,
    createdAt: existing?.createdAt ?? meta.now,
    updatedAt: meta.now,
  }
  for (const key of Object.keys(debt) as (keyof Debt)[]) if (debt[key] === undefined) delete debt[key]

  // Changing the opening balance/date must not make recorded repayments exceed the principal.
  if (!revolving && existing && !validateLoanTimeline(debt, context.transactions).ok) return { ok: false, issues: ['opening_below_repaid'] }
  return { ok: true, debt }
}

const laterOf = (a: ISODate, b: ISODate) => (a > b ? a : b)

// ---------------------------------------------------------------------------
// Principal adjustments and card statements
// ---------------------------------------------------------------------------

export type AdjustmentIssue = 'adjustment_invalid' | 'adjustment_date_invalid' | 'adjustment_before_opening' | 'not_a_loan' | 'opening_below_repaid'

export function addPrincipalAdjustment(
  debt: Debt,
  adjustment: Omit<PrincipalAdjustment, 'createdAt'>,
  transactions: readonly Transaction[],
  now: string,
): { ok: true; debt: Debt } | { ok: false; issues: AdjustmentIssue[] } {
  if (isRevolving(debt)) return { ok: false, issues: ['not_a_loan'] }
  const issues: AdjustmentIssue[] = []
  if (!Number.isSafeInteger(adjustment.amountSatang) || adjustment.amountSatang === 0) issues.push('adjustment_invalid')
  if (!isValidDate(adjustment.date)) issues.push('adjustment_date_invalid')
  else if (adjustment.date < debt.openingDate) issues.push('adjustment_before_opening')
  if (issues.length > 0) return { ok: false, issues }
  const next: Debt = {
    ...debt,
    principalAdjustments: [...(debt.principalAdjustments ?? []), { ...adjustment, note: adjustment.note?.trim() || undefined, createdAt: now }],
    updatedAt: now,
  }
  if (!validateLoanTimeline(next, transactions).ok) return { ok: false, issues: ['opening_below_repaid'] }
  return { ok: true, debt: next }
}

export type StatementIssue = 'not_a_card' | 'statement_date_invalid' | 'due_date_invalid' | 'due_before_statement' | 'balance_invalid' | 'minimum_invalid' | 'schedule_owned_by_obligation'

/** Validate a card statement snapshot (stored as entered; never the live balance). */
export function validateStatement(
  debt: Debt,
  statement: Pick<CardStatement, 'statementDate' | 'balanceSatang' | 'minimumDueSatang' | 'dueDate'>,
  obligations: readonly RecurringObligation[],
): StatementIssue[] {
  const issues: StatementIssue[] = []
  if (!isRevolving(debt)) issues.push('not_a_card')
  if (!isValidDate(statement.statementDate)) issues.push('statement_date_invalid')
  if (!isValidDate(statement.dueDate)) issues.push('due_date_invalid')
  else if (isValidDate(statement.statementDate) && statement.dueDate < statement.statementDate) issues.push('due_before_statement')
  if (!Number.isSafeInteger(statement.balanceSatang) || statement.balanceSatang < 0) issues.push('balance_invalid')
  if (statement.minimumDueSatang !== undefined && (!Number.isSafeInteger(statement.minimumDueSatang) || statement.minimumDueSatang < 0 || statement.minimumDueSatang > statement.balanceSatang)) {
    issues.push('minimum_invalid')
  }
  if (obligationOwningDebt(debt.id, obligations)) issues.push('schedule_owned_by_obligation')
  return issues
}

/** The amount a statement's scheduled payment expects: the minimum due if printed, else the statement balance. */
export const statementExpectedAmount = (statement: Pick<CardStatement, 'balanceSatang' | 'minimumDueSatang'>): Satang =>
  statement.minimumDueSatang ?? statement.balanceSatang

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

const PERCENT = /^(\d{1,3})(?:\.(\d{1,2}))?$/

/** "5.25" (%) → 525 basis points, exactly (no floating point). Null if not a valid percentage. */
export function parsePercentToBps(input: string): BasisPoints | null {
  const match = PERCENT.exec(input.trim().replace(/%$/, '').trim())
  if (!match) return null
  const bps = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0')
  return bps <= 10_000 ? bps : null
}

/** 525 → "5.25" */
export const formatBpsAsPercent = (bps: BasisPoints): string => {
  const whole = Math.floor(bps / 100)
  const fraction = bps % 100
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, '0').replace(/0$/, '')}`
}

