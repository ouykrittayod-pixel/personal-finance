/**
 * Reads .xlsx / .xls in the browser with SheetJS (loaded only here, on demand).
 * The file never leaves the device. Cells are read as stored: numbers stay
 * numbers, text stays text, and date-formatted numbers become YYYY-MM-DD from
 * the workbook's own date system (no time zone conversion).
 */
import type { CellValue, ParsedWorkbook, SheetGrid } from '@/domain/import'

export const ACCEPTED_EXTENSIONS = ['.xlsx', '.xls'] as const
export const ACCEPT_ATTRIBUTE = '.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel'

export class WorkbookError extends Error {
  readonly kind: 'unsupported_type' | 'unreadable' | 'empty'
  constructor(kind: WorkbookError['kind'], cause?: unknown) {
    super(kind, cause === undefined ? undefined : { cause })
    this.name = 'WorkbookError'
    this.kind = kind
  }
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

export async function parseWorkbook(file: { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> }): Promise<ParsedWorkbook> {
  if (!ACCEPTED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) throw new WorkbookError('unsupported_type')
  const bytes = new Uint8Array(await file.arrayBuffer())
  // Only real workbooks: .xlsx is a ZIP (PK..), .xls an OLE file (D0 CF 11 E0). SheetJS would otherwise read any bytes as text.
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
  const ole = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0
  if (!zip && !ole) throw new WorkbookError('unreadable')
  const XLSX = await import('xlsx')
  let workbook: import('xlsx').WorkBook
  try {
    workbook = XLSX.read(bytes, { type: 'array', cellDates: false, cellNF: true, dense: true, cellHTML: false })
  } catch (error) {
    throw new WorkbookError('unreadable', error)
  }
  const date1904 = !!workbook.Workbook?.WBProps?.date1904

  const sheets: SheetGrid[] = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name]!
    const ref = sheet['!ref']
    if (!ref) return { name, firstRowNumber: 1, rows: [], columnCount: 0 }
    const range = XLSX.utils.decode_range(ref)
    const dense = (sheet as unknown as { '!data'?: (import('xlsx').CellObject | undefined)[][] })['!data'] ?? []
    const rows: CellValue[][] = []
    // Columns always start at A so column letters match Excel; rows keep their Excel numbers.
    for (let r = range.s.r; r <= range.e.r; r++) {
      const source = dense[r] ?? []
      const row: CellValue[] = []
      for (let c = 0; c <= range.e.c; c++) {
        const cell = source[c]
        row.push(cell ? toValue(cell, XLSX.SSF, date1904) : null)
      }
      rows.push(row)
    }
    return { name, firstRowNumber: range.s.r + 1, rows, columnCount: range.e.c + 1 }
  })
  if (sheets.length === 0) throw new WorkbookError('empty')
  return { fileName: file.name, fileSize: file.size, sheets }
}

function toValue(cell: import('xlsx').CellObject, SSF: typeof import('xlsx').SSF, date1904: boolean): CellValue {
  switch (cell.t) {
    case 'n': {
      const value = cell.v as number
      if (cell.z && SSF.is_date(cell.z)) {
        const parts = SSF.parse_date_code(value, { date1904 })
        if (parts && parts.y > 0) return { kind: 'date', iso: `${pad(parts.y, 4)}-${pad(parts.m)}-${pad(parts.d)}` }
      }
      return value
    }
    case 's':
      return String(cell.v ?? '')
    case 'b':
      return Boolean(cell.v)
    case 'd': {
      const date = cell.v as Date
      return { kind: 'date', iso: `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` }
    }
    case 'e':
      return cell.w ?? '#ERROR'
    default:
      return null
  }
}
