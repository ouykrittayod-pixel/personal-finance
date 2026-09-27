import { describe, expect, it } from 'vitest'
import { baht, makeAccount, makeCategory, makeDebt, makeTx } from '@/test/factories'
import { buildLedger, defaultFilters, resolveRange, type LedgerFilters, type LedgerRawData } from './ledger-data'

const TODAY = '2026-09-25'

const raw: LedgerRawData = {
  accounts: [
    makeAccount({ id: 'cash', name: 'เงินสด', kind: 'cash' }),
    makeAccount({ id: 'bank', name: 'KBank', kind: 'bank' }),
    makeAccount({ id: 'card', name: 'บัตรเครดิต', kind: 'credit_card' }),
  ],
  categories: [
    makeCategory({ id: 'food', name: 'อาหาร', icon: '🍚' }),
    makeCategory({ id: 'drink', name: 'เครื่องดื่ม', icon: '☕' }),
  ],
  debts: [makeDebt({ id: 'cc', name: 'บัตรเครดิต KBank', kind: 'credit_card', linkedAccountId: 'card' }), makeDebt({ id: 'd2' })],
  transactions: [
    makeTx({ id: 'lunch', type: 'expense', amountSatang: baht(85), accountId: 'cash', categoryId: 'food', description: 'ข้าวกลางวัน', date: '2026-09-25', createdAt: '2026-09-25T05:00:00Z' }),
    makeTx({ id: 'coffee', type: 'expense', amountSatang: baht(60), accountId: 'cash', categoryId: 'drink', description: 'กาแฟ', date: '2026-09-25', createdAt: '2026-09-25T09:00:00Z' }),
    makeTx({ id: 'salary', type: 'income', amountSatang: baht(27_500), accountId: 'bank', description: 'เงินเดือน', date: '2026-09-24' }),
    makeTx({ id: 'pay', type: 'debt_payment', amountSatang: baht(2_500), accountId: 'bank', toAccountId: 'card', debtId: 'cc', date: '2026-09-24' }),
    makeTx({ id: 'pay2', type: 'debt_payment', amountSatang: baht(500), accountId: 'bank', debtId: 'missing', date: '2026-09-23' }),
    makeTx({ id: 'move', type: 'transfer', amountSatang: baht(1_000), accountId: 'bank', toAccountId: 'cash', date: '2026-09-22' }),
    makeTx({ id: 'old', type: 'expense', amountSatang: baht(999), accountId: 'cash', categoryId: 'food', date: '2026-08-15' }),
  ],
  transactionIdsWithAttachments: new Set(['lunch']),
}

const filters = (overrides: Partial<LedgerFilters> = {}): LedgerFilters => ({ ...defaultFilters(TODAY), ...overrides })
const ids = (model: ReturnType<typeof buildLedger>) => model.groups.flatMap((g) => g.rows.map((r) => r.id))

