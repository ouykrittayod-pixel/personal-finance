/**
 * What the read-only Google Sheet shows: plain tables built from the data set,
 * one tab each. Amounts are baht numbers (for sums and filters in Sheets);
 * dates are "YYYY-MM-DD" text (sorts correctly, no time-zone conversion).
 * Pure: the same data always gives the same tables.
 */
import { getCategoryBudgetSummary, isOverallBudget } from '@/domain/budget'
import { debtPosition } from '@/domain/debts'
import type { Account, Budget, Category, Debt, Transaction } from '@/domain/entities'
import { toDecimalString, type Satang } from '@/domain/money'
import { accountBalances, monthTotals } from '@/domain/reporting'
import { formatDateTime } from '@/lib/formatting'
import { t, type MessageKey } from '@/lib/i18n'

export type Cell = string | number
export interface SheetTab {
  title: string
  header: string[]
  rows: Cell[][]
}

export interface SheetSource {
  accounts: readonly Account[]
  categories: readonly Category[]
  transactions: readonly Transaction[]
  debts: readonly Debt[]
  budgets: readonly Budget[]
}

export const SHEET_TITLE = 'การเงินส่วนตัว — ดูข้อมูล (แอปอัปเดตให้)'
export const TAB_TITLES = ['เกี่ยวกับ', 'สรุปรายเดือน', 'รายการ', 'บัญชี', 'หนี้', 'งบประมาณ'] as const

const baht = (amount: Satang): number => Number(toDecimalString(amount))
const label = (key: string) => t(key as MessageKey)

export function buildSheetTabs(source: SheetSource, updatedAt: string): SheetTab[] {
  const accountName = new Map(source.accounts.map((a) => [a.id, a.name]))
  const categoryName = new Map(source.categories.map((c) => [c.id, c.name]))
  const debtName = new Map(source.debts.map((d) => [d.id, d.name]))

  const months = [...new Set(source.transactions.map((tx) => tx.date.slice(0, 7)))].sort().reverse()
  const monthly: SheetTab = {
    title: 'สรุปรายเดือน',
    header: ['เดือน', 'รายรับ', 'รายจ่าย', 'ชำระหนี้', 'คงเหลือ (รายรับ − รายจ่าย − ชำระหนี้)'],
    rows: months.map((month) => {
      const m = monthTotals(source.transactions, month)
      return [month, baht(m.income), baht(m.expense), baht(m.debtPayment), baht((m.income - m.expense - m.debtPayment) as Satang)]
    }),
  }

  const transactions: SheetTab = {
    title: 'รายการ',
    header: ['วันที่', 'ประเภท', 'จำนวนเงิน', 'บัญชี', 'ไปยังบัญชี', 'หมวดหมู่', 'หนี้', 'รายละเอียด', 'หมายเหตุ'],
    rows: [...source.transactions]
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
      .map((tx) => [
        tx.date,
        label(`txType.${tx.type}`),
        baht(tx.amountSatang),
        accountName.get(tx.accountId) ?? '',
        tx.toAccountId ? (accountName.get(tx.toAccountId) ?? '') : '',
        tx.categoryId ? (categoryName.get(tx.categoryId) ?? '') : '',
        tx.debtId ? (debtName.get(tx.debtId) ?? '') : '',
        tx.description ?? '',
        tx.note ?? '',
      ]),
  }

  const balances = accountBalances(source.accounts, source.transactions)
  const accounts: SheetTab = {
    title: 'บัญชี',
    header: ['บัญชี', 'ประเภท', 'ยอดตั้งต้น', 'วันที่ตั้งต้น', 'ยอดปัจจุบัน (ติดลบ = ค้างชำระ)', 'สถานะ'],
    rows: [...source.accounts]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'th'))
      .map((a) => [a.name, label(`account.kind.${a.kind}`), baht(a.openingBalanceSatang), a.openingDate, baht(balances.get(a.id) ?? a.openingBalanceSatang), a.archivedAt ? 'เก็บถาวร' : 'ใช้งาน']),
  }

  const debts: SheetTab = {
    title: 'หนี้',
    header: ['หนี้', 'ประเภท', 'ยอดคงเหลือ', 'สถานะ'],
    rows: [...source.debts]
      .sort((a, b) => a.name.localeCompare(b.name, 'th'))
      .map((d) => {
        const position = debtPosition(d, [...source.accounts], [...source.transactions])
        return [d.name, label(`debts.kind.${d.kind}`), position.outstanding === null ? '' : baht(position.outstanding), d.archivedAt ? 'เก็บถาวร' : label(`debts.status.${d.status}`)]
      }),
  }

  const budgets: SheetTab = {
    title: 'งบประมาณ',
    header: ['เดือน', 'หมวดหมู่', 'วงเงิน', 'ใช้ไป', 'คงเหลือ'],
    rows: [...source.budgets]
      .sort((a, b) => b.month.localeCompare(a.month) || (categoryName.get(a.categoryId) ?? '').localeCompare(categoryName.get(b.categoryId) ?? '', 'th'))
      .map((b) => {
        const line = getCategoryBudgetSummary(b, [...source.transactions])
        return [b.month, isOverallBudget(b) ? 'รวมทั้งเดือน' : (categoryName.get(b.categoryId) ?? ''), baht(line.limit), baht(line.spent), baht(line.remaining)]
      }),
  }

  const about: SheetTab = {
    title: 'เกี่ยวกับ',
    header: ['ชีตนี้แอป "การเงินส่วนตัว" สร้างและอัปเดตให้อัตโนมัติทุกครั้งที่ซิงก์'],
    rows: [
      ['ใช้ดูอย่างเดียว — แก้ข้อมูลในแอปเท่านั้น ถ้าแก้ในชีต แอปจะเขียนทับในรอบถัดไป'],
      ['จำนวนเงินเป็นบาท วันที่เป็น ปี-เดือน-วัน (ค.ศ.)'],
      [`อัปเดตล่าสุด: ${formatDateTime(updatedAt)}`],
      [`รายการทั้งหมด ${source.transactions.length.toLocaleString('th-TH')} รายการ`],
    ],
  }

  return [about, monthly, transactions, accounts, debts, budgets]
}
