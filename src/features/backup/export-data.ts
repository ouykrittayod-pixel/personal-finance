/**
 * Data exports — for reading or analysing elsewhere, NOT for restoring (use a
 * backup for that). Read-only: exporting never writes to the database.
 */
import type { FinanceDatabase } from '@/db/dexie'
import type { Account, Category, Debt, Transaction } from '@/domain/entities'
import { toDecimalString, type Satang } from '@/domain/money'
import { formatDate } from '@/lib/dates'
import { t } from '@/lib/i18n'
import { BACKUP_CURRENCY } from './format'

export const DATA_EXPORT_FORMAT = 'personal-finance-data-export'

export const dataExportFileName = (today: string) => `personal-finance-data-${today}.json`
export const csvExportFileName = (today: string) => `personal-finance-transactions-${today}.csv`

/** All financial records (attachment metadata only — no files). Amounts in integer satang. */
export async function exportDataJson(database: FinanceDatabase, exportedAt: string): Promise<Blob> {
  const [accounts, categories, transactions, recurringObligations, scheduledPayments, debts, budgets, attachments] = await Promise.all([
    database.accounts.toArray(),
    database.categories.toArray(),
    database.transactions.orderBy('date').toArray(),
    database.recurringObligations.toArray(),
    database.scheduledPayments.orderBy('dueDate').toArray(),
    database.debts.toArray(),
    database.budgets.orderBy('month').toArray(),
    database.attachments.toArray(),
  ])
  const payload = {
    format: DATA_EXPORT_FORMAT,
    exportedAt,
    currency: BACKUP_CURRENCY,
    amountUnit: 'satang',
    note: 'Data export (not a backup): amounts are integer satang (฿1 = 100). Attachment files are not included.',
    accounts,
    categories,
    transactions,
    recurringObligations,
    scheduledPayments,
    debts,
    budgets,
    attachments,
  }
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
}

export const CSV_COLUMNS = [
  'วันที่',
  'ประเภท',
  'จำนวนเงิน',
  'หมวดหมู่',
  'บัญชี',
  'รายละเอียด',
  'หมายเหตุ',
  'หนี้',
  'เงินต้น',
  'ดอกเบี้ย',
  'ค่าธรรมเนียม',
] as const

/** RFC 4180 quoting; text that a spreadsheet would run as a formula is prefixed with ' (CSV injection). */
function cell(value: string, isText = true): string {
  const safe = isText && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

const amount = (value: Satang | undefined) => (value === undefined ? '' : toDecimalString(value))

export function transactionsToCsv(
  transactions: readonly Transaction[],
  accounts: readonly Account[],
  categories: readonly Category[],
  debts: readonly Debt[],
): string {
  const accountName = new Map(accounts.map((a) => [a.id, a.name]))
  const categoryName = new Map(categories.map((c) => [c.id, c.name]))
  const debtName = new Map(debts.map((d) => [d.id, d.name]))
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  const rows = sorted.map((tx) => {
    const from = accountName.get(tx.accountId) ?? ''
    const account = tx.toAccountId ? `${from} → ${accountName.get(tx.toAccountId) ?? ''}` : from
    return [
      // dd/mm/yyyy like the app (Excel with a Thai or day-first region reads it as a date).
      cell(formatDate(tx.date), false),
      cell(t(`txType.${tx.type}`)),
      cell(toDecimalString(tx.amountSatang), false),
      cell(tx.categoryId ? (categoryName.get(tx.categoryId) ?? '') : ''),
      cell(account),
      cell(tx.description ?? ''),
      cell(tx.note ?? ''),
      cell(tx.debtId ? (debtName.get(tx.debtId) ?? '') : ''),
      cell(amount(tx.principalSatang), false),
      cell(amount(tx.interestSatang), false),
      cell(amount(tx.feeSatang), false),
    ].join(',')
  })
  // UTF-8 BOM so Excel opens Thai text correctly; CRLF line endings.
  return `﻿${[CSV_COLUMNS.join(','), ...rows].join('\r\n')}\r\n`
}

export async function exportTransactionsCsv(database: FinanceDatabase): Promise<Blob> {
  const [transactions, accounts, categories, debts] = await Promise.all([
    database.transactions.toArray(),
    database.accounts.toArray(),
    database.categories.toArray(),
    database.debts.toArray(),
  ])
  return new Blob([transactionsToCsv(transactions, accounts, categories, debts)], { type: 'text/csv;charset=utf-8' })
}
