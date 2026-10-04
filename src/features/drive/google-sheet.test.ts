import { describe, expect, it } from 'vitest'
import { GoogleAuthError } from '@/lib/google/auth'
import { createGoogleSheetMirror, sheetUrl } from './google-sheet'
import type { SheetTab } from './sheet-tabs'

interface Call {
  method: string
  url: string
  body: unknown
}

/** A tiny fake of the Drive + Sheets REST endpoints the mirror uses. */
function fakeGoogleApis() {
  const calls: Call[] = []
  const sheets = new Map<string, { titles: string[]; values: Record<string, unknown[][]>; marked: boolean }>()
  let next = 1
  const state = { calls, sheets, deleteNext: false, unauthorized: false, inputOptions: [] as string[] }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, body })
    if (state.unauthorized) return new Response('', { status: 401 })
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?')) return json({ files: [...sheets].filter(([, s]) => s.marked).map(([id]) => ({ id })) })
    const drivePatch = url.match(/drive\/v3\/files\/([^?]+)/)
    if (drivePatch && method === 'PATCH') {
      sheets.get(drivePatch[1]!)!.marked = body.appProperties.pfMirror === '1'
      return json({ id: drivePatch[1] })
    }
    if (url === 'https://sheets.googleapis.com/v4/spreadsheets' && method === 'POST') {
      const id = `sheet-${next++}`
      sheets.set(id, { titles: body.sheets.map((s: { properties: { title: string } }) => s.properties.title), values: {}, marked: false })
      return json({ spreadsheetId: id, sheets: body.sheets.map((_: unknown, i: number) => ({ properties: { sheetId: i } })) })
    }
    const m = url.match(/spreadsheets\/([^/?:]+)(.*)$/)
    if (m) {
      const sheet = sheets.get(m[1]!)
      if (!sheet || state.deleteNext) {
        state.deleteNext = false
        if (sheet) sheets.delete(m[1]!)
        return json({ error: 'not found' }, 404)
      }
      const rest = m[2]!
      if (rest.startsWith('?fields=')) return json({ sheets: sheet.titles.map((title) => ({ properties: { title } })) })
      if (rest === ':batchUpdate') {
        for (const r of body.requests) if (r.addSheet) sheet.titles.push(r.addSheet.properties.title)
        return json({})
      }
      if (rest === '/values:batchClear') {
        for (const range of body.ranges) delete sheet.values[range]
        return json({})
      }
      if (rest === '/values:batchUpdate') {
        state.inputOptions.push(body.valueInputOption)
        for (const d of body.data) sheet.values[d.range.replace('!A1', '')] = d.values
        return json({})
      }
    }
    return json({ error: `unexpected ${method} ${url}` }, 500)
  }) as typeof globalThis.fetch
  return { ...state, state, fetch }
}

const tabs: SheetTab[] = [
  { title: 'เกี่ยวกับ', header: ['about'], rows: [] },
  { title: 'รายการ', header: ['วันที่', 'รายละเอียด'], rows: [['2026-10-01', '=1+1']] },
]

describe('read-only Google Sheet', () => {
  it('creates the sheet once, marks it, and writes every tab as raw values', async () => {
    const api = fakeGoogleApis()
    const mirror = createGoogleSheetMirror({ getToken: async () => 'token', fetch: api.fetch })
    const url = await mirror.publish(tabs)
    expect(url).toBe(sheetUrl('sheet-1'))
    const sheet = api.sheets.get('sheet-1')!
    expect(sheet.marked).toBe(true)
    expect(api.state.inputOptions).toEqual(['RAW'])
    expect(sheet.values["'รายการ'"]).toEqual([
      ['วันที่', 'รายละเอียด'],
      ['2026-10-01', '=1+1'],
    ])
  })

  it('another device finds the same sheet instead of creating a second one', async () => {
    const api = fakeGoogleApis()
    await createGoogleSheetMirror({ getToken: async () => 't', fetch: api.fetch }).publish(tabs)
    const url = await createGoogleSheetMirror({ getToken: async () => 't', fetch: api.fetch }).publish(tabs)
    expect(url).toBe(sheetUrl('sheet-1'))
    expect(api.sheets.size).toBe(1)
  })

  it('brings back a tab the user deleted', async () => {
    const api = fakeGoogleApis()
    const mirror = createGoogleSheetMirror({ getToken: async () => 't', fetch: api.fetch })
    await mirror.publish(tabs)
    api.sheets.get('sheet-1')!.titles = ['เกี่ยวกับ']
    await mirror.publish(tabs)
    expect(api.sheets.get('sheet-1')!.titles).toEqual(['เกี่ยวกับ', 'รายการ'])
  })

  it('makes a new sheet when the old one was deleted', async () => {
    const api = fakeGoogleApis()
    const mirror = createGoogleSheetMirror({ getToken: async () => 't', fetch: api.fetch })
    await mirror.publish(tabs)
    api.state.deleteNext = true
    expect(await mirror.publish(tabs)).toBe(sheetUrl('sheet-2'))
  })

  it('an expired token asks for sign-in', async () => {
    const api = fakeGoogleApis()
    api.state.unauthorized = true
    await expect(createGoogleSheetMirror({ getToken: async () => 't', fetch: api.fetch }).publish(tabs)).rejects.toBeInstanceOf(GoogleAuthError)
  })
})
