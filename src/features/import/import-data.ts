/**
 * The only database access of the Import Center: READ existing accounts,
 * categories, debts and transactions (for matching and duplicate checks).
 * Phase 15A writes nothing.
 */
import { accountsRepository, categoriesRepository, debtsRepository, transactionsRepository } from '@/db/repositories'
import type { ExistingData } from '@/domain/import'

export async function loadExistingData(): Promise<ExistingData> {
  const [accounts, categories, debts, transactions] = await Promise.all([
    accountsRepository.listAll(),
    categoriesRepository.listAll(),
    debtsRepository.listAll(),
    transactionsRepository.listAll(),
  ])
  return { accounts, categories, debts, transactions }
}
