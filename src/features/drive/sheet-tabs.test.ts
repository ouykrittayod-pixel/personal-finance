import { describe, expect, it } from 'vitest'
import { satang } from '@/domain/money'
import { baht, makeAccount, makeCategory, makeDebt, makeTx } from '@/test/factories'
import { buildSheetTabs, TAB_TITLES } from './sheet-tabs'

const source = () => ({
  accounts: [makeAccount({ id: 'kbank', name: 'KBank', openingBalanceSatang: baht(10_000) }), makeAccount({ id: 'card', name: 'บัตร', kind: 'credit_card', sortOrder: 1 })],
  categories: [makeCategory({ id: 'food', name: 'อาหาร' }), makeCategory({ id: 'salary', name: 'เงินเดือน', kind: 'income' })],
  transactions: [
    makeTx({ id: 't1', type: 'income', amountSatang: baht(27_500), accountId: 'kbank', categoryId: 'salary', date: '2026-09-25' }),
    makeTx({ id: 't2', type: 'expense', amountSatang: satang(12_550), accountId: 'card', categoryId: 'food', date: '2026-10-02', description: '=HYPERLINK("x")' }),
    makeTx({ id: 't3', type: 'expense', amountSatang: baht(300), accountId: 'kbank', categoryId: 'food', date: '2026-10-01' }),
  ],
  debts: [makeDebt({ id: 'loan', name: 'สินเชื่อรถ', kind: 'car_loan', openingBalanceSatang: baht(200_000) })],
  budgets: [{ id: 'b1', month: '2026-10', categoryId: 'food', limitSatang: baht(1_000), createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' }],
})

describe('Google Sheet tables', () => {
  const tabs = buildSheetTabs(source(), '2026-10-04T05:00:00.000Z')
  const tab = (title: string) => tabs.find((t) => t.title === title)!

  it('has the tabs in a fixed order, each with a header', () => {
    expect(tabs.map((t) => t.title)).toEqual([...TAB_TITLES])
    for (const t of tabs) expect(t.header.length).toBeGreaterThan(0)
  })

  it('lists transactions newest first, with Thai labels and baht amounts; text stays text', () => {
    const rows = tab('รายการ').rows
    expect(rows.map((r) => r[0])).toEqual(['2026-10-02', '2026-10-01', '2026-09-25'])
    expect(rows[0]).toEqual(['2026-10-02', 'รายจ่าย', 125.5, 'บัตร', '', 'อาหาร', '', '=HYPERLINK("x")', ''])
    expect(rows[2]!.slice(1, 4)).toEqual(['รายรับ', 27500, 'KBank'])
  })

  it('monthly summary: income, expenses, debt payments and what is left, newest month first', () => {
    expect(tab('สรุปรายเดือน').rows).toEqual([
      ['2026-10', 0, 425.5, 0, -425.5],
      ['2026-09', 27500, 0, 0, 27500],
    ])
  })

  it('account balances (liabilities negative) and budget use', () => {
    expect(tab('บัญชี').rows.map((r) => [r[0], r[4]])).toEqual([
      ['KBank', 37200],
      ['บัตร', -125.5],
    ])
    expect(tab('งบประมาณ').rows).toEqual([['2026-10', 'อาหาร', 1000, 425.5, 574.5]])
    expect(tab('หนี้').rows).toEqual([['สินเชื่อรถ', 'สินเชื่อรถยนต์', 200000, 'กำลังผ่อน']])
  })

  it('the about tab says it is read-only', () => {
    expect(JSON.stringify(tab('เกี่ยวกับ'))).toContain('ใช้ดูอย่างเดียว')
  })
})
