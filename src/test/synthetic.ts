/**
 * Test-only: a large, deterministic, entirely synthetic dataset (no real
 * data). Every record follows the domain rules (the integrity audit reports
 * no errors). Runs in tests and — for manual performance checks — in the dev
 * browser via dynamic import. All ids start with "syn-" so they are easy to
 * remove again.
 *
 * Default size: 30 accounts (5 credit cards) + 70 categories, 20 debts
 * (15 loans, 5 cards), 50 recurring rules, 100 budgets, 5,200 transactions
 * over 21 months, 50 attachments.
 */
import type { FinanceDatabase } from '@/db/dexie'
import { createRecurringObligationsRepository } from '@/db/repositories'
import type { Account, Attachment, AttachmentBlob, Budget, Category, Debt, Transaction } from '@/domain/entities'
import type { Satang } from '@/domain/money'

export const SYN_TODAY = '2026-09-26'
const NOW = `${SYN_TODAY}T03:00:00.000Z`

/** mulberry32: small deterministic PRNG. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0')
const MONTHS = Array.from({ length: 21 }, (_, i) => {
  const date = new Date(Date.UTC(2025, i, 1))
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`
})
const stamp = { createdAt: NOW, updatedAt: NOW }

export interface SyntheticOptions {
  transactions?: number
  attachments?: number
  /** Bytes per attachment. */
  attachmentBytes?: number
}

