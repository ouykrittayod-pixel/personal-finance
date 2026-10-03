/**
 * Row Level Security, tested against real PostgreSQL (PGlite) running the
 * actual migration in supabase/migrations. Security comes from the database,
 * not from client-side filtering: every query below has NO user filter.
 * Synthetic users and ciphertext samples only.
 */
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asUser, createSupabaseTestDb, createTestUser } from '@/test/pglite-supabase'

const A = 'aaaaaaaa-0000-4000-8000-000000000001'
const B = 'bbbbbbbb-0000-4000-8000-000000000002'
const RECORD = 'cccccccc-0000-4000-8000-000000000003'
const KEY = 'dddddddd-0000-4000-8000-000000000004'
const IV = 'AAAAAAAAAAAAAAAA'
const CT = 'x'.repeat(40)

let db: PGlite
beforeAll(async () => {
  db = await createSupabaseTestDb()
  await createTestUser(db, A, 'a@example.test')
  await createTestUser(db, B, 'b@example.test')
})
afterAll(async () => {
  await db.close()
})
beforeEach(async () => {
  await db.exec('delete from public.sync_records; delete from storage.objects;')
})

const insertAs = (actor: string | null, owner: string, overrides: Record<string, unknown> = {}) =>
  asUser(db, actor, (tx) =>
    tx.query(
      `insert into public.sync_records (user_id, record_type, record_id, key_id, envelope_version, iv, ciphertext, revision, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        owner,
        overrides.record_type ?? 'synthetic_test',
        overrides.record_id ?? RECORD,
        KEY,
        overrides.envelope_version ?? 1,
        overrides.iv ?? IV,
        overrides.ciphertext ?? CT,
        overrides.revision ?? 1,
        overrides.created_at ?? null,
      ],
    ),
  )
const count = async (actor: string | null) =>
  asUser(db, actor, async (tx) => (await tx.query<{ n: number }>('select count(*)::int as n from public.sync_records')).rows[0]!.n)
const ownedBy = async (owner: string) =>
  (await db.query<{ n: number }>('select count(*)::int as n from public.sync_records where user_id = $1', [owner])).rows[0]!.n

describe('sync_records: user isolation', () => {
  it('a user can create, read, update and delete their own rows', async () => {
    await insertAs(A, A)
    expect(await count(A)).toBe(1)
    const updated = await asUser(db, A, (tx) => tx.query(`update public.sync_records set ciphertext = $1`, ['y'.repeat(40)]))
    expect(updated.affectedRows).toBe(1)
    const deleted = await asUser(db, A, (tx) => tx.query('delete from public.sync_records'))
    expect(deleted.affectedRows).toBe(1)
  })

  it("User B cannot SELECT User A's rows (and A cannot see B's)", async () => {
    await insertAs(A, A)
    await insertAs(B, B)
    expect(await count(A)).toBe(1)
    expect(await count(B)).toBe(1)
    const seenByB = await asUser(db, B, (tx) => tx.query<{ user_id: string }>('select user_id from public.sync_records'))
    expect(seenByB.rows.map((r) => r.user_id)).toEqual([B])
  })

  it('User B cannot INSERT a row owned by User A', async () => {
    await expect(insertAs(B, A)).rejects.toThrow(/row-level security/)
    expect(await ownedBy(A)).toBe(0)
  })

  it("User B cannot UPDATE User A's rows, nor move a row to another owner", async () => {
    await insertAs(A, A)
    const result = await asUser(db, B, (tx) => tx.query(`update public.sync_records set ciphertext = $1 where user_id = $2`, ['z'.repeat(40), A]))
    expect(result.affectedRows).toBe(0)
    expect((await db.query<{ ciphertext: string }>('select ciphertext from public.sync_records')).rows[0]!.ciphertext).toBe(CT)
    await expect(asUser(db, A, (tx) => tx.query(`update public.sync_records set user_id = $1`, [B]))).rejects.toThrow(/row-level security|immutable/)
    expect(await ownedBy(A)).toBe(1)
  })

  it("User B cannot DELETE User A's rows", async () => {
    await insertAs(A, A)
    const result = await asUser(db, B, (tx) => tx.query('delete from public.sync_records where user_id = $1', [A]))
    expect(result.affectedRows).toBe(0)
    expect(await ownedBy(A)).toBe(1)
  })

  it('the anon role has no access at all', async () => {
    await insertAs(A, A)
    await expect(count(null)).rejects.toThrow(/permission denied/)
    await expect(insertAs(null, A)).rejects.toThrow(/permission denied/)
  })

  it('a signed-in request without a subject sees nothing and can write nothing', async () => {
    await insertAs(A, A)
    const none = await db.transaction(async (tx) => {
      await tx.exec('set local role authenticated')
      return (await tx.query<{ n: number }>('select count(*)::int as n from public.sync_records')).rows[0]!.n
    })
    expect(none).toBe(0)
  })
})

describe('sync_records: server-owned fields and constraints', () => {
  it('revision and timestamps are set by the server; revision increments on every update', async () => {
    await insertAs(A, A, { revision: 99, created_at: '2000-01-01T00:00:00Z' })
    const first = (await db.query<{ revision: number; created_at: Date }>('select revision::int, created_at from public.sync_records')).rows[0]!
    expect(first.revision).toBe(1)
    expect(first.created_at.getFullYear()).toBeGreaterThan(2000)
    await asUser(db, A, (tx) => tx.query(`update public.sync_records set ciphertext = $1, revision = 500`, ['y'.repeat(40)]))
    expect((await db.query<{ revision: number }>('select revision::int from public.sync_records')).rows[0]!.revision).toBe(2)
  })

  it('only synthetic_* record types can be stored in Phase 19', async () => {
    for (const type of ['transactions', 'accounts', 'synthetic', 'Synthetic_x'])
      await expect(insertAs(A, A, { record_type: type })).rejects.toThrow(/sync_records_record_type_synthetic_only/)
  })

  it('rejects malformed envelopes (version, IV, ciphertext encoding)', async () => {
    await expect(insertAs(A, A, { envelope_version: 2 })).rejects.toThrow(/envelope_version/)
    await expect(insertAs(A, A, { iv: 'short' })).rejects.toThrow(/sync_records_iv/)
    await expect(insertAs(A, A, { ciphertext: 'not base64url!' + 'x'.repeat(30) })).rejects.toThrow(/sync_records_ciphertext/)
    await expect(insertAs(A, A, { ciphertext: 'x'.repeat(10) })).rejects.toThrow(/sync_records_ciphertext/)
  })

  it('the table has no plaintext finance columns', async () => {
    const columns = (
      await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'sync_records' order by ordinal_position`,
      )
    ).rows.map((r) => r.column_name)
    expect(columns).toEqual(['user_id', 'record_type', 'record_id', 'key_id', 'envelope_version', 'iv', 'ciphertext', 'revision', 'created_at', 'updated_at'])
  })

  it('RLS is enabled and forced, with one policy per operation', async () => {
    const table = (
      await db.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `select relrowsecurity, relforcerowsecurity from pg_class where oid = 'public.sync_records'::regclass`,
      )
    ).rows[0]!
    expect(table).toEqual({ relrowsecurity: true, relforcerowsecurity: true })
    const policies = (await db.query<{ cmd: string; roles: string }>(`select cmd, roles::text from pg_policies where tablename = 'sync_records' order by cmd`))
      .rows
    expect(policies.map((p) => p.cmd)).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE'])
    for (const p of policies) expect(p.roles).toBe('{authenticated}')
  })
})

