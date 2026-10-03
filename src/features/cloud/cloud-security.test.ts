/**
 * Phase 19 — cloud payload, synthetic end-to-end round trip (real PostgreSQL
 * + RLS via PGlite), backup boundaries, offline safety, sync gate.
 * Synthetic data and fabricated users only.
 */
import type { PGlite } from '@electric-sql/pglite'
import Dexie from 'dexie'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { FinanceDatabase } from '@/db/dexie'
import { createKeyringStore } from '@/db/keyring-store'
import { createTransactionsRepository } from '@/db/repositories'
import { SYNCED_TABLES } from '@/domain/sync'
import { backupToBlob, createBackup, replaceDatabase } from '@/features/backup/create-backup'
import { readBackup } from '@/features/backup/read-backup'
import { decryptRecord, type DataKey } from '@/lib/crypto/envelope'
import { createWrappedKey, MIN_PBKDF2_ITERATIONS } from '@/lib/crypto/keyring'
import { createKeyVault } from '@/lib/crypto/vault'
import { AUTH_STORAGE_KEY } from '@/lib/supabase/client'
import { asUser, createSupabaseTestDb, createTestUser, pgliteRecordStore } from '@/test/pglite-supabase'
import { baht } from '@/test/factories'
import { REP_NOW, seedRepresentative } from '@/test/representative'
import {
  CLOUD_ROW_COLUMNS,
  CloudRequestError,
  encryptForCloud,
  envelopeFromRow,
  toCloudRow,
  UploadRefusedError,
  type EncryptedRecordStore,
} from './encrypted-records'
import { canonicalJson, countPlaintextLeaks, runSyntheticRoundTrip } from './round-trip'
import { evaluateSyncGate } from './sync-gate'
import { buildSyntheticDataset, SYNTHETIC_RECORD, SYNTHETIC_RECORD_TYPES } from './synthetic'

const A = 'aaaaaaaa-0000-4000-8000-000000000001'
const B = 'bbbbbbbb-0000-4000-8000-000000000002'
const FAST = { iterations: MIN_PBKDF2_ITERATIONS }

let pg: PGlite
let keyA: DataKey
let keyB: DataKey
beforeAll(async () => {
  pg = await createSupabaseTestDb()
  await createTestUser(pg, A, 'a@example.test')
  await createTestUser(pg, B, 'b@example.test')
  keyA = (await createWrappedKey('synthetic passphrase A', FAST)).dataKey
  keyB = (await createWrappedKey('synthetic passphrase B', FAST)).dataKey
})
afterAll(async () => {
  await pg.close()
})

