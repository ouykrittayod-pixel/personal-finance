/**
 * Test-only: synthetic Excel workbooks for the Import Center (no real data).
 * Built in memory with SheetJS, then read back through the real parser.
 */
import * as XLSX from 'xlsx'

/** A real Excel date (number + date format), like a date typed into Excel. */
export class XDate {
  readonly iso: string
  constructor(iso: string) {
    this.iso = iso
  }
}
export const xd = (iso: string) => new XDate(iso)
type Cell = string | number | boolean | XDate | null

const serialOf = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return (Date.UTC(y!, m! - 1, d!) - Date.UTC(1899, 11, 30)) / 86_400_000
}

export interface FixtureSheet {
  name: string
  rows: Cell[][]
}

export function xlsxFile(name: string, sheets: FixtureSheet[], bookType: 'xlsx' | 'biff8' = 'xlsx') {
  const workbook = XLSX.utils.book_new()
  for (const sheet of sheets) {
    const plain = sheet.rows.map((row) => row.map((cell) => (cell instanceof XDate ? serialOf(cell.iso) : cell)))
    const ws = XLSX.utils.aoa_to_sheet(plain)
    sheet.rows.forEach((row, r) =>
      row.forEach((cell, c) => {
        if (cell instanceof XDate) ws[XLSX.utils.encode_cell({ r, c })] = { t: 'n', v: serialOf(cell.iso), z: 'dd/mm/yyyy' }
      }),
    )
    XLSX.utils.book_append_sheet(workbook, ws, sheet.name)
  }
  const bytes = XLSX.write(workbook, { type: 'array', bookType }) as ArrayBuffer
  return { name, size: bytes.byteLength, arrayBuffer: async () => bytes }
}

const HEAD = ['วันที่', 'ประเภท', 'จำนวนเงิน', 'บัญชี', 'หมวดหมู่', 'รายละเอียด', 'หมายเหตุ']

/** A personal ledger with a title row above the header and a blank row. */
export const cleanLedger = () =>
  xlsxFile('ledger.xlsx', [
    {
      name: 'รายการ',
      rows: [
        ['บันทึกรายรับรายจ่าย ปี 2026', null, null, null, null, null, null],
        [null, null, null, null, null, null, null],
        HEAD,
        [xd('2026-09-03'), 'รายจ่าย', '2,500.00', 'Cash', 'อาหาร', 'ข้าวกลางวัน', null],
        [xd('2026-09-07'), 'รายจ่าย', 3550, 'บัตร KBank', 'ช้อปปิ้ง', 'เสื้อ', 'ซื้อด้วยบัตร'],
        [xd('2026-09-25'), 'รายรับ', '฿27,500', 'KBank', 'เงินเดือน', 'เงินเดือนกันยายน', null],
        [null, null, null, null, null, null, null],
        [xd('2026-09-20'), 'ชำระหนี้', '3,000', 'KBank', null, 'ชำระบัตร', null],
        [xd('2026-09-05'), 'โอน', '5000.00', 'KBank', null, 'ถอนเงินสด', null],
      ],
    },
  ])

export const debtFile = () =>
  xlsxFile('loan.xlsx', [
    {
      name: 'ผ่อนบ้าน',
      rows: [
        ['วันที่', 'ประเภท', 'จำนวนเงิน', 'บัญชี', 'หนี้', 'เงินต้น', 'ดอกเบี้ย', 'ค่าธรรมเนียม'],
        [xd('2026-09-25'), 'ชำระหนี้', 7800, 'KBank', 'สินเชื่อบ้าน', 6000, 1800, 0],
        [xd('2026-10-25'), 'ชำระหนี้', 7800, 'KBank', 'สินเชื่อบ้าน', 6500, 1800, 0],
        [xd('2026-11-25'), 'ชำระหนี้', 7800, 'KBank', 'สินเชื่อบ้าน', null, null, null],
      ],
    },
  ])

export const openingFile = () =>
  xlsxFile('opening.xlsx', [
    {
      name: 'ยอดยกมา',
      rows: [
        ['วันที่', 'ประเภท', 'จำนวนเงิน', 'บัญชี'],
        [xd('2026-09-01'), 'ยอดยกมา', '50,000.00', 'KBank'],
        [xd('2026-09-01'), 'ยอดยกมา', '-1,200.00', 'บัตร KBank'],
      ],
    },
  ])

export const textDates = () =>
  xlsxFile('dates.xlsx', [
    {
      name: 'Sheet1',
      rows: [
        ['Date', 'Type', 'Amount', 'Account', 'Category', 'Description'],
        ['03/04/2026', 'expense', '100', 'Cash', 'Food', 'ambiguous'],
        ['25/09/2026', 'expense', '200', 'Cash', 'Food', 'day first'],
        ['2026-09-26', 'expense', '300', 'Cash', 'Food', 'iso'],
        ['26 ก.ย. 2569', 'expense', '400', 'Cash', 'Food', 'thai buddhist'],
        ['31/02/2026', 'expense', '500', 'Cash', 'Food', 'impossible'],
        ['26/09/26', 'expense', '600', 'Cash', 'Food', 'two digit year'],
        ['yesterday', 'expense', '700', 'Cash', 'Food', 'not a date'],
      ],
    },
  ])

