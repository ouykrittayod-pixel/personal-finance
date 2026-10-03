/**
 * Phase 18 — v1 → v2 migration time (fake IndexedDB in Node; a browser is
 * usually faster). Timings are printed; bounds are generous so the test only
 * catches pathological slowdowns. Synthetic data only; nothing financial is logged.
 */
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import type { ScheduledPayment, Transaction } from '@/domain/entities'
import { occurrenceId } from '@/domain/identity'
import { makeAccount, makeScheduled, makeTx, baht } from '@/test/factories'
import { seedRepresentative } from '@/test/representative'
import { seedSynthetic } from '@/test/synthetic'
import { FinanceDatabase } from '../dexie'
import { SCHEMA_VERSIONS } from '../schema'

const BUSINESS = [
  'accounts',
  'categories',
  'transactions',
  'recurringObligations',
  'scheduledPayments',
  'debts',
  'budgets',
  'attachments',
  'attachmentBlobs',
  'meta',
]
let n = 0
const names: string[] = []
afterEach(async () => {
  for (const name of names.splice(0)) await Dexie.delete(name)
})

async function writeV1(name: string, data: Record<string, unknown[]>) {
  names.push(name)
  const v1 = new Dexie(name)
  v1.version(1).stores(SCHEMA_VERSIONS[0]!.stores)
  await v1.transaction('rw', v1.tables, async () => {
    for (const table of BUSINESS) if (data[table]?.length) await v1.table(table).bulkAdd(data[table]!)
  })
  v1.close()
}

/** Occurrences with random (pre-Phase-18) ids; every other one paid by a linked transaction. */
function occurrences(count: number) {
  const scheduledPayments: ScheduledPayment[] = []
  const transactions: Transaction[] = []
  for (let i = 0; i < count; i++) {
    const dueDate = `20${String(20 + Math.floor(i / 365)).padStart(2, '0')}-01-01`.replace(
      '-01-01',
      `-${String((i % 12) + 1).padStart(2, '0')}-${String((Math.floor(i / 12) % 28) + 1).padStart(2, '0')}`,
    )
    const id = crypto.randomUUID()
    const paid = i % 2 === 0
    scheduledPayments.push(
      makeScheduled({ id, sourceId: `rule-${i % 7}`, dueDate: `${dueDate}`, status: paid ? 'paid' : 'pending', ...(paid ? { transactionId: `tx-${i}` } : {}) }),
    )
    if (paid) transactions.push(makeTx({ id: `tx-${i}`, type: 'expense', amountSatang: baht(1), accountId: 'acc', date: dueDate, scheduledPaymentId: id }))
  }
  return { accounts: [makeAccount({ id: 'acc' })], scheduledPayments, transactions }
}

async function migrate(name: string) {
  const start = performance.now()
  const database = new FinanceDatabase(name)
  await database.open()
  const ms = Math.round(performance.now() - start)
  const payments = await database.scheduledPayments.toArray()
  const bad = payments.filter((p) => p.id !== occurrenceId(p.sourceType, p.sourceId, p.dueDate)).length
  const links = await database.transactions.filter((tx) => tx.scheduledPaymentId !== undefined).toArray()
  const ids = new Set(payments.map((p) => p.id))
  const broken = links.filter((tx) => !ids.has(tx.scheduledPaymentId!)).length
  database.close()
  return { ms, payments: payments.length, bad, broken }
}

async function dumpOf(seed: (d: FinanceDatabase) => Promise<unknown>) {
  const name = `perf-src-${++n}`
  names.push(name)
  const source = new FinanceDatabase(name)
  await seed(source)
  const data: Record<string, unknown[]> = {}
  for (const table of BUSINESS) data[table] = await source.table(table).toArray()
  source.close()
  const renames = new Map((data.scheduledPayments as ScheduledPayment[]).map((p) => [p.id, crypto.randomUUID()]))
  data.scheduledPayments = (data.scheduledPayments as ScheduledPayment[]).map((p) => ({ ...p, id: renames.get(p.id)! }))
  data.transactions = (data.transactions as Transaction[]).map((tx) =>
    tx.scheduledPaymentId ? { ...tx, scheduledPaymentId: renames.get(tx.scheduledPaymentId)! } : tx,
  )
  return data
}

describe('v1 → v2 migration performance', () => {
  it.each([0, 100, 1_000])('%i occurrences', async (count) => {
    const name = `perf-${++n}`
    const data = occurrences(count)
    // Due dates must be unique per rule for the unique index.
    const seen = new Set<string>()
    data.scheduledPayments = data.scheduledPayments.filter((p) => !seen.has(`${p.sourceId}${p.dueDate}`) && seen.add(`${p.sourceId}${p.dueDate}`))
    const kept = new Set(data.scheduledPayments.map((p) => p.id))
    data.transactions = data.transactions.filter((tx) => kept.has(tx.scheduledPaymentId!))
    await writeV1(name, data)
    const result = await migrate(name)
    console.info(`[migration] ${count} occurrences: ${result.ms} ms`)
    expect(result).toMatchObject({ payments: data.scheduledPayments.length, bad: 0, broken: 0 })
    expect(result.ms).toBeLessThan(15_000)
  })

  it('representative data set', async () => {
    const name = `perf-${++n}`
    await writeV1(name, await dumpOf(seedRepresentative))
    const result = await migrate(name)
    console.info(`[migration] representative (${result.payments} occurrences): ${result.ms} ms`)
    expect(result).toMatchObject({ bad: 0, broken: 0 })
  })

  it('large synthetic data set (5,200 transactions)', async () => {
    const name = `perf-${++n}`
    await writeV1(name, await dumpOf((d) => seedSynthetic(d, { attachments: 5, attachmentBytes: 1_000 })))
    const result = await migrate(name)
    console.info(`[migration] synthetic 5,200 transactions (${result.payments} occurrences): ${result.ms} ms`)
    expect(result).toMatchObject({ bad: 0, broken: 0 })
    expect(result.ms).toBeLessThan(30_000)
  }, 120_000)
})