describe('cloud payload', () => {
  const ctx = { userId: A, recordType: 'synthetic_expense', recordId: buildSyntheticDataset().at(-1)!.recordId }

  it('contains exactly the routing columns and ciphertext — no plaintext finance fields', async () => {
    const row = await encryptForCloud(keyA, ctx, SYNTHETIC_RECORD)
    expect(Object.keys(row).sort()).toEqual([...CLOUD_ROW_COLUMNS].sort())
    expect(countPlaintextLeaks(row, SYNTHETIC_RECORD)).toBe(0)
    // Non-routing columns are opaque: no plaintext text either.
    const opaque = JSON.stringify([row.key_id, row.iv, row.ciphertext])
    for (const plain of ['1250', 'food', 'Synthetic test record', 'amount', 'category', 'note']) expect(opaque).not.toContain(plain)
    expect(row.envelope_version).toBe(1)
    expect(row.ciphertext).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    expect(await decryptRecord(keyA, ctx, envelopeFromRow(row))).toEqual(SYNTHETIC_RECORD)
  })

  it('refuses real finance record types — only synthetic_* can leave the device in Phase 19', async () => {
    const envelope = envelopeFromRow(await encryptForCloud(keyA, ctx, SYNTHETIC_RECORD))
    for (const table of [...SYNCED_TABLES, 'transaction', 'synthetic'])
      expect(() => toCloudRow({ ...ctx, recordType: table }, envelope)).toThrow(UploadRefusedError)
    expect(() => toCloudRow({ ...ctx, recordId: 'kbank' }, envelope)).toThrow(UploadRefusedError)
    expect(() => toCloudRow({ ...ctx, userId: 'someone' }, envelope)).toThrow(UploadRefusedError)
  })

  it('the synthetic dataset is what the phase asks for, and clearly synthetic', () => {
    const items = buildSyntheticDataset()
    const byType = Object.fromEntries(SYNTHETIC_RECORD_TYPES.map((t) => [t, items.filter((i) => i.recordType === t).length]))
    expect(byType).toEqual({
      synthetic_account: 5,
      synthetic_category: 10,
      synthetic_transaction: 20,
      synthetic_debt: 2,
      synthetic_recurring: 3,
      synthetic_budget: 2,
      synthetic_expense: 1,
    })
    const names = items.map((i) => i.value.name).filter((name) => name !== undefined)
    expect(names).toHaveLength(20) // accounts 5 + categories 10 + debts 2 + recurring 3
    expect(names.every((name) => String(name).startsWith('SYNTHETIC '))).toBe(true)
  })

  it('cloud modules that build or send payloads never import the local database', () => {
    const sources = import.meta.glob<string>(['./encrypted-records.ts', './round-trip.ts', './synthetic.ts', './sync-gate.ts', './session.ts'], {
      query: '?raw',
      import: 'default',
      eager: true,
    })
    expect(Object.keys(sources)).toHaveLength(5)
    for (const [file, source] of Object.entries(sources)) expect({ file, importsDb: /from ['"]@\/db|dexie/.test(source) }).toEqual({ file, importsDb: false })
  })
})

describe('synthetic round trip through PostgreSQL with RLS', () => {
  it('plaintext → encrypt → store ciphertext → download → decrypt → exact equality → cleanup', async () => {
    const items = buildSyntheticDataset()
    const report = await runSyntheticRoundTrip({ store: pgliteRecordStore(pg, A), key: keyA, userId: A, items })
    expect(report).toEqual({ uploaded: 43, downloaded: 43, matched: 43, mismatched: 0, plaintextLeaks: 0, removed: 43, remainingAfterCleanup: 0 })
    expect((await pg.query<{ n: number }>('select count(*)::int as n from public.sync_records')).rows[0]!.n).toBe(0)
  })

  it('what the database stores (read as a database admin) contains no plaintext', async () => {
    const items = buildSyntheticDataset()
    const store = pgliteRecordStore(pg, A)
    await store.upsert(await Promise.all(items.map((i) => encryptForCloud(keyA, { userId: A, recordType: i.recordType, recordId: i.recordId }, i.value))))
    const rows = (await pg.query<Record<string, unknown>>('select * from public.sync_records')).rows
    expect(rows).toHaveLength(items.length)
    // Everything except routing columns and server timestamps must be opaque.
    const dump = JSON.stringify(rows.map((r) => [r.key_id, r.iv, r.ciphertext]))
    for (const plain of ['SYNTHETIC', 'Synthetic test record', 'food', 'amountSatang', 'openingBalanceSatang', 'ธุรกรรม', '2026-09-', 'credit_card', 'monthly'])
      expect(dump).not.toContain(plain)
    await store.remove(SYNTHETIC_RECORD_TYPES)
  })

  it("another user can neither see A's ciphertext nor decrypt it with their own key", async () => {
    await pg.exec('delete from public.sync_records')
    const items = buildSyntheticDataset().slice(0, 3)
    const storeA = pgliteRecordStore(pg, A)
    const storeB = pgliteRecordStore(pg, B)
    await storeA.upsert(await Promise.all(items.map((i) => encryptForCloud(keyA, { userId: A, recordType: i.recordType, recordId: i.recordId }, i.value))))
    expect(await storeB.list(SYNTHETIC_RECORD_TYPES)).toEqual([])
    expect(await storeB.remove(SYNTHETIC_RECORD_TYPES)).toBe(0)
    const leaked = (await storeA.list(SYNTHETIC_RECORD_TYPES))[0]!
    await expect(
      decryptRecord(keyB, { userId: A, recordType: String(leaked.record_type), recordId: String(leaked.record_id) }, envelopeFromRow(leaked)),
    ).rejects.toThrow(/different key/)
    // B cannot plant a row in A's space either.
    const planted = await encryptForCloud(keyB, { userId: A, recordType: 'synthetic_expense', recordId: items[0]!.recordId }, { forged: true })
    await expect(storeB.upsert([planted])).rejects.toThrow(/row-level security/)
    expect(await storeA.remove(SYNTHETIC_RECORD_TYPES)).toBe(3)
  })

  it('a re-upload increments the server revision', async () => {
    const [item] = buildSyntheticDataset()
    const store = pgliteRecordStore(pg, A)
    const row = () => encryptForCloud(keyA, { userId: A, recordType: item!.recordType, recordId: item!.recordId }, item!.value)
    await store.upsert([await row()])
    await store.upsert([await row()])
    expect((await store.list([item!.recordType]))[0]!.revision).toBe(2)
    await store.remove([item!.recordType])
  })

  it('RLS does the filtering: the anon role cannot list anything', async () => {
    await expect(asUser(pg, null, (tx) => tx.query('select * from public.sync_records'))).rejects.toThrow(/permission denied/)
  })
})

describe('local boundaries: backup, keyring, offline', () => {
  let n = 0
  const opened: FinanceDatabase[] = []
  const fresh = () => {
    const database = new FinanceDatabase(`cloud-${++n}`)
    opened.push(database)
    return database
  }
  afterEach(async () => {
    for (const database of opened.splice(0)) {
      database.close()
      await Dexie.delete(database.name)
    }
  })

  it('backups contain no encryption key material, auth tokens or sync credentials; restore keeps the device key', async () => {
    const database = fresh()
    await seedRepresentative(database)
    const vault = createKeyVault(createKeyringStore(database), FAST)
    await vault.setup('synthetic passphrase for backup test')
    const wrapped = (await database.keyring.toArray())[0]!
    const text = await backupToBlob(await createBackup(database, REP_NOW)).text()
    for (const secret of [wrapped.kid, wrapped.kdf.salt, wrapped.wrap.ct, wrapped.wrap.iv, 'synthetic passphrase for backup test'])
      expect(text).not.toContain(secret)
    expect(text).not.toMatch(/keyring|access_token|refresh_token|provider_token|pf-cloud-auth|sb-[a-z0-9]+-auth-token|service_role|deviceId|syncOutbox/)
    expect(AUTH_STORAGE_KEY).toBe('pf-cloud-auth')
    await replaceDatabase(database, readBackup(text))
    expect(await database.keyring.count()).toBe(1)
    vault.lock()
    await vault.unlock('synthetic passphrase for backup test')
    expect(vault.getSnapshot().status).toBe('unlocked')
  })

  it('creating a key is not a finance change: no outbox entry', async () => {
    const database = fresh()
    await createKeyVault(createKeyringStore(database), FAST).setup('synthetic passphrase for outbox test')
    expect(await database.syncOutbox.count()).toBe(0)
  })

  it('a failing cloud (offline) never corrupts local data; local features keep working', async () => {
    const database = fresh()
    await seedRepresentative(database)
    const before = JSON.stringify(await Promise.all(database.tables.map((t) => t.toArray())))
    const offline: EncryptedRecordStore = {
      upsert: async () => {
        throw new CloudRequestError()
      },
      list: async () => {
        throw new CloudRequestError()
      },
      remove: async () => {
        throw new CloudRequestError()
      },
    }
    await expect(runSyntheticRoundTrip({ store: offline, key: keyA, userId: A, items: buildSyntheticDataset() })).rejects.toThrow(CloudRequestError)
    expect(JSON.stringify(await Promise.all(database.tables.map((t) => t.toArray())))).toBe(before)
    const created = await createTransactionsRepository(database).create(
      { type: 'expense', amountSatang: baht(75), accountId: 'cash', categoryId: 'food', date: '2026-09-29' },
      [],
      { id: 'offline-expense', now: REP_NOW, newId: () => crypto.randomUUID() },
    )
    expect(created.transaction.id).toBe('offline-expense')
  })

  it('the leak check catches plaintext if it were ever in the row', async () => {
    const row = await encryptForCloud(
      keyA,
      { userId: A, recordType: 'synthetic_expense', recordId: buildSyntheticDataset().at(-1)!.recordId },
      SYNTHETIC_RECORD,
    )
    const planted = { ...row, ciphertext: `${row.ciphertext}${btoa('Synthetic test record').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}` }
    expect(countPlaintextLeaks(planted, SYNTHETIC_RECORD)).toBeGreaterThan(0)
  })

  it('the round trip refuses anything that is not synthetic', async () => {
    const store = pgliteRecordStore(pg, A)
    await expect(
      runSyntheticRoundTrip({
        store,
        key: keyA,
        userId: A,
        items: [{ recordType: 'transactions' as 'synthetic_x', recordId: crypto.randomUUID(), value: {} }],
      }),
    ).rejects.toThrow(/synthetic data only/)
  })
})

describe('sync gate (no sync engine in Phase 19)', () => {
  it.each([
    ['A: signed in, online, key unlocked', { cloud: 'signed_in', vault: 'unlocked', online: true, syncEnabled: false }, ['sync_disabled', 'not_implemented']],
    ['B: signed in, offline', { cloud: 'signed_in', vault: 'unlocked', online: false, syncEnabled: false }, ['offline', 'sync_disabled', 'not_implemented']],
    [
      'C: signed out, offline',
      { cloud: 'signed_out', vault: 'locked', online: false, syncEnabled: false },
      ['not_signed_in', 'key_locked', 'offline', 'sync_disabled', 'not_implemented'],
    ],
    ['signed out, online', { cloud: 'signed_out', vault: 'unlocked', online: true, syncEnabled: true }, ['not_signed_in', 'not_implemented']],
    ['signed in, key locked', { cloud: 'signed_in', vault: 'locked', online: true, syncEnabled: true }, ['key_locked', 'not_implemented']],
    [
      'not configured',
      { cloud: 'unconfigured', vault: 'none', online: true, syncEnabled: false },
      ['not_configured', 'key_locked', 'sync_disabled', 'not_implemented'],
    ],
  ] as const)('%s → blocked', (_label, input, blocks) => {
    expect(evaluateSyncGate(input)).toEqual({ allowed: false, blocks })
  })

  it('canonicalJson compares structure exactly (key order independent)', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(canonicalJson({ a: [2, { c: 2, d: 1 }], b: 1 }))
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: '1' }))
  })
})
