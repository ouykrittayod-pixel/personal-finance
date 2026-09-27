import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Transaction } from '@/domain/entities'
import { satang, type Satang } from '@/domain/money'
import { accountBalances, debtSummary, monthTotals } from '@/domain/reporting'
import type { TransactionDraft } from '@/domain/transactions'
import { baht, makeAccount, makeCategory, makeDebt, makeScheduled, makeTx } from '@/test/factories'
import { FinanceDatabase } from '../dexie'
import { StorageError } from '../errors'
import { createAttachmentsRepository } from './attachments'
import { createTransactionsRepository, ExpenseValidationError, TransactionNotFoundError } from './transactions'

let database: FinanceDatabase
let repo: ReturnType<typeof createTransactionsRepository>
let counter = 0
const meta = () => ({ now: `2026-09-26T0${(counter % 9) + 1}:00:00.000Z`, newId: () => `att-${++counter}` })
const noFiles = { add: [], remove: [] }

/** Draft that mirrors a stored transaction, with overrides — like the edit form produces. */
function draftFrom(tx: Transaction, overrides: Partial<TransactionDraft> = {}): TransactionDraft {
  return {
    type: tx.type as TransactionDraft['type'],
    amountSatang: tx.amountSatang,
    accountId: tx.accountId,
    toAccountId: tx.toAccountId,
    categoryId: tx.categoryId,
    debtId: tx.debtId,
    principalSatang: tx.principalSatang,
    interestSatang: tx.interestSatang,
    feeSatang: tx.feeSatang,
    date: tx.date,
    description: tx.description,
    note: tx.note,
    ...overrides,
  }
}

async function snapshot() {
  const [accounts, transactions, debts] = await Promise.all([database.accounts.toArray(), database.transactions.toArray(), database.debts.toArray()])
  const balances = accountBalances(accounts, transactions)
  return { balances, debts: debtSummary(debts, transactions, accounts), totals: monthTotals(transactions, '2026-09') }
}

beforeEach(async () => {
  database = new FinanceDatabase(`edit-${crypto.randomUUID()}`)
  repo = createTransactionsRepository(database)
  await database.accounts.bulkAdd([
    makeAccount({ id: 'bank', name: 'KBank', kind: 'bank', openingBalanceSatang: baht(10_000) }),
    makeAccount({ id: 'cash', name: 'เงินสด', kind: 'cash', openingBalanceSatang: baht(1_000) }),
    makeAccount({ id: 'card', name: 'บัตรเครดิต', kind: 'credit_card' }),
  ])
  await database.categories.bulkAdd([
    makeCategory({ id: 'food', name: 'อาหาร' }),
    makeCategory({ id: 'travel', name: 'เดินทาง' }),
    makeCategory({ id: 'salary', name: 'เงินเดือน', kind: 'income' }),
  ])
  await database.debts.bulkAdd([
    makeDebt({ id: 'cc', name: 'บัตรเครดิต KBank', kind: 'credit_card', linkedAccountId: 'card' }),
    makeDebt({ id: 'home', name: 'สินเชื่อบ้าน', kind: 'mortgage', openingBalanceSatang: baht(100_000) }),
  ])
})

afterEach(async () => {
  vi.restoreAllMocks()
  await database.delete()
})