export const problemRows = () =>
  xlsxFile('problems.xlsx', [
    {
      name: 'Sheet1',
      rows: [
        ['วันที่', 'ประเภท', 'จำนวนเงิน', 'บัญชี', 'หมวดหมู่', 'รายละเอียด'],
        [xd('2026-09-01'), 'รายจ่าย', 'abc', 'Cash', 'อาหาร', 'invalid amount'],
        [xd('2026-09-02'), 'รายจ่าย', null, 'Cash', 'อาหาร', 'missing amount'],
        [xd('2026-09-03'), 'รายจ่าย', '12.345', 'Cash', 'อาหาร', 'three decimals'],
        [xd('2026-09-04'), 'รายจ่าย', '-250', 'Cash', 'อาหาร', 'negative'],
        [xd('2026-09-05'), 'ของขวัญ', '100', 'Cash', 'อาหาร', 'unknown type'],
        [xd('2026-09-06'), 'รายจ่าย', '100', 'SCB', 'อาหาร', 'unknown account'],
        [xd('2026-09-07'), 'รายจ่าย', '100', 'Cash', 'สัตว์เลี้ยง', 'unknown category'],
        [xd('2026-09-08'), 'รายจ่าย', '100', null, 'อาหาร', 'missing account'],
        [xd('2026-09-09'), 'รายจ่าย', '100', 'Cash', null, 'missing category'],
        [xd('2026-09-10'), 'รายจ่าย', '80', 'Cash', 'อาหาร', 'กาแฟ'],
        [xd('2026-09-10'), 'รายจ่าย', '80', 'Cash', 'อาหาร', 'กาแฟ'],
        [xd('2026-09-11'), 'รายจ่าย', 'Infinity', 'Cash', 'อาหาร', 'infinity'],
        ['รวม', null, '1,000', null, null, null],
      ],
    },
  ])

/** Resembles a business "sale history by customer" export — not personal money. */
export const salesFile = () =>
  xlsxFile('Sale History (synthetic).xlsx', [
    {
      name: 'Sheet1',
      rows: [
        ['Sale History Lookup by Customer', null, null, null, null, null],
        ['Customer', 'Invoice No', 'Date', 'Item', 'Qty', 'Amount'],
        ['บริษัท ตัวอย่าง จำกัด', 'INV-0001', xd('2026-09-01'), 'Product A', 2, '12,000.00'],
        ['บริษัท ตัวอย่าง จำกัด', 'INV-0001', xd('2026-09-01'), 'Product B', 1, '3,500.00'],
        ['ร้านทดสอบ', 'INV-0002', xd('2026-09-02'), 'Product A', 5, '30,000.00'],
      ],
    },
  ])

export const receivableFile = () =>
  xlsxFile('Receivable (synthetic).xlsx', [
    {
      name: 'AR',
      rows: [
        ['Customer', 'Invoice', 'Invoice Date', 'Due Date', 'Outstanding'],
        ['ลูกค้า ก', 'INV-1', xd('2026-08-01'), xd('2026-08-31'), '5,000.00'],
      ],
    },
  ])

/** Two sheets: a ledger and a lookup list. */
export const mixedFile = () =>
  xlsxFile('mixed.xlsx', [
    {
      name: 'Ledger',
      rows: [
        ['Date', 'Amount', 'Description', 'Category'],
        [xd('2026-09-01'), '50', 'Coffee', 'Food'],
      ],
    },
    { name: 'Lists', rows: [['Categories'], ['Food'], ['Transport']] },
    { name: 'Empty', rows: [] },
  ])

/** 10,000 ledger rows. */
export function bigLedger(count = 10_000) {
  const rows: Cell[][] = [HEAD]
  const kinds = ['รายจ่าย', 'รายจ่าย', 'รายจ่าย', 'รายรับ']
  for (let i = 0; i < count; i++) {
    const day = String(1 + (i % 28)).padStart(2, '0')
    const month = String(1 + (i % 9)).padStart(2, '0')
    const kind = kinds[i % 4]!
    rows.push([
      xd(`2026-${month}-${day}`),
      kind,
      `${(i % 900) + 10}.${String(i % 100).padStart(2, '0')}`,
      i % 2 ? 'Cash' : 'KBank',
      kind === 'รายรับ' ? 'เงินเดือน' : 'อาหาร',
      `รายการ ${i}`,
      null,
    ])
  }
  return xlsxFile(`big-${count}.xlsx`, [{ name: 'Data', rows }])
}