export async function seedSynthetic(database: FinanceDatabase, options: SyntheticOptions = {}) {
  const { transactions: txCount = 5_200, attachments: attachmentCount = 50, attachmentBytes = 20_000 } = options
  const rnd = random(20260926)
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rnd() * items.length)]!
  const amount = (min: number, max: number) => (Math.round((min + rnd() * (max - min)) * 100) * 1) as Satang
  const day = (month: string) => `${month}-${pad(1 + Math.floor(rnd() * 28))}`

  const assets: Account[] = Array.from({ length: 25 }, (_, i) => ({
    id: `syn-acc-${i}`,
    name: `บัญชีทดสอบ ${i + 1}`,
    kind: (['bank', 'cash', 'savings', 'e_wallet', 'bank'] as const)[i % 5]!,
    currency: 'THB',
    openingBalanceSatang: (1_000_000 * 100) as Satang,
    openingDate: '2025-01-01',
    sortOrder: i,
    ...stamp,
  }))
  const cards: Account[] = Array.from({ length: 5 }, (_, i) => ({
    id: `syn-card-${i}`,
    name: `บัตรทดสอบ ${i + 1}`,
    kind: 'credit_card',
    currency: 'THB',
    openingBalanceSatang: 0 as Satang,
    openingDate: '2025-01-01',
    sortOrder: 25 + i,
    ...stamp,
  }))
  const expenseCategories: Category[] = Array.from({ length: 55 }, (_, i) => ({
    id: `syn-exp-${i}`,
    kind: 'expense',
    name: `หมวดจ่าย ${i + 1}`,
    sortOrder: i,
    ...stamp,
  }))
  const incomeCategories: Category[] = Array.from({ length: 15 }, (_, i) => ({
    id: `syn-inc-${i}`,
    kind: 'income',
    name: `หมวดรับ ${i + 1}`,
    sortOrder: i,
    ...stamp,
  }))
  const loans: Debt[] = Array.from({ length: 15 }, (_, i) => ({
    id: `syn-loan-${i}`,
    name: `เงินกู้ทดสอบ ${i + 1}`,
    kind: (['mortgage', 'car_loan', 'personal_loan', 'installment', 'student_loan'] as const)[i % 5]!,
    openingBalanceSatang: (500_000 * 100) as Satang,
    openingDate: '2025-01-01',
    interestMethod: 'unknown',
    status: 'active',
    ...stamp,
  }))
  const cardDebts: Debt[] = cards.map((card, i) => ({
    id: `syn-cc-${i}`,
    name: card.name,
    kind: 'credit_card',
    openingBalanceSatang: 0 as Satang,
    openingDate: '2025-01-01',
    interestMethod: 'unknown',
    linkedAccountId: card.id,
    status: 'active',
    ...stamp,
  }))
  await database.accounts.bulkAdd([...assets, ...cards])
  await database.categories.bulkAdd([...expenseCategories, ...incomeCategories])
  await database.debts.bulkAdd([...loans, ...cardDebts])

  // Budgets: 100 unique month × category pairs.
  const budgets: Budget[] = Array.from({ length: 100 }, (_, i) => ({
    id: `syn-budget-${i}`,
    month: MONTHS[MONTHS.length - 1 - Math.floor(i / 20)]!,
    categoryId: expenseCategories[i % 20]!.id,
    limitSatang: amount(2_000, 20_000),
    ...stamp,
  }))
  await database.budgets.bulkAdd(budgets)

  // Recurring rules through the repository (it generates their occurrences).
  const obligations = createRecurringObligationsRepository(database)
  let generated = 0
  for (let i = 0; i < 50; i++) {
    await obligations.create(
      {
        name: `รายการประจำ ${i + 1}`,
        amountSatang: amount(100, 5_000),
        ...(i % 10 === 9 ? { kind: 'income' as const, categoryId: incomeCategories[i % 15]!.id } : { categoryId: expenseCategories[i % 55]!.id }),
        defaultAccountId: assets[i % 25]!.id,
        recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-06-01', dayOfMonth: 1 + (i % 28) },
      },
      { id: `syn-rule-${i}`, now: NOW, today: SYN_TODAY, newId: () => `syn-sp-${++generated}` },
    )
  }

  // Transactions: expenses, income, transfers, loan and card payments.
  const loanPrincipalPaid = new Map<string, number>()
  const transactions: Transaction[] = []
  for (let i = 0; i < txCount; i++) {
    const month = MONTHS[i % MONTHS.length]!
    const date = day(month)
    const roll = rnd()
    const base = { id: `syn-tx-${pad(i, 5)}`, date, ...stamp }
    if (roll < 0.62) {
      const onCard = rnd() < 0.2
      transactions.push({
        ...base,
        type: 'expense',
        amountSatang: amount(20, 3_000),
        accountId: onCard ? pick(cards).id : pick(assets).id,
        categoryId: pick(expenseCategories).id,
        description: `รายจ่ายทดสอบ ${i}`,
        ...(i % 7 === 0 ? { note: `บันทึก ${i}` } : {}),
      })
    } else if (roll < 0.77) {
      transactions.push({
        ...base,
        type: 'income',
        amountSatang: amount(1_000, 40_000),
        accountId: pick(assets).id,
        categoryId: pick(incomeCategories).id,
        description: `รายรับทดสอบ ${i}`,
      })
    } else if (roll < 0.87) {
      const from = pick(assets)
      let to = pick(assets)
      if (to.id === from.id) to = assets[(assets.indexOf(from) + 1) % assets.length]!
      transactions.push({ ...base, type: 'transfer', amountSatang: amount(100, 10_000), accountId: from.id, toAccountId: to.id })
    } else if (roll < 0.95) {
      const loan = pick(loans)
      const principal = amount(500, 2_000)
      if ((loanPrincipalPaid.get(loan.id) ?? 0) + principal > loan.openingBalanceSatang) continue
      loanPrincipalPaid.set(loan.id, (loanPrincipalPaid.get(loan.id) ?? 0) + principal)
      const interest = amount(50, 500)
      transactions.push({
        ...base,
        type: 'debt_payment',
        amountSatang: (principal + interest) as Satang,
        accountId: pick(assets).id,
        debtId: loan.id,
        principalSatang: principal,
        interestSatang: interest,
        feeSatang: 0 as Satang,
      })
    } else {
      const index = Math.floor(rnd() * cards.length)
      transactions.push({
        ...base,
        type: 'debt_payment',
        amountSatang: amount(500, 5_000),
        accountId: pick(assets).id,
        toAccountId: cards[index]!.id,
        debtId: cardDebts[index]!.id,
      })
    }
  }
  await database.transactions.bulkAdd(transactions)

  // Attachments on the first expenses (synthetic bytes, JPEG markers).
  const withReceipt = transactions.filter((tx) => tx.type === 'expense').slice(0, attachmentCount)
  const bytes = new Uint8Array(attachmentBytes)
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) % 256
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0)
  const attachments: Attachment[] = withReceipt.map((tx, i) => ({
    id: `syn-att-${i}`,
    transactionId: tx.id,
    fileName: `receipt-${i}.jpg`,
    mimeType: 'image/jpeg',
    sizeBytes: bytes.length,
    createdAt: NOW,
  }))
  const blobs: AttachmentBlob[] = attachments.map((a) => ({ id: a.id, blob: new Blob([bytes], { type: 'image/jpeg' }) }))
  await database.attachments.bulkAdd(attachments)
  await database.attachmentBlobs.bulkAdd(blobs)

  return { transactions: transactions.length, attachments: attachments.length }
}
