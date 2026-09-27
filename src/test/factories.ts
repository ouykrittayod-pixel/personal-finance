/**
 * Test-only record builders. Used to arrange scenarios inside tests; never
 * imported by app code and never written to a real user's database.
 */
import type { Account, Category, Debt, RecurringObligation, ScheduledPayment, Transaction } from '@/domain/entities'
import { satang, type Satang } from '@/domain/money'

const STAMP = '2026-01-01T00:00:00.000Z'
let counter = 0
const nextId = (prefix: string) => `${prefix}-${++counter}`

/** Whole baht → satang, for readable test amounts. */
export const baht = (value: number): Satang => satang(value * 100)

export function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: nextId('acc'),
    name: 'บัญชี',
    kind: 'bank',
    currency: 'THB',
    openingBalanceSatang: satang(0),
    openingDate: '2026-01-01',
    sortOrder: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  }
}

export function makeCategory(overrides: Partial<Category> = {}): Category {
  return { id: nextId('cat'), kind: 'expense', name: 'หมวด', sortOrder: 0, createdAt: STAMP, updatedAt: STAMP, ...overrides }
}

export function makeTx(overrides: Partial<Transaction> & Pick<Transaction, 'type' | 'amountSatang' | 'accountId'>): Transaction {
  return { id: nextId('tx'), date: '2026-09-15', createdAt: STAMP, updatedAt: STAMP, ...overrides }
}

export function makeDebt(overrides: Partial<Debt> = {}): Debt {
  return {
    id: nextId('debt'),
    name: 'หนี้',
    kind: 'personal_loan',
    principalSatang: satang(0),
    openingBalanceSatang: satang(0),
    openingDate: '2026-01-01',
    interestMethod: 'none',
    status: 'active',
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  }
}

export function makeObligation(overrides: Partial<RecurringObligation> = {}): RecurringObligation {
  return {
    id: nextId('obl'),
    name: 'ค่าใช้จ่ายประจำ',
    expectedAmountSatang: satang(0),
    variableAmount: false,
    recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-01-01', dayOfMonth: 1 },
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  }
}

export function makeScheduled(overrides: Partial<ScheduledPayment> & Pick<ScheduledPayment, 'sourceId' | 'dueDate'>): ScheduledPayment {
  return {
    id: nextId('sp'),
    sourceType: 'obligation',
    expectedAmountSatang: satang(0),
    status: 'pending',
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  }
}
