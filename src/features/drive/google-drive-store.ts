/**
 * The user's Google Drive as the sync store: one JSON data file and one file
 * per receipt, all in the app's hidden folder (appDataFolder). Plain fetch
 * against the Drive v3 REST API; no Google client library.
 */
import { mergeSnapshots, type DriveSnapshot } from '@/domain/drive-merge'
import { ATTACHMENT_FILE_PREFIX, attachmentFileName, decodeRemote, DRIVE_DATA_FILE, encodeRemote } from './remote-format'
import { RemoteConflictError, type RemoteFile, type RemoteStore } from './sync-engine'
import { forgetAccessToken, GoogleAuthError } from '@/lib/google/auth'

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'

/** The network is unreachable (offline, DNS, blocked). */
export class OfflineError extends Error {
  constructor() {
    super('Offline')
    this.name = 'OfflineError'
  }
}

/** Drive answered with an error status. Server text is never shown to the user. */
export class DriveRequestError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`Drive request failed (${status})`)
    this.name = 'DriveRequestError'
    this.status = status
  }
}

interface DriveFile {
  id: string
  name?: string
  version?: string
  createdTime?: string
}

export interface DriveStoreOptions {
  /** A valid access token (or throws GoogleAuthError). */
  getToken: () => Promise<string>
  deviceId: string
  now?: () => string
  fetch?: typeof fetch
}

export function createDriveStore(options: DriveStoreOptions): RemoteStore {
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init))
  const now = options.now ?? (() => new Date().toISOString())
  let dataFileId: string | null = null
  /** Extra data files (two devices created one at the same moment): merged in, deleted after the next upload. */
  let duplicates: string[] = []

  async function request(url: string, init: RequestInit = {}): Promise<Response> {
    const token = await options.getToken()
    let response: Response
    try {
      response = await doFetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` } })
    } catch {
      throw new OfflineError()
    }
    if (response.status === 401) {
      forgetAccessToken()
      throw new GoogleAuthError('sign_in_required')
    }
    if (!response.ok) throw new DriveRequestError(response.status)
    return response
  }

  async function json<T>(url: string, init?: RequestInit): Promise<T> {
    return (await request(url, init)).json() as Promise<T>
  }

  async function listDataFiles(): Promise<DriveFile[]> {
    const q = encodeURIComponent(`name = '${DRIVE_DATA_FILE}' and trashed = false`)
    const body = await json<{ files: DriveFile[] }>(`${API}/files?spaces=appDataFolder&q=${q}&fields=files(id,version,createdTime)&orderBy=createdTime&pageSize=10`)
    return body.files
  }

  async function findDataFile(): Promise<DriveFile | null> {
    const files = await listDataFiles()
    dataFileId = files[0]?.id ?? null
    duplicates = files.slice(1).map((f) => f.id)
    return files[0] ?? null
  }

  async function fileVersion(id: string): Promise<string> {
    return (await json<DriveFile>(`${API}/files/${id}?fields=version`)).version ?? '0'
  }

  async function readFile(id: string): Promise<DriveSnapshot> {
    return decodeRemote(await (await request(`${API}/files/${id}?alt=media`, { cache: 'no-store' })).text())
  }

  function multipart(metadata: object, content: Blob): { body: Blob; contentType: string } {
    const boundary = `pf-${crypto.randomUUID()}`
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
      `--${boundary}\r\nContent-Type: ${content.type || 'application/octet-stream'}\r\n\r\n`,
      content,
      `\r\n--${boundary}--`,
    ])
    return { body, contentType: `multipart/related; boundary=${boundary}` }
  }

  async function createFile(name: string, content: Blob): Promise<DriveFile> {
    const { body, contentType } = multipart({ name, parents: ['appDataFolder'], mimeType: content.type || 'application/octet-stream' }, content)
    return json<DriveFile>(`${UPLOAD}/files?uploadType=multipart&fields=id,version`, { method: 'POST', headers: { 'Content-Type': contentType }, body })
  }

  return {
    async version() {
      const file = dataFileId ? { id: dataFileId } : await findDataFile()
      if (!file) return null
      try {
        return await fileVersion(file.id)
      } catch (error) {
        if (error instanceof DriveRequestError && error.status === 404) {
          dataFileId = null
          return null
        }
        throw error
      }
    },

    async read(): Promise<RemoteFile | null> {
      const files = await listDataFiles()
      if (files.length === 0) {
        dataFileId = null
        return null
      }
      dataFileId = files[0]!.id
      duplicates = files.slice(1).map((f) => f.id)
      let snapshot = await readFile(dataFileId)
      for (const extra of duplicates) snapshot = mergeSnapshots(snapshot, await readFile(extra), now())
      // The version is read after the content: an upload in between makes the later write see a conflict.
      return { snapshot, version: await fileVersion(dataFileId) }
    },

    async write(snapshot, expected) {
      const content = new Blob([encodeRemote(snapshot, { now: now(), deviceId: options.deviceId })], { type: 'application/json' })
      if (dataFileId === null) {
        if (expected !== null || (await findDataFile())) throw new RemoteConflictError()
        const created = await createFile(DRIVE_DATA_FILE, content)
        dataFileId = created.id
        return created.version ?? '1'
      }
      if ((await fileVersion(dataFileId)) !== expected) throw new RemoteConflictError()
      const updated = await json<DriveFile>(`${UPLOAD}/files/${dataFileId}?uploadType=media&fields=id,version`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: content,
      })
      // Their content is in this upload now.
      for (const extra of duplicates.splice(0)) await request(`${API}/files/${extra}`, { method: 'DELETE' }).catch(() => undefined)
      return updated.version ?? expected ?? '1'
    },

    async listAttachments() {
      const result = new Map<string, string>()
      const q = encodeURIComponent(`name contains '${ATTACHMENT_FILE_PREFIX}' and trashed = false`)
      let pageToken: string | undefined
      do {
        const body = await json<{ files: DriveFile[]; nextPageToken?: string }>(
          `${API}/files?spaces=appDataFolder&q=${q}&fields=nextPageToken,files(id,name)&pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ''}`,
        )
        for (const file of body.files) if (file.name?.startsWith(ATTACHMENT_FILE_PREFIX)) result.set(file.name.slice(ATTACHMENT_FILE_PREFIX.length), file.id)
        pageToken = body.nextPageToken
      } while (pageToken)
      return result
    },

    async uploadAttachment(attachmentId, blob, mimeType) {
      await createFile(attachmentFileName(attachmentId), blob.type ? blob : new Blob([blob], { type: mimeType }))
    },

    async downloadAttachment(remoteId) {
      return (await request(`${API}/files/${remoteId}?alt=media`)).blob()
    },

    async deleteAttachment(remoteId) {
      await request(`${API}/files/${remoteId}`, { method: 'DELETE' })
    },
  }
}
