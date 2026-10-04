import { describe, expect, it } from 'vitest'
import { canonicalJson, emptySnapshot, mergeSnapshots, newerRecord, sameSnapshot, type DriveSnapshot, type SyncRecord } from './drive-merge'
import type { SyncedTable } from './sync'

const T0 = '2026-10-01T00:00:00.000Z'
const T1 = '2026-10-02T00:00:00.000Z'
const T2 = '2026-10-03T00:00:00.000Z'
const NOW = '2026-10-04T00:00:00.000Z'

const rec = (id: string, updatedAt: string, extra: Record<string, unknown> = {}): SyncRecord => ({ id, createdAt: T0, updatedAt, ...extra })

function snap(parts: Partial<Record<SyncedTable, SyncRecord[]>> = {}, tombstones: DriveSnapshot['tombstones'] = []): DriveSnapshot {
  const s = emptySnapshot()
  for (const [table, rows] of Object.entries(parts)) s.data[table as SyncedTable] = rows
  s.tombstones = tombstones
  return s
}

describe('canonicalJson', () => {
  it('ignores key order and undefined values', () => {
    expect(canonicalJson({ b: 1, a: [{ y: 2, x: undefined, w: 'z' }] })).toBe(canonicalJson({ a: [{ w: 'z', y: 2 }], b: 1 }))
  })
})

describe('newerRecord', () => {
  it('picks the later updatedAt, falling back to createdAt', () => {
    expect(newerRecord(rec('a', T1, { v: 1 }), rec('a', T2, { v: 2 })).v).toBe(2)
    const old = { id: 'x', createdAt: T0 } as SyncRecord
    const newer = { id: 'x', createdAt: T1 } as SyncRecord
    expect(newerRecord(old, newer)).toBe(newer)
  })

  it('breaks ties the same way whatever the argument order', () => {
    const a = rec('a', T1, { v: 'apple' })
    const b = rec('a', T1, { v: 'banana' })
    expect(newerRecord(a, b)).toBe(newerRecord(b, a))
  })
})

describe('mergeSnapshots', () => {
  it('keeps records that exist on only one side (nothing is lost by a stale copy)', () => {
    const merged = mergeSnapshots(snap({ accounts: [rec('local', T1)] }), snap({ accounts: [rec('remote', T1)] }), NOW)
    expect(merged.data.accounts.map((r) => r.id)).toEqual(['local', 'remote'])
  })

  it('treats a missing remote file as empty', () => {
    const local = snap({ transactions: [rec('t1', T1)] })
    expect(mergeSnapshots(local, null, NOW).data.transactions).toEqual([rec('t1', T1)])
  })

  it('the later edit wins on either side', () => {
    const local = snap({ accounts: [rec('a', T2, { name: 'phone' })] })
    const remote = snap({ accounts: [rec('a', T1, { name: 'computer' })] })
    expect(mergeSnapshots(local, remote, NOW).data.accounts[0]!.name).toBe('phone')
    expect(mergeSnapshots(remote, local, NOW).data.accounts[0]!.name).toBe('phone')
  })

  it('a delete removes the record when it is newer than the last edit', () => {
    const local = snap({}, [{ tableName: 'transactions', recordId: 't1', deletedAt: T2 }])
    const remote = snap({ transactions: [rec('t1', T1)] })
    const merged = mergeSnapshots(local, remote, NOW)
    expect(merged.data.transactions).toEqual([])
    expect(merged.tombstones).toEqual([{ tableName: 'transactions', recordId: 't1', deletedAt: T2 }])
  })

  it('an edit made after the delete brings the record back and drops the tombstone', () => {
    const local = snap({ transactions: [rec('t1', T2)] })
    const remote = snap({}, [{ tableName: 'transactions', recordId: 't1', deletedAt: T1 }])
    const merged = mergeSnapshots(local, remote, NOW)
    expect(merged.data.transactions.map((r) => r.id)).toEqual(['t1'])
    expect(merged.tombstones).toEqual([])
  })

  it('tombstones from both sides are kept, latest delete time wins', () => {
    const merged = mergeSnapshots(
      snap({}, [{ tableName: 'budgets', recordId: 'b', deletedAt: T1 }]),
      snap({}, [
        { tableName: 'budgets', recordId: 'b', deletedAt: T2 },
        { tableName: 'accounts', recordId: 'a', deletedAt: T0 },
      ]),
      NOW,
    )
    expect(merged.tombstones).toEqual([
      { tableName: 'accounts', recordId: 'a', deletedAt: T0 },
      { tableName: 'budgets', recordId: 'b', deletedAt: T2 },
    ])
  })

  it('keeps one budget per month and category (two devices created it with different ids)', () => {
    const local = snap({ budgets: [rec('b-phone', T2, { month: '2026-10', categoryId: 'food', limitSatang: 500000 })] })
    const remote = snap({ budgets: [rec('b-pc', T1, { month: '2026-10', categoryId: 'food', limitSatang: 300000 })] })
    const merged = mergeSnapshots(local, remote, NOW)
    expect(merged.data.budgets.map((b) => b.id)).toEqual(['b-phone'])
    expect(merged.tombstones).toEqual([{ tableName: 'budgets', recordId: 'b-pc', deletedAt: NOW }])
    // Merging again changes nothing (stable).
    expect(sameSnapshot(mergeSnapshots(merged, merged, NOW), merged)).toBe(true)
  })

  it('keeps one scheduled payment per source and due date, preferring the settled one', () => {
    const base = { sourceType: 'obligation', sourceId: 'rent', dueDate: '2026-10-05' }
    const paid = rec('p-old', T1, { ...base, status: 'paid', transactionId: 'tx1' })
    const pending = rec('p-new', T2, { ...base, status: 'pending' })
    const merged = mergeSnapshots(snap({ scheduledPayments: [pending] }), snap({ scheduledPayments: [paid] }), NOW)
    expect(merged.data.scheduledPayments.map((p) => p.id)).toEqual(['p-old'])
  })

  it('is symmetric: both devices end with the same result', () => {
    const a = snap({ accounts: [rec('a', T2, { n: 1 }), rec('only-a', T1)], categories: [rec('c', T1)] }, [{ tableName: 'transactions', recordId: 'gone', deletedAt: T2 }])
    const b = snap({ accounts: [rec('a', T1, { n: 2 })], transactions: [rec('gone', T1), rec('kept', T1)] })
    expect(sameSnapshot(mergeSnapshots(a, b, NOW), mergeSnapshots(b, a, NOW))).toBe(true)
  })

  it('sameSnapshot ignores record order', () => {
    expect(sameSnapshot(snap({ accounts: [rec('a', T1), rec('b', T1)] }), snap({ accounts: [rec('b', T1), rec('a', T1)] }))).toBe(true)
    expect(sameSnapshot(snap({ accounts: [rec('a', T1)] }), snap({ accounts: [rec('a', T2)] }))).toBe(false)
  })
})
