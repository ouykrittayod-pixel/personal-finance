import type { Transaction } from '@/domain/entities'
import { t } from '@/lib/i18n'

export interface TransactionNames {
  categoryName?: string
  debtName?: string
  toAccountName?: string
}

/** "ชำระบัตรเครดิต KBank" — avoids doubling when the debt name already starts with "ชำระ". */
export function payDebtLabel(debtName: string): string {
  return debtName.startsWith('ชำระ') ? debtName : t('ledger.payDebt', { name: debtName })
}

/**
 * Row title for a transaction, used everywhere lists show transactions:
 * what the user wrote first, then the most specific name we know.
 */
export function describeTransaction(
  tx: Pick<Transaction, 'type' | 'description' | 'payee' | 'note'>,
  names: TransactionNames = {},
): string {
  if (tx.description) return tx.description
  if (tx.payee) return tx.payee
  if (tx.type === 'debt_payment') return names.debtName ? payDebtLabel(names.debtName) : t('txType.debt_payment')
  if (tx.type === 'transfer' && names.toAccountName) return t('ledger.transferTo', { name: names.toAccountName })
  if (names.categoryName) return names.categoryName
  if (tx.note) return tx.note
  return t(`txType.${tx.type}`)
}
