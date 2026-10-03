/**
 * SYNTHETIC test data for the Phase 19 encryption / cloud proof. Built in
 * memory from constants only: this module does not import the database and
 * never reads real records. Every name says SYNTHETIC.
 */
import { uuidV5 } from '@/lib/ids/deterministic'

export interface SyntheticItem {
  recordType: `synthetic_${string}`
  recordId: string
  value: Record<string, unknown>
}

/** The Phase 19 reference record. */
export const SYNTHETIC_RECORD = { type: 'expense', amount: 1250, category: 'food', note: 'Synthetic test record' } as const

const id = (kind: string, n: number) => uuidV5(`phase19-synthetic:${kind}:${n}`)
const range = (count: number) => Array.from({ length: count }, (_, i) => i + 1)

/** 5 accounts, 10 categories, 20 transactions, 2 debts, 3 recurring obligations, 2 budgets, + the reference record (43 items). */
export function buildSyntheticDataset(): SyntheticItem[] {
  const accounts = range(5).map((n) => ({
    recordType: 'synthetic_account' as const,
    recordId: id('account', n),
    value: {
      id: id('account', n),
      name: `SYNTHETIC Account ${n}`,
      kind: n === 5 ? 'credit_card' : 'bank',
      openingBalanceSatang: n * 100_000,
      openingDate: '2026-01-01',
    },
  }))
  const categories = range(10).map((n) => ({
    recordType: 'synthetic_category' as const,
    recordId: id('category', n),
    value: { id: id('category', n), name: `SYNTHETIC Category ${n}`, kind: n <= 8 ? 'expense' : 'income', sortOrder: n },
  }))
  const transactions = range(20).map((n) => ({
    recordType: 'synthetic_transaction' as const,
    recordId: id('transaction', n),
    value: {
      id: id('transaction', n),
      type: n % 5 === 0 ? 'income' : 'expense',
      amountSatang: 1_000 + n * 137,
      accountId: id('account', (n % 5) + 1),
      categoryId: id('category', (n % 10) + 1),
      date: `2026-09-${String(n).padStart(2, '0')}`,
      description: `SYNTHETIC ธุรกรรม ${n}`,
      tags: n % 3 === 0 ? ['synthetic'] : [],
    },
  }))
  const debts = range(2).map((n) => ({
    recordType: 'synthetic_debt' as const,
    recordId: id('debt', n),
    value: {
      id: id('debt', n),
      name: `SYNTHETIC Loan ${n}`,
      kind: 'personal_loan',
      openingBalanceSatang: n * 5_000_000,
      annualRatePercent: 7.5,
      status: 'active',
    },
  }))
  const recurring = range(3).map((n) => ({
    recordType: 'synthetic_recurring' as const,
    recordId: id('recurring', n),
    value: {
      id: id('recurring', n),
      name: `SYNTHETIC Bill ${n}`,
      amountSatang: 50_000 * n,
      recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-01-01', dayOfMonth: n * 5 },
    },
  }))
  const budgets = range(2).map((n) => ({
    recordType: 'synthetic_budget' as const,
    recordId: id('budget', n),
    value: { id: id('budget', n), month: '2026-09', categoryId: id('category', n), limitSatang: 600_000 * n, note: null },
  }))
  const reference = { recordType: 'synthetic_expense' as const, recordId: id('reference', 1), value: { ...SYNTHETIC_RECORD } }
  return [...accounts, ...categories, ...transactions, ...debts, ...recurring, ...budgets, reference]
}

export const SYNTHETIC_RECORD_TYPES = [...new Set(buildSyntheticDataset().map((item) => item.recordType))]
