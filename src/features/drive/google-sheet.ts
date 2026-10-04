/**
 * The read-only Google Sheet in the user's Drive: created by the app (scope
 * drive.file, so the app can only see files it made), found again from any
 * device by a private app property, and rewritten in full on each update.
 * Values are written RAW: text is never interpreted as a formula.
 */
import { forgetAccessToken, GoogleAuthError } from '@/lib/google/auth'
import { DriveRequestError, OfflineError } from './google-drive-store'
import { SHEET_TITLE, type SheetTab } from './sheet-tabs'

const DRIVE = 'https://www.googleapis.com/drive/v3'
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets'
const MIRROR_PROPERTY = 'pfMirror'

export interface SheetMirror {
  /** Write all tabs; returns the sheet's URL. */
  publish(tabs: SheetTab[]): Promise<string>
}

export const sheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}`
const quote = (title: string) => `'${title.replace(/'/g, "''")}'`

export function createGoogleSheetMirror(options: { getToken: () => Promise<string>; fetch?: typeof fetch }): SheetMirror {
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init))
  let spreadsheetId: string | null = null

  async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
    const token = await options.getToken()
    let response: Response
    try {
      response = await doFetch(url, {
        ...init,
        headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}` },
      })
    } catch {
      throw new OfflineError()
    }
    if (response.status === 401) {
      forgetAccessToken()
      throw new GoogleAuthError('sign_in_required')
    }
    if (!response.ok) throw new DriveRequestError(response.status)
    return (response.status === 204 ? undefined : await response.json()) as T
  }

  async function find(): Promise<string | null> {
    const q = encodeURIComponent(`appProperties has { key='${MIRROR_PROPERTY}' and value='1' } and trashed = false`)
    const body = await call<{ files: { id: string }[] }>(`${DRIVE}/files?q=${q}&fields=files(id)&orderBy=createdTime&pageSize=5`)
    return body.files[0]?.id ?? null
  }

  async function create(tabs: SheetTab[]): Promise<string> {
    const created = await call<{ spreadsheetId: string; sheets: { properties: { sheetId: number } }[] }>(SHEETS, {
      method: 'POST',
      body: JSON.stringify({
        properties: { title: SHEET_TITLE, locale: 'th_TH', timeZone: 'Asia/Bangkok' },
        sheets: tabs.map((tab) => ({ properties: { title: tab.title, gridProperties: { frozenRowCount: 1 } } })),
      }),
    })
    // Mark it so every device finds this one sheet (the app can only see files it created).
    await call(`${DRIVE}/files/${created.spreadsheetId}?fields=id`, { method: 'PATCH', body: JSON.stringify({ appProperties: { [MIRROR_PROPERTY]: '1' } }) })
    await call(`${SHEETS}/${created.spreadsheetId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        requests: created.sheets.map((sheet) => ({
          repeatCell: { range: { sheetId: sheet.properties.sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' },
        })),
      }),
    })
    return created.spreadsheetId
  }

  /** Tabs the user deleted come back. */
  async function ensureTabs(id: string, tabs: SheetTab[]) {
    const body = await call<{ sheets: { properties: { title: string } }[] }>(`${SHEETS}/${id}?fields=sheets.properties.title`)
    const existing = new Set(body.sheets.map((s) => s.properties.title))
    const missing = tabs.filter((tab) => !existing.has(tab.title))
    if (missing.length)
      await call(`${SHEETS}/${id}:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({ requests: missing.map((tab) => ({ addSheet: { properties: { title: tab.title, gridProperties: { frozenRowCount: 1 } } } })) }),
      })
  }

  async function write(id: string, tabs: SheetTab[]) {
    await call(`${SHEETS}/${id}/values:batchClear`, { method: 'POST', body: JSON.stringify({ ranges: tabs.map((tab) => quote(tab.title)) }) })
    await call(`${SHEETS}/${id}/values:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ valueInputOption: 'RAW', data: tabs.map((tab) => ({ range: `${quote(tab.title)}!A1`, values: [tab.header, ...tab.rows] })) }),
    })
  }

  return {
    async publish(tabs) {
      for (let attempt = 0; attempt < 2; attempt++) {
        spreadsheetId ??= await find()
        if (!spreadsheetId) spreadsheetId = await create(tabs)
        else
          try {
            await ensureTabs(spreadsheetId, tabs)
          } catch (error) {
            // Deleted by the user: make a new one.
            if (error instanceof DriveRequestError && error.status === 404 && attempt === 0) {
              spreadsheetId = null
              continue
            }
            throw error
          }
        await write(spreadsheetId, tabs)
        return sheetUrl(spreadsheetId)
      }
      throw new DriveRequestError(404)
    },
  }
}