describe('update', () => {
  it('edits in place: same id, type and creation time; one record', async () => {
    const original = makeTx({ id: 'e1', type: 'expense', amountSatang: baht(85), accountId: 'cash', categoryId: 'food', description: 'ข้าว', createdAt: '2026-09-25T01:00:00.000Z' })
    await database.transactions.add(original)
    const updated = await repo.update(
      'e1',
      draftFrom(original, { amountSatang: baht(120), categoryId: 'travel', accountId: 'bank', date: '2026-09-24', description: 'แท็กซี่', note: 'ไปทำงาน' }),
      noFiles,
      meta(),
    )
    expect(updated).toMatchObject({ id: 'e1', type: 'expense', amountSatang: baht(120), categoryId: 'travel', accountId: 'bank', date: '2026-09-24', description: 'แท็กซี่', note: 'ไปทำงาน', createdAt: '2026-09-25T01:00:00.000Z' })
    expect(updated.updatedAt).not.toBe(original.updatedAt)
    expect(await database.transactions.count()).toBe(1)
    expect(await database.transactions.get('e1')).toEqual(updated)
  })

  it('clears optional text when emptied', async () => {
    const original = makeTx({ id: 'e1', type: 'expense', amountSatang: baht(85), accountId: 'cash', categoryId: 'food', description: 'ข้าว', note: 'x' })
    await database.transactions.add(original)
    const updated = await repo.update('e1', draftFrom(original, { description: '', note: '  ' }), noFiles, meta())
    expect(updated).not.toHaveProperty('description')
    expect(updated).not.toHaveProperty('note')
  })

  it('moves the amount between accounts when the account changes', async () => {
    const original = makeTx({ id: 'e1', type: 'expense', amountSatang: baht(100), accountId: 'cash', categoryId: 'food' })
    await database.transactions.add(original)
    expect((await snapshot()).balances.get('cash')).toBe(baht(900))
    await repo.update('e1', draftFrom(original, { accountId: 'bank' }), noFiles, meta())
    const { balances } = await snapshot()
    expect(balances.get('cash')).toBe(baht(1_000))
    expect(balances.get('bank')).toBe(baht(9_900))
  })

  it('refuses invalid edits and changing the type, leaving the record untouched', async () => {
    const original = makeTx({ id: 'e1', type: 'expense', amountSatang: baht(85), accountId: 'cash', categoryId: 'food' })
    await database.transactions.add(original)
    await expect(repo.update('e1', draftFrom(original, { amountSatang: satang(0) }), noFiles, meta())).rejects.toMatchObject({ issues: ['amount_must_be_positive'] })
    await expect(repo.update('e1', draftFrom(original, { categoryId: 'salary' }), noFiles, meta())).rejects.toBeInstanceOf(ExpenseValidationError)
    await expect(repo.update('e1', { ...draftFrom(original), type: 'income' }, noFiles, meta())).rejects.toMatchObject({ issues: expect.arrayContaining(['type_change_not_allowed']) })
    expect(await database.transactions.get('e1')).toEqual(original)
  })

  it('reports a missing transaction', async () => {
    await expect(repo.update('ghost', { type: 'expense', amountSatang: baht(1), accountId: 'cash', categoryId: 'food', date: '2026-09-01' }, noFiles, meta())).rejects.toBeInstanceOf(TransactionNotFoundError)
  })

  it('adds and removes attachments with the edit', async () => {
    const original = makeTx({ id: 'e1', type: 'expense', amountSatang: baht(85), accountId: 'cash', categoryId: 'food' })
    await database.transactions.add(original)
    await database.attachments.add({ id: 'old', transactionId: 'e1', fileName: 'old.jpg', mimeType: 'image/jpeg', sizeBytes: 3, createdAt: original.createdAt })
    await database.attachmentBlobs.add({ id: 'old', blob: new Blob(['abc']) })
    await repo.update('e1', draftFrom(original), { add: [{ blob: new Blob(['new!']), fileName: 'new.pdf', mimeType: 'application/pdf' }], remove: ['old'] }, meta())

    const attachments = createAttachmentsRepository(database)
    const rows = await attachments.listForTransaction('e1')
    expect(rows.map((r) => [r.fileName, r.sizeBytes])).toEqual([['new.pdf', 4]])
    expect(await database.attachmentBlobs.get('old')).toBeUndefined()
    expect((await attachments.getBlob(rows[0]!.id))?.size).toBe(4)
  })

  it('is atomic: if storing an attachment fails, the previous version stays exactly as it was', async () => {
    const original = makeTx({ id: 'e1', type: 'expense', amountSatang: baht(85), accountId: 'cash', categoryId: 'food' })
    await database.transactions.add(original)
    await database.attachments.add({ id: 'old', transactionId: 'e1', fileName: 'old.jpg', mimeType: 'image/jpeg', sizeBytes: 3, createdAt: original.createdAt })
    await database.attachmentBlobs.add({ id: 'old', blob: new Blob(['abc']) })
    vi.spyOn(database.attachmentBlobs, 'bulkAdd').mockRejectedValue(new Error('disk'))

    const error = await repo
      .update('e1', draftFrom(original, { amountSatang: baht(999) }), { add: [{ blob: new Blob(['x']), fileName: 'x.png', mimeType: 'image/png' }], remove: ['old'] }, meta())
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(StorageError)
    expect(await database.transactions.get('e1')).toEqual(original)
    expect(await database.attachments.get('old')).toBeDefined()
    expect(await database.attachmentBlobs.get('old')).toBeDefined()
    expect(await database.attachments.count()).toBe(1)
  })
})

