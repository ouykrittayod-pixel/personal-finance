import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FinanceDatabase } from '@/db/dexie'
import { loadIntegritySnapshot } from '@/db/integrity-snapshot'
import { baht, makeTx } from '@/test/factories'
import { REP_NOW, seedRepresentative } from '@/test/representative'
import { auditIntegrity, formatIntegrityReport, type IntegritySnapshot } from './integrity'

let database: FinanceDatabase
let clean: IntegritySnapshot
let n = 0

beforeEach(async () => {
  database = new FinanceDatabase(`integrity-${++n}`)
  await seedRepresentative(database)
  clean = await loadIntegritySnapshot(database)
})
afterEach(async () => {
  database.close()
  await database.delete()
})

/** Audit a changed copy of the clean snapshot; returns "category:code" for every error. */
function errorsAfter(change: (s: IntegritySnapshot) => void): string[] {
  const copy = structuredClone(clean)
  change(copy)
  return auditIntegrity(copy)
    .issues.filter((i) => i.severity === 'error')
    .map((i) => `${i.category}:${i.code}`)
}
const tx = (s: IntegritySnapshot, id: string) => s.transactions.find((t) => t.id === id)!

describe('a database written by the app is clean', () => {
  it('no errors, every check passes, counts per table', async () => {
    const report = auditIntegrity(clean)
    expect(report.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(report.ok).toBe(true)
    expect(Object.values(report.checks).every((c) => c === 'PASS')).toBe(true)
    expect(report.counts).toMatchObject({ accounts: 3, categories: 6, transactions: 7, recurring: 2, debts: 2, budgets: 1, attachments: 1, blobs: 1 })
    const text = formatIntegrityReport(report)
    expect(text).toContain('orphans: 0')
    expect(text).toContain('account reconciliation: PASS')
    expect(text).toContain('attachment integrity: PASS')
  })

  it('reading the snapshot and auditing never writes', async () => {
    const before = JSON.stringify(await loadIntegritySnapshot(database))
    auditIntegrity(await loadIntegritySnapshot(database))
    expect(JSON.stringify(await loadIntegritySnapshot(database))).toBe(before)
  })

  it('the report never contains record contents (names, amounts, notes)', () => {
    const copy = structuredClone(clean)
    tx(copy, 'food').accountId = 'gone'
    const text = formatIntegrityReport(auditIntegrity(copy))
    expect(text).toContain('transactions[food] account_missing')
    expect(text).not.toContain('ข้าวกลางวัน')
    expect(text).not.toContain('250000')
  })
})

describe('orphan references', () => {
  it.each([
    ['transaction → account', (s: IntegritySnapshot) => void (tx(s, 'wage').accountId = 'gone'), 'orphan:account_missing'],
    ['transaction → category', (s: IntegritySnapshot) => void (tx(s, 'wage').categoryId = 'gone'), 'orphan:category_missing'],
    ['transaction → debt', (s: IntegritySnapshot) => void (tx(s, 'loan').debtId = 'gone'), 'orphan:debt_missing'],
    ['transaction → scheduled payment', (s: IntegritySnapshot) => void (tx(s, 'rent-paid').scheduledPaymentId = 'gone'), 'orphan:scheduled_payment_missing'],
    [
      'scheduled payment → rule',
      (s: IntegritySnapshot) => void (s.scheduledPayments.find((p) => p.sourceId === 'net-rule')!.sourceId = 'gone'),
      'orphan:rule_missing',
    ],
    ['attachment → transaction', (s: IntegritySnapshot) => void (s.attachments[0]!.transactionId = 'gone'), 'orphan:transaction_missing'],
    ['blob without metadata', (s: IntegritySnapshot) => void s.blobs.push({ id: 'stray', size: 1, type: 'image/png' }), 'orphan:metadata_missing'],
    ['budget → category', (s: IntegritySnapshot) => void (s.budgets[0]!.categoryId = 'gone'), 'orphan:category_missing'],
  ])('%s', (_label, change, expected) => {
    expect(errorsAfter(change)).toContain(expected)
  })

  it('valid optional references are not reported (no category on a transfer, overall budget, unlinked loan)', () => {
    const copy = structuredClone(clean)
    copy.budgets.push({ ...copy.budgets[0]!, id: 'overall', categoryId: '__overall' })
    expect(auditIntegrity(copy).ok).toBe(true)
    expect(tx(copy, 'move').categoryId).toBeUndefined()
  })
})

describe('duplicates, money, dates, types', () => {
  it('duplicate primary IDs and business keys', () => {
    expect(errorsAfter((s) => void s.transactions.push({ ...tx(s, 'wage') }))).toContain('duplicate_id:duplicate_id')
    expect(errorsAfter((s) => void s.budgets.push({ ...s.budgets[0]!, id: 'b2' }))).toContain('duplicate_key:duplicate_month_category')
    expect(errorsAfter((s) => void s.scheduledPayments.push({ ...s.scheduledPayments.find((p) => p.status === 'pending')!, id: 'sp2' }))).toContain(
      'duplicate_key:duplicate_occurrence',
    )
  })

  it.each([
    ['a fraction', 1.5],
    ['a string', '27500'],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('money that is %s', (_label, value) => {
    expect(errorsAfter((s) => void ((tx(s, 'wage') as { amountSatang: unknown }).amountSatang = value))).toContain('money:amount_not_integer')
  })

  it('negative where the domain forbids it; impossible principal / interest split', () => {
    expect(errorsAfter((s) => void (tx(s, 'food').amountSatang = baht(-5)))).toContain('transaction:amount_must_be_positive')
    expect(errorsAfter((s) => void (tx(s, 'loan').principalSatang = baht(7_000)))).toContain('money:allocation_mismatch')
    expect(errorsAfter((s) => void (tx(s, 'loan').interestSatang = baht(-1)))).toContain('money:interestSatang_negative')
    expect(errorsAfter((s) => void (s.budgets[0]!.limitSatang = baht(0)))).toContain('budget:limit_not_positive')
    // Signed values that the model allows: a card's opening balance, an adjustment.
    const copy = structuredClone(clean)
    copy.accounts.find((a) => a.id === 'card')!.openingBalanceSatang = baht(-500)
    copy.transactions.push(
      makeTx({ id: 'adj', type: 'adjustment', amountSatang: baht(-20), accountId: 'cash', date: '2026-09-10', createdAt: REP_NOW, updatedAt: REP_NOW }),
    )
    expect(auditIntegrity(copy).ok).toBe(true)
  })

  it('malformed / impossible / empty dates and bad timestamps', () => {
    expect(errorsAfter((s) => void (tx(s, 'wage').date = '2026-02-30'))).toContain('date:date_invalid')
    expect(errorsAfter((s) => void (tx(s, 'wage').date = '25/09/2026'))).toContain('date:date_invalid')
    expect(errorsAfter((s) => void (tx(s, 'wage').date = ''))).toContain('date:date_invalid')
    expect(errorsAfter((s) => void (s.accounts[0]!.createdAt = 'yesterday'))).toContain('date:createdAt_invalid')
    expect(errorsAfter((s) => void (s.budgets[0]!.month = '2026-13'))).toContain('date:month_invalid')
  })

  it('transaction type rules (the model’s own validateTransaction plus category kinds)', () => {
    expect(errorsAfter((s) => void ((tx(s, 'wage') as { type: string }).type = 'gift'))).toContain('transaction:type_invalid')
    expect(errorsAfter((s) => void delete tx(s, 'food').categoryId)).toContain('transaction:expense_without_category')
    expect(errorsAfter((s) => void (tx(s, 'wage').categoryId = 'food'))).toContain('transaction:category_not_income')
    expect(errorsAfter((s) => void delete tx(s, 'move').toAccountId)).toContain('transaction:transfer_requires_to_account')
    expect(errorsAfter((s) => void (tx(s, 'move').toAccountId = 'card'))).toContain('transaction:transfer_liability_not_allowed')
    expect(errorsAfter((s) => void delete tx(s, 'loan').debtId)).toContain('transaction:debt_payment_requires_debt')
    expect(errorsAfter((s) => void (tx(s, 'food').debtId = 'home'))).toContain('transaction:debt_not_allowed')
  })
})

describe('reconciliation', () => {
  it('accounts: opening + effects equals both existing balance functions; a stray effect is caught', () => {
    expect(auditIntegrity(clean).checks.accountReconciliation).toBe('PASS')
    // A float amount makes the ledger sum non-integer → mismatch reported, not silently rounded.
    const report = auditIntegrity(
      (() => {
        const s = structuredClone(clean)
        tx(s, 'move').amountSatang = 500000.5 as never
        return s
      })(),
    )
    expect(report.checks.accountReconciliation).toBe('FAIL')
  })

  it('loans: opening − explicit principal (+ adjustments) matches the debt calculation; overpaid principal is caught', () => {
    expect(auditIntegrity(clean).checks.debtReconciliation).toBe('PASS')
    expect(errorsAfter((s) => void (s.debts.find((d) => d.id === 'home')!.openingBalanceSatang = baht(5_000)))).toContain('debt:principal_overpaid')
    expect(errorsAfter((s) => void (tx(s, 'loan').date = '2026-07-01'))).toContain('debt:payment_before_opening')
  })

  it('credit cards: linked account exists and is a card, owned once, payments go to the card without a split', () => {
    expect(auditIntegrity(clean).checks.creditCards).toBe('PASS')
    expect(errorsAfter((s) => void (s.debts.find((d) => d.id === 'cc')!.linkedAccountId = 'gone'))).toContain('card:card_account_missing')
    expect(errorsAfter((s) => void (s.debts.find((d) => d.id === 'cc')!.linkedAccountId = 'kbank'))).toContain('card:card_account_not_credit_card')
    expect(errorsAfter((s) => void s.debts.push({ ...s.debts.find((d) => d.id === 'cc')!, id: 'cc2' }))).toContain('card:card_account_shared:card')
    expect(errorsAfter((s) => void delete tx(s, 'cardpay').toAccountId)).toContain('card:card_payment_not_to_card')
    expect(errorsAfter((s) => void (tx(s, 'cardpay').principalSatang = baht(3_000)))).toContain('card:card_payment_split')
  })

  it('a card paid beyond what is owed is a note (credit), not an error or a debt', () => {
    const s = structuredClone(clean)
    tx(s, 'cardpay').amountSatang = baht(5_000)
    const report = auditIntegrity(s)
    expect(report.ok).toBe(true)
    expect(report.issues).toContainEqual(expect.objectContaining({ severity: 'info', code: 'card_in_credit', id: 'cc' }))
  })

  it('recurring rules: valid recurrence, category kind, no unpaid occurrence left on a deleted rule', () => {
    expect(auditIntegrity(clean).checks.recurring).toBe('PASS')
    expect(errorsAfter((s) => void (s.recurringObligations[0]!.recurrence.interval = 0))).toContain('recurring:interval_invalid')
    expect(errorsAfter((s) => void (s.recurringObligations.find((r) => r.id === 'net-rule')!.categoryId = 'salary'))).toContain(
      'recurring:category_kind_mismatch',
    )
    expect(errorsAfter((s) => void (s.recurringObligations.find((r) => r.id === 'net-rule')!.archivedAt = REP_NOW))).toContain(
      'recurring:pending_on_archived_source',
    )
  })

  it('scheduled payments: paid ⇄ transaction linkage, skipped/pending have no transaction', () => {
    expect(auditIntegrity(clean).checks.scheduledPayments).toBe('PASS')
    const paid = (s: IntegritySnapshot) => s.scheduledPayments.find((p) => p.status === 'paid')!
    const pending = (s: IntegritySnapshot) => s.scheduledPayments.find((p) => p.status === 'pending')!
    expect(errorsAfter((s) => void delete paid(s).transactionId)).toContain('scheduled:paid_without_transaction')
    expect(errorsAfter((s) => void (paid(s).paidDate = '2026-09-07'))).toContain('scheduled:paid_date_mismatch')
    expect(errorsAfter((s) => void (tx(s, 'rent-paid').type = 'income'))).toContain('scheduled:transaction_type_mismatch')
    expect(errorsAfter((s) => void (paid(s).status = 'skipped'))).toContain('scheduled:skipped_has_payment_fields')
    expect(errorsAfter((s) => void (tx(s, 'food').scheduledPaymentId = pending(s).id))).toContain('scheduled:pending_has_transaction')
    expect(errorsAfter((s) => void ((pending(s) as { status: string }).status = 'late'))).toContain('scheduled:status_invalid')
  })

  it('budgets: expense category only, positive integer limit, no stored spending', () => {
    expect(auditIntegrity(clean).checks.budgetIntegrity).toBe('PASS')
    expect(errorsAfter((s) => void (s.budgets[0]!.categoryId = 'salary'))).toContain('budget:category_not_expense')
    expect(errorsAfter((s) => void ((s.budgets[0] as unknown as { spent: number }).spent = 1))).toContain('budget:stored_derived_fields')
  })

  it('attachments: blob present, same size, valid MIME type, owner present', () => {
    expect(auditIntegrity(clean).checks.attachmentIntegrity).toBe('PASS')
    expect(errorsAfter((s) => void (s.blobs = []))).toContain('attachment:blob_missing')
    expect(errorsAfter((s) => void (s.blobs[0]!.size = 1))).toContain('attachment:size_mismatch')
    expect(errorsAfter((s) => void (s.attachments[0]!.mimeType = 'jpeg'))).toContain('attachment:mime_type_invalid')
    expect(errorsAfter((s) => void delete s.attachments[0]!.transactionId)).toContain('orphan:no_owner')
  })

  it('transactions before an account’s opening date are listed as notes (allowed: the opening balance includes them)', () => {
    const s = structuredClone(clean)
    tx(s, 'food').date = '2026-07-15'
    const report = auditIntegrity(s)
    expect(report.ok).toBe(true)
    expect(report.issues).toContainEqual(expect.objectContaining({ severity: 'info', code: 'before_account_opening', id: 'food' }))
  })
})