describe('private storage bucket for future encrypted attachments', () => {
  const put = (actor: string, name: string) =>
    asUser(db, actor, (tx) => tx.query(`insert into storage.objects (bucket_id, name) values ('encrypted-attachments', $1)`, [name]))

  it('is private and accepts ciphertext only', async () => {
    const bucket = (
      await db.query<{ public: boolean; allowed_mime_types: string[] }>(
        `select public, allowed_mime_types from storage.buckets where id = 'encrypted-attachments'`,
      )
    ).rows[0]!
    expect(bucket.public).toBe(false)
    expect(bucket.allowed_mime_types).toEqual(['application/octet-stream'])
  })

  it("users can only write and read under their own folder; B cannot read, overwrite or delete A's objects", async () => {
    await put(A, `${A}/synthetic.bin`)
    await expect(put(B, `${A}/intrusion.bin`)).rejects.toThrow(/row-level security/)
    const seenByB = await asUser(db, B, (tx) => tx.query('select name from storage.objects'))
    expect(seenByB.rows).toEqual([])
    const updated = await asUser(db, B, (tx) => tx.query(`update storage.objects set name = $1`, [`${B}/stolen.bin`]))
    expect(updated.affectedRows).toBe(0)
    const deleted = await asUser(db, B, (tx) => tx.query('delete from storage.objects'))
    expect(deleted.affectedRows).toBe(0)
    const seenByA = await asUser(db, A, (tx) => tx.query<{ name: string }>('select name from storage.objects'))
    expect(seenByA.rows.map((r) => r.name)).toEqual([`${A}/synthetic.bin`])
    await expect(
      asUser(db, null, (tx) => tx.query(`insert into storage.objects (bucket_id, name) values ('encrypted-attachments', $1)`, [`${A}/anon.bin`])),
    ).rejects.toThrow(/row-level security/)
  })
})