describe('delete', () => {
  it('removes the transaction and its attachments, restoring the account balance', async () => {
    await database.transactions.add(makeTx({ id: 'e1', type: 'expense', amountSatang: baht(250), accountId: 'cash', categoryId: 'food' }))
    await database.attachments.add({ id: 'a1', transactionId: 'e1', fileName: 'r.jpg', mimeType: 'image/jpeg', sizeBytes: 1, createdAt: '2026-09-25T00:00:00Z' })
    await database.attachmentBlobs.add({ id: 'a1', blob: new Blob(['x']) })
    expect((await snapshot()).balances.get('cash')).toBe(baht(750))

    const deleted = await repo.delete('e1', meta())
    expect(deleted.id).toBe('e1')
    expect(await database.transactions.count()).toBe(0)
    expect(await database.attachments.count()).toBe(0)
    expect(await database.attachmentBlobs.count()).toBe(0)
    expect((await snapshot()).balances.get('cash')).toBe(baht(1_000))
  })

  it('makes a settled scheduled payment unpaid again', async () => {
    await database.scheduledPayments.add(makeScheduled({ id: 'sp', sourceId: 'rent', dueDate: '2026-09-01', status: 'paid', transactionId: 'e1', paidDate: '2026-09-01' }))
    await database.transactions.add(makeTx({ id: 'e1', type: 'expense', amountSatang: baht(7_700), accountId: 'bank', categoryId: 'food', scheduledPaymentId: 'sp' }))
    await repo.delete('e1', meta())
    const payment = await database.scheduledPayments.get('sp')
    expect(payment?.status).toBe('pending')
    expect(payment).not.toHaveProperty('transactionId')
    expect(payment).not.toHaveProperty('paidDate')
  })

  it('reports a missing transaction', async () => {
    await expect(repo.delete('ghost', meta())).rejects.toBeInstanceOf(TransactionNotFoundError)
  })
})

describe('debt payments', () => {
  const payment = (amount: Satang, interest: Satang = baht(0)) =>
    makeTx({ id: 'p1', type: 'debt_payment', amountSatang: amount, accountId: 'bank', debtId: 'home', principalSatang: (amount - interest) as Satang, interestSatang: interest, feeSatang: baht(0), date: '2026-09-10' })
  const outstanding = async (id: string) => (await snapshot()).debts.items.find((i) => i.debt.id === id)?.outstanding

  it('editing amount and interest updates principal paid, outstanding and progress', async () => {
    const original = payment(baht(10_000), baht(2_000))
    await database.transactions.add(original)
    expect(await outstanding('home')).toBe(baht(92_000))

    const updated = await repo.update('p1', draftFrom(original, { amountSatang: baht(12_000), principalSatang: baht(10_400), interestSatang: baht(1_500), feeSatang: baht(100) }), noFiles, meta())
    expect(updated).toMatchObject({ type: 'debt_payment', debtId: 'home', principalSatang: baht(10_400), interestSatang: baht(1_500), feeSatang: baht(100) })
    expect(await outstanding('home')).toBe(baht(100_000 - 10_400))
    const { debts, balances, totals } = await snapshot()
    expect(debts.progress?.paid).toBe(baht(10_400))
    expect(balances.get('bank')).toBe(baht(-2_000))
    expect(totals.expense).toBe(0)
    expect(totals.debtPayment).toBe(baht(12_000))
  })

  it('rejects a split that does not add up to the payment', async () => {
    const original = payment(baht(1_000))
    await database.transactions.add(original)
    await expect(repo.update('p1', draftFrom(original, { principalSatang: baht(0), interestSatang: baht(900), feeSatang: baht(200) }), noFiles, meta())).rejects.toMatchObject({
      issues: ['allocation_mismatch'],
    })
  })

  it('rejects principal larger than the outstanding balance, on create and on edit', async () => {
    const original = payment(baht(10_000))
    await database.transactions.add(original)
    await expect(repo.update('p1', draftFrom(original, { amountSatang: baht(100_001), principalSatang: baht(100_001) }), noFiles, meta())).rejects.toMatchObject({
      issues: ['principal_exceeds_outstanding'],
    })
    await expect(
      repo.create({ ...draftFrom(original), amountSatang: baht(90_001), principalSatang: baht(90_001), interestSatang: baht(0), feeSatang: baht(0) }, [], { ...meta(), id: 'p2' }),
    ).rejects.toMatchObject({ issues: ['principal_exceeds_outstanding'] })
    expect(await database.transactions.count()).toBe(1)
    expect(await outstanding('home')).toBe(baht(90_000))
  })

  it('stores an explicitly unallocated payment without reducing principal', async () => {
    const original = payment(baht(10_000))
    await database.transactions.add(original)
    const updated = await repo.update('p1', { ...draftFrom(original), allocation: 'unallocated' }, noFiles, meta())
    expect(updated).not.toHaveProperty('principalSatang')
    expect(await outstanding('home')).toBe(baht(100_000))
    expect((await snapshot()).debts.unallocated).toBe(baht(10_000))
  })

  it('deleting restores the outstanding amount and the bank balance', async () => {
    await database.transactions.add(payment(baht(10_000), baht(2_000)))
    await repo.delete('p1', meta())
    expect(await outstanding('home')).toBe(baht(100_000))
    expect((await snapshot()).balances.get('bank')).toBe(baht(10_000))
  })
})

