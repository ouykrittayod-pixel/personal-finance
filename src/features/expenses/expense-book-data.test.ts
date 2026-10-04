import { describe, expect, it } from 'vitest'
import type { Transaction } from '@/domain/entities'
import type { LedgerRawData } from '@/features/transactions/ledger-data'
import { t } from '@/lib/i18n'
import { baht, makeAccount, makeCategory, makeTx } from '@/test/factories'
import { ALL, buildExpenseBook, defaultExpenseFilters, expenseSummary, type ExpenseFilters } from './expense-book-data'

const TODAY = '2026-10-08' // Thursday; the week starts Monday 5 Oct

const raw = (transactions: Transaction[]): LedgerRawData => ({
  transactions,
  accounts: [makeAccount({ id: 'kbank', name: 'KBank', kind: 'bank' }), makeAccount({ id: 'card', name: 'บัตร', kind: 'credit_card' })],
  categories: [
    makeCategory({ id: 'food', name: 'อาหาร', icon: '🍜', sortOrder: 0 }),
    makeCategory({ id: 'travel', name: 'เดินทาง', icon: '🚆', sortOrder: 1 }),
    makeCategory({ id: 'salary', name: 'เงินเดือน', kind: 'income' }),
  ],
  debts: [],
  transactionIdsWithAttachments: new Set(['lunch']),
})

const data = raw([
  makeTx({ id: 'lunch', type: 'expense', amountSatang: baht(65), accountId: 'kbank', categoryId: 'food', date: '2026-10-08', description: 'ข้าวกะเพราไก่ + ไข่ดาว' }),
  makeTx({ id: 'coffee', type: 'expense', amountSatang: baht(120), accountId: 'card', categoryId: 'food', date: '2026-10-08', description: 'Starbucks' }),
  makeTx({ id: 'bts', type: 'expense', amountSatang: baht(80), accountId: 'kbank', categoryId: 'travel', date: '2026-10-07' }),
  makeTx({ id: 'rent', type: 'expense', amountSatang: baht(3_750), accountId: 'kbank', categoryId: 'food', date: '2026-10-01', scheduledPaymentId: 'sp-rent' }),
  makeTx({ id: 'last-month', type: 'expense', amountSatang: baht(500), accountId: 'kbank', categoryId: 'travel', date: '2026-09-30' }),
  // Never expenses:
  makeTx({ id: 'card-payment', type: 'debt_payment', amountSatang: baht(2_500), accountId: 'kbank', debtId: 'kbank-card', date: '2026-10-08' }),
  makeTx({ id: 'move', type: 'transfer', amountSatang: baht(700), accountId: 'kbank', toAccountId: 'card', date: '2026-10-08' }),
  makeTx({ id: 'pay', type: 'income', amountSatang: baht(28_000), accountId: 'kbank', categoryId: 'salary', date: '2026-10-08' }),
  makeTx({ id: 'fix', type: 'adjustment', amountSatang: baht(-50), accountId: 'kbank', date: '2026-10-08' }),
])

const filters = (overrides: Partial<ExpenseFilters> = {}): ExpenseFilters => ({ ...defaultExpenseFilters(TODAY), ...overrides })

describe('daily expense book', () => {
  it('summary counts expenses only: today, this week (from Monday), this month', () => {
    expect(expenseSummary(data.transactions, TODAY)).toEqual({ today: baht(185), week: baht(265), month: baht(4_015) })
  })

  it('lists only expenses, grouped by day (newest first) with each day’s total; bills paid from the plan are expenses too', () => {
    const book = buildExpenseBook(data, filters(), TODAY, 50)
    expect(book.days.map((d) => [d.date, d.label, d.total, d.rows.map((r) => r.id)])).toEqual([
      ['2026-10-08', t('expenses.day.today'), baht(185), expect.arrayContaining(['lunch', 'coffee'])],
      ['2026-10-07', t('expenses.day.yesterday'), baht(80), ['bts']],
      ['2026-10-01', expect.any(String), baht(3_750), ['rent']],
    ])
    expect(book.total).toBe(baht(4_015))
    expect(book.matchCount).toBe(4)
    const lunch = book.days[0]!.rows.find((r) => r.id === 'lunch')!
    expect(lunch).toMatchObject({ title: 'ข้าวกะเพราไก่ + ไข่ดาว', categoryLabel: 'อาหาร', categoryIcon: '🍜', accountLabel: 'KBank', hasAttachment: true })
  })

  it('a day total covers every matching expense of that day, also those not shown yet', () => {
    const book = buildExpenseBook(data, filters(), TODAY, 1)
    expect(book.days).toHaveLength(1)
    expect(book.days[0]).toMatchObject({ total: baht(185), count: 2 })
    expect(book.days[0]!.rows).toHaveLength(1)
  })

  it('filters by category, account, amount range and search', () => {
    const ids = (f: Partial<ExpenseFilters>) => buildExpenseBook(data, filters(f), TODAY, 50).days.flatMap((d) => d.rows.map((r) => r.id)).sort()
    expect(ids({ categoryId: 'travel' })).toEqual(['bts'])
    expect(ids({ accountId: 'card' })).toEqual(['coffee'])
    expect(ids({ minAmount: '80', maxAmount: '120' })).toEqual(['bts', 'coffee'])
    expect(ids({ search: 'starbucks' })).toEqual(['coffee'])
    expect(ids({ preset: 'custom', customStart: '2026-09-01', customEnd: '2026-09-30' })).toEqual(['last-month'])
    expect(ids({ categoryId: ALL, accountId: ALL })).toHaveLength(4)
  })

  it('an amount that is not a number is flagged and ignored', () => {
    const book = buildExpenseBook(data, filters({ minAmount: 'abc' }), TODAY, 50)
    expect(book.amountInvalid).toBe(true)
    expect(book.matchCount).toBe(4)
  })

  it('shows where the money went by category, with shares of the total', () => {
    const book = buildExpenseBook(data, filters(), TODAY, 50)
    expect(book.categories.map((c) => [c.id, c.amount, c.shareBps])).toEqual([
      ['food', baht(3_935), 9801],
      ['travel', baht(80), 199],
    ])
  })

  it('empty states: no expenses at all vs nothing matching', () => {
    expect(buildExpenseBook(raw([]), filters(), TODAY, 50).emptyReason).toBe('no_data')
    expect(buildExpenseBook(data, filters({ search: 'ไม่มีแน่นอน' }), TODAY, 50).emptyReason).toBe('no_match')
  })
})
