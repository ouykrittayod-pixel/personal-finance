/**
 * The ONLY shape that may leave this device for Supabase (Phase 19):
 *
 *   user_id           owner (RLS boundary; must equal auth.uid())
 *   record_type       routing, e.g. "synthetic_transaction"
 *   record_id         the record's id (a UUID)
 *   key_id            which data key encrypted it
 *   envelope_version  encryption format version
 *   iv                base64url, 12 bytes
 *   ciphertext        base64url, AES-256-GCM output (includes the tag)
 *
 * No amount, category, account, date, note, balance, name or file content —
 * those exist only inside the ciphertext. revision / created_at / updated_at
 * are set by the server.
 *
 * Phase 19 guard: only `synthetic_*` record types can be uploaded (enforced
 * here AND by a database CHECK constraint). Real finance tables cannot be sent.
 */
import { decryptRecord, encryptRecord, parseEnvelope, type DataKey, type EncryptedEnvelope, type RecordContext } from '@/lib/crypto/envelope'

export const CLOUD_ROW_COLUMNS = ['user_id', 'record_type', 'record_id', 'key_id', 'envelope_version', 'iv', 'ciphertext'] as const
export type CloudRow = Record<(typeof CLOUD_ROW_COLUMNS)[number], string | number>

export interface StoredCloudRow extends CloudRow {
  revision: number
}

const RECORD_TYPE = /^synthetic_[a-z_]{1,40}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export class UploadRefusedError extends Error {
  readonly reason: 'record_type' | 'record_id' | 'user_id'
  constructor(reason: 'record_type' | 'record_id' | 'user_id') {
    super(`Upload refused (${reason})`)
    this.name = 'UploadRefusedError'
    this.reason = reason
  }
}

/** Builds the exact row to upload from an envelope; nothing else can be added. */
export function toCloudRow(context: RecordContext, envelope: EncryptedEnvelope): CloudRow {
  if (!RECORD_TYPE.test(context.recordType)) throw new UploadRefusedError('record_type')
  if (!UUID.test(context.recordId)) throw new UploadRefusedError('record_id')
  if (!UUID.test(context.userId)) throw new UploadRefusedError('user_id')
  const e = parseEnvelope(envelope)
  return {
    user_id: context.userId,
    record_type: context.recordType,
    record_id: context.recordId,
    key_id: e.kid,
    envelope_version: e.v,
    iv: e.iv,
    ciphertext: e.ct,
  }
}

export function envelopeFromRow(row: CloudRow): EncryptedEnvelope {
  return parseEnvelope({ v: row.envelope_version, alg: 'A256GCM', kid: row.key_id, iv: row.iv, ct: row.ciphertext })
}

export async function encryptForCloud(key: DataKey, context: RecordContext, value: unknown): Promise<CloudRow> {
  return toCloudRow(context, await encryptRecord(key, context, value))
}

export async function decryptFromCloud<T>(key: DataKey, row: CloudRow): Promise<T> {
  return decryptRecord<T>(key, { userId: String(row.user_id), recordType: String(row.record_type), recordId: String(row.record_id) }, envelopeFromRow(row))
}

/** Remote storage for encrypted rows. RLS on the server decides what the signed-in user can reach. */
export interface EncryptedRecordStore {
  upsert(rows: readonly CloudRow[]): Promise<void>
  list(recordTypes: readonly string[]): Promise<StoredCloudRow[]>
  remove(recordTypes: readonly string[]): Promise<number>
}

export class CloudRequestError extends Error {
  constructor() {
    super('Cloud request failed')
    this.name = 'CloudRequestError'
  }
}

interface SupabaseLike {
  from(table: string): {
    upsert(rows: readonly CloudRow[], options: { onConflict: string }): PromiseLike<{ error: unknown }>
    select(columns: string): { in(column: string, values: readonly string[]): PromiseLike<{ data: unknown; error: unknown }> }
    delete(options: { count: 'exact' }): { in(column: string, values: readonly string[]): PromiseLike<{ count: number | null; error: unknown }> }
  }
}

/** Supabase implementation (table public.sync_records). Errors never include server text. */
export function supabaseRecordStore(client: SupabaseLike): EncryptedRecordStore {
  const table = () => client.from('sync_records')
  return {
    async upsert(rows) {
      const { error } = await table().upsert(rows, { onConflict: 'user_id,record_type,record_id' })
      if (error) throw new CloudRequestError()
    },
    async list(recordTypes) {
      const { data, error } = await table()
        .select([...CLOUD_ROW_COLUMNS, 'revision'].join(','))
        .in('record_type', recordTypes)
      if (error) throw new CloudRequestError()
      return data as StoredCloudRow[]
    },
    async remove(recordTypes) {
      const { count, error } = await table().delete({ count: 'exact' }).in('record_type', recordTypes)
      if (error) throw new CloudRequestError()
      return count ?? 0
    },
  }
}