describe('credit-card rule through edit and delete', () => {
  beforeEach(async () => {
    await database.transactions.bulkAdd([
      makeTx({ id: 'buy', type: 'expense', amountSatang: baht(3_000), accountId: 'card', categoryId: 'food', date: '2026-09-05' }),
      makeTx({ id: 'pay', type: 'debt_payment', amountSatang: baht(3_000), accountId: 'bank', toAccountId: 'card', debtId: 'cc', date: '2026-09-20' }),
    ])
  })

  it('starts with the purchase counted once and the card cleared', async () => {
    const { totals, balances, debts } = await snapshot()
    expect(totals.expense).toBe(baht(3_000))
    expect(totals.debtPayment).toBe(baht(3_000))
    expect(balances.get('card')).toBe(0)
    expect(debts.items.find((i) => i.debt.id === 'cc')?.outstanding).toBe(0)
  })

  it('editing the payment keeps it a debt payment to the card, never an expense', async () => {
    const pay = (await database.transactions.get('pay'))!
    const updated = await repo.update('pay', draftFrom(pay, { amountSatang: baht(1_000) }), noFiles, meta())
    expect(updated).toMatchObject({ type: 'debt_payment', toAccountId: 'card', debtId: 'cc' })
    expect(updated).not.toHaveProperty('categoryId')
    const { totals, balances, debts } = await snapshot()
    expect(totals.expense).toBe(baht(3_000))
    expect(totals.expenseCount).toBe(1)
    expect(balances.get('bank')).toBe(baht(9_000))
    expect(balances.get('card')).toBe(baht(-2_000))
    expect(debts.items.find((i) => i.debt.id === 'cc')?.outstanding).toBe(baht(2_000))
  })

  it('a category can never be attached to the payment', async () => {
    const pay = (await database.transactions.get('pay'))!
    await expect(repo.update('pay', draftFrom(pay, { categoryId: 'food' }), noFiles, meta())).resolves.not.toHaveProperty('categoryId')
  })

  it('deleting the payment puts the card debt back; expenses unchanged', async () => {
    await repo.delete('pay', meta())
    const { totals, balances, debts } = await snapshot()
    expect(totals.expense).toBe(baht(3_000))
    expect(totals.debtPayment).toBe(0)
    expect(balances.get('bank')).toBe(baht(10_000))
    expect(balances.get('card')).toBe(baht(-3_000))
    expect(debts.items.find((i) => i.debt.id === 'cc')?.outstanding).toBe(baht(3_000))
  })

  it('editing the purchase changes the card liability and spending', async () => {
    const buy = (await database.transactions.get('buy'))!
    await repo.update('buy', draftFrom(buy, { amountSatang: baht(3_500) }), noFiles, meta())
    const { totals, balances } = await snapshot()
    expect(totals.expense).toBe(baht(3_500))
    expect(balances.get('card')).toBe(baht(-500))
  })

  it('deleting the purchase removes the spending but keeps the payment separate', async () => {
    await repo.delete('buy', meta())
    const { totals, balances } = await snapshot()
    expect(totals.expense).toBe(0)
    expect(totals.debtPayment).toBe(baht(3_000))
    expect(balances.get('card')).toBe(baht(3_000))
  })
})

describe('transfers and income', () => {
  it('edits a transfer’s destination and requires one', async () => {
    const original = makeTx({ id: 't1', type: 'transfer', amountSatang: baht(500), accountId: 'bank', toAccountId: 'cash' })
    await database.transactions.add(original)
    await expect(repo.update('t1', draftFrom(original, { toAccountId: undefined }), noFiles, meta())).rejects.toMatchObject({ issues: ['to_account_required'] })
    await expect(repo.update('t1', draftFrom(original, { toAccountId: 'bank' }), noFiles, meta())).rejects.toMatchObject({ issues: ['same_account'] })
    const { totals } = await snapshot()
    expect(totals.income).toBe(0)
    expect(totals.expense).toBe(0)
  })

  it('income needs an income category (never an expense one)', async () => {
    const original = makeTx({ id: 'i1', type: 'income', amountSatang: baht(27_500), accountId: 'bank', categoryId: 'salary' })
    await database.transactions.add(original)
    await expect(repo.update('i1', draftFrom(original, { categoryId: 'food' }), noFiles, meta())).rejects.toMatchObject({ issues: ['category_not_income'] })
    await expect(repo.update('i1', draftFrom(original, { categoryId: undefined }), noFiles, meta())).rejects.toMatchObject({ issues: ['category_required'] })
    expect(await database.transactions.get('i1')).toEqual(original)
  })
})