describe('buildLedger', () => {
  it('shows this month, newest first, grouped by date with Thai long dates', () => {
    const model = buildLedger(raw, filters(), TODAY, 50)
    expect(ids(model)).toEqual(['coffee', 'lunch', 'salary', 'pay', 'pay2', 'move'])
    expect(model.groups.map((g) => g.label)).toEqual(['25 กันยายน 2026', '24 กันยายน 2026', '23 กันยายน 2026', '22 กันยายน 2026'])
    expect(model.matchCount).toBe(6)
    expect(model.emptyReason).toBeNull()
  })

  it('summarises the period: income, expenses and debt payments separately', () => {
    const { summary } = buildLedger(raw, filters(), TODAY, 50)
    expect(summary.income).toBe(baht(27_500))
    expect(summary.expense).toBe(baht(145)) // debt payments and the transfer are excluded
    expect(summary.debtPayment).toBe(baht(3_000))
  })

  it('keeps the summary for the whole period when type or search filters apply', () => {
    const { summary } = buildLedger(raw, filters({ type: 'income', search: 'กาแฟ' }), TODAY, 50)
    expect(summary.expense).toBe(baht(145))
  })

  it('labels debt payments with the debt name, falling back to ชำระหนี้', () => {
    const rows = buildLedger(raw, filters(), TODAY, 50).groups.flatMap((g) => g.rows)
    expect(rows.find((r) => r.id === 'pay')).toMatchObject({ title: 'ชำระบัตรเครดิต KBank', type: 'debt_payment', accountLabel: 'KBank', toAccountLabel: 'บัตรเครดิต' })
    expect(rows.find((r) => r.id === 'pay2')?.title).toBe('ชำระหนี้')
    expect(rows.find((r) => r.id === 'move')?.title).toBe('โอนไป เงินสด')
  })

  it('marks rows with attachments (from index keys only)', () => {
    const rows = buildLedger(raw, filters(), TODAY, 50).groups.flatMap((g) => g.rows)
    expect(rows.find((r) => r.id === 'lunch')?.hasAttachment).toBe(true)
    expect(rows.find((r) => r.id === 'coffee')?.hasAttachment).toBe(false)
  })

  it.each([
    ['description', 'ข้าวกลาง', ['lunch']],
    ['category', 'เครื่องดื่ม', ['coffee']],
    ['account', 'kbank', ['salary', 'pay', 'pay2', 'move']],
    ['several terms', 'อาหาร เงินสด', ['lunch']],
  ])('searches by %s', (_label, search, expected) => {
    expect(ids(buildLedger(raw, filters({ search }), TODAY, 50))).toEqual(expected)
  })

  it('filters by type without changing the order', () => {
    expect(ids(buildLedger(raw, filters({ type: 'debt_payment' }), TODAY, 50))).toEqual(['pay', 'pay2'])
    expect(ids(buildLedger(raw, filters({ type: 'transfer' }), TODAY, 50))).toEqual(['move'])
    expect(ids(buildLedger(raw, filters({ type: 'expense' }), TODAY, 50))).toEqual(['coffee', 'lunch'])
  })

  it('filters by date presets', () => {
    expect(ids(buildLedger(raw, filters({ preset: 'today' }), TODAY, 50))).toEqual(['coffee', 'lunch'])
    // Week of Friday 25 Sep starts Monday 21 Sep.
    expect(ids(buildLedger(raw, filters({ preset: 'week' }), TODAY, 50))).toEqual(['coffee', 'lunch', 'salary', 'pay', 'pay2', 'move'])
  })

  it('supports a custom range and swaps a reversed one', () => {
    const custom = filters({ preset: 'custom', customStart: '2026-08-01', customEnd: '2026-09-22' })
    expect(ids(buildLedger(raw, custom, TODAY, 50))).toEqual(['move', 'old'])
    const reversed = buildLedger(raw, { ...custom, customStart: '2026-09-22', customEnd: '2026-08-01' }, TODAY, 50)
    expect(reversed.rangeReversed).toBe(true)
    expect(ids(reversed)).toEqual(['move', 'old'])
    expect(resolveRange(custom, TODAY).range).toEqual({ start: '2026-08-01', end: '2026-09-22' })
  })

  it('limits rendered rows for large histories', () => {
    const many: LedgerRawData = {
      ...raw,
      transactions: Array.from({ length: 180 }, (_, i) =>
        makeTx({ id: `t${i}`, type: 'expense', amountSatang: baht(1), accountId: 'cash', date: '2026-09-10', createdAt: `2026-09-10T00:00:${String(i % 60).padStart(2, '0')}.${String(i).padStart(3, '0')}Z` }),
      ),
    }
    const model = buildLedger(many, filters(), TODAY, 50)
    expect(model.shownCount).toBe(50)
    expect(model.matchCount).toBe(180)
  })

  it('explains empty results', () => {
    expect(buildLedger({ ...raw, transactions: [] }, filters(), TODAY, 50).emptyReason).toBe('no_data')
    expect(buildLedger(raw, filters({ search: 'ไม่มีแน่นอน' }), TODAY, 50).emptyReason).toBe('no_search')
    expect(buildLedger(raw, filters({ preset: 'custom', customStart: '2025-01-01', customEnd: '2025-01-31' }), TODAY, 50).emptyReason).toBe('no_period')
  })
})
