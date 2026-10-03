/**
 * TEST ONLY: real PostgreSQL (PGlite, in-process WASM) with the Supabase
 * platform shim and every migration in supabase/migrations applied unchanged.
 * Queries run as the `authenticated` role with a JWT subject, exactly like
 * PostgREST does for a signed-in user, so RLS is what decides access.
 */
import { PGlite, type Transaction } from '@electric-sql/pglite'
import { CLOUD_ROW_COLUMNS, type CloudRow, type EncryptedRecordStore, type StoredCloudRow } from '@/features/cloud/encrypted-records'
import shim from './supabase-shim.sql?raw'

/** Every migration, in file-name (timestamp) order — the same files Supabase would apply. */
const MIGRATIONS = Object.entries(import.meta.glob<string>('/supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }))
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, sql]) => sql)

export async function createSupabaseTestDb(): Promise<PGlite> {
  const db = await PGlite.create()
  await db.exec(shim)
  for (const sql of MIGRATIONS) await db.exec(sql)
  return db
}

export async function createTestUser(db: PGlite, id: string, email: string) {
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email])
}

/** Runs `fn` as a signed-in user (role authenticated, JWT sub = userId), or as `anon` when userId is null. */
export async function asUser<T>(db: PGlite, userId: string | null, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${userId ? 'authenticated' : 'anon'}`)
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(userId ? { sub: userId, role: 'authenticated' } : { role: 'anon' })])
    return fn(tx)
  })
}

/** The record store used by the app, backed by PGlite as `userId` — RLS applies, no client-side filtering. */
export function pgliteRecordStore(db: PGlite, userId: string): EncryptedRecordStore {
  const columns = CLOUD_ROW_COLUMNS.join(', ')
  return {
    async upsert(rows: readonly CloudRow[]) {
      await asUser(db, userId, async (tx) => {
        for (const row of rows)
          await tx.query(
            `insert into public.sync_records (${columns}) values ($1, $2, $3, $4, $5, $6, $7)
             on conflict (user_id, record_type, record_id) do update
               set key_id = excluded.key_id, envelope_version = excluded.envelope_version, iv = excluded.iv, ciphertext = excluded.ciphertext`,
            CLOUD_ROW_COLUMNS.map((c) => row[c]),
          )
      })
    },
    async list(recordTypes) {
      return asUser(db, userId, async (tx) => {
        const result = await tx.query<StoredCloudRow>(`select ${columns}, revision::int as revision from public.sync_records where record_type = any($1)`, [
          recordTypes,
        ])
        return result.rows
      })
    },
    async remove(recordTypes) {
      return asUser(db, userId, async (tx) => (await tx.query(`delete from public.sync_records where record_type = any($1)`, [recordTypes])).affectedRows ?? 0)
    },
  }
}
