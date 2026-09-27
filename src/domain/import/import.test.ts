import { describe, expect, it } from 'vitest'
import { parseWorkbook, WorkbookError } from '@/features/import/import-parser'
import { baht, makeAccount, makeCategory, makeDebt, makeTx } from '@/test/factories'
import {
  bigLedger,
  cleanLedger,
  debtFile,
  mixedFile,
  openingFile,
  problemRows,
  receivableFile,
  salesFile,
  textDates,
  xd,
  xlsxFile,
} from '@/test/import-fixtures'
import {
  appliedTargets,
  buildPreview,
  classifyDataset,
  detectHeaderRow,
  distinctValues,
  matchTypeValues,
  matchValues,
  parseDate,
  parseMoney,
  previewToCsv,
  previewToJson,
  profileColumns,
  suggestMapping,
  type ColumnMapping,
  type ExistingData,
  type ImportOptions,
  type PreviewResult,
  type ValueField,
  type ValueMappings,
} from '.'

const existing: ExistingData = {
  accounts: [
    makeAccount({ id: 'cash', name: 'Cash', kind: 'cash' }),
    makeAccount({ id: 'kbank', name: 'KBank', kind: 'bank' }),
    makeAccount({ id: 'card', name: 'บัตร KBank', kind: 'credit_card' }),
  ],
  categories: [
    makeCategory({ id: 'food', name: 'อาหาร' }),
    makeCategory({ id: 'shop', name: 'ช้อปปิ้ง' }),
    makeCategory({ id: 'salary', name: 'เงินเดือน', kind: 'income' }),
  ],
  debts: [
    makeDebt({ id: 'home', name: 'สินเชื่อบ้าน', kind: 'mortgage', openingBalanceSatang: baht(1_200_000), openingDate: '2026-01-01' }),
    makeDebt({ id: 'cc', name: 'บัตร KBank', kind: 'credit_card', linkedAccountId: 'card' }),
  ],
  transactions: [],
}

/** The whole pipeline with the suggested mapping and exact matches only (what the UI starts from). */
async function run(
  file: ReturnType<typeof xlsxFile>,
  options: Partial<ImportOptions> = {},
  change?: (m: ColumnMapping, v: ValueMappings) => void,
  data = existing,
) {
  const workbook = await parseWorkbook(file)
  const sheet = workbook.sheets[0]!
  const header = detectHeaderRow(sheet)
  const profiles = profileColumns(sheet, header.index)
  const dataset = classifyDataset(profiles)
  const mapping = suggestMapping(profiles)
  const rows = sheet.rows.slice(header.index + 1)
  const column = (field: keyof ColumnMapping) => (mapping[field] === null ? [] : rows.map((row) => row[mapping[field]!] ?? null))
  const targets = {
    account: data.accounts.map((a) => ({ id: a.id, name: a.name })),
    category: data.categories.map((c) => ({ id: c.id, name: c.name })),
    debt: data.debts.map((d) => ({ id: d.id, name: d.name })),
  }
  const values: ValueMappings = {
    type: appliedTargets(matchTypeValues(distinctValues(column('type')))),
    account: appliedTargets(matchValues(distinctValues(column('account')), targets.account)),
    toAccount: appliedTargets(matchValues(distinctValues(column('toAccount')), targets.account)),
    category: appliedTargets(matchValues(distinctValues(column('category')), targets.category)),
    debt: appliedTargets(matchValues(distinctValues(column('debt')), targets.debt)),
  }
  change?.(mapping, values)
  const result = buildPreview({
    fileName: file.name,
    sheet,
    headerIndex: header.index,
    mapping,
    values,
    options: { rowTypeMode: mapping.type === null ? 'none' : 'column', dateFormat: 'auto', ...options },
    dataset,
    existing: data,
  })
  return { workbook, sheet, header, profiles, dataset, mapping, values, result }
}

const row = (result: PreviewResult, excelRow: number) => result.rows.find((r) => r.source.rowNumber === excelRow)!
const codes = (result: PreviewResult, excelRow: number) => row(result, excelRow).messages.map((m) => m.code)

describe('parser', () => {
  it('reads sheets, keeps Excel row numbers, real dates as YYYY-MM-DD, numbers as numbers', async () => {
    const workbook = await parseWorkbook(cleanLedger())
    expect(workbook).toMatchObject({ fileName: 'ledger.xlsx', sheets: [{ name: 'รายการ', firstRowNumber: 1, columnCount: 7 }] })
    const grid = workbook.sheets[0]!
    expect(grid.rows[3]![0]).toEqual({ kind: 'date', iso: '2026-09-03' })
    expect(grid.rows[4]![2]).toBe(3550)
    expect(grid.rows[3]![2]).toBe('2,500.00')
  })

  it('several sheets (incl. empty); legacy .xls; rejects other files', async () => {
    const mixed = await parseWorkbook(mixedFile())
    expect(mixed.sheets.map((s) => [s.name, s.rows.length])).toEqual([
      ['Ledger', 2],
      ['Lists', 3],
      ['Empty', 0],
    ])
    const xls = await parseWorkbook({
      ...xlsxFile(
        'old.xls',
        [
          {
            name: 'S',
            rows: [
              ['Date', 'Amount'],
              [xd('2026-01-02'), 5],
            ],
          },
        ],
        'biff8',
      ),
      name: 'old.xls',
    })
    expect(xls.sheets[0]!.rows[1]).toEqual([{ kind: 'date', iso: '2026-01-02' }, 5])
    await expect(parseWorkbook({ name: 'notes.txt', size: 1, arrayBuffer: async () => new ArrayBuffer(1) })).rejects.toBeInstanceOf(WorkbookError)
    await expect(parseWorkbook({ name: 'broken.xlsx', size: 3, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer })).rejects.toMatchObject({
      kind: 'unreadable',
    })
  })
})

describe('detection (suggestions)', () => {
  it('finds the header below a title row; profiles types, fill and meaning', async () => {
    const { header, profiles } = await run(cleanLedger())
    expect(header.index).toBe(2)
    const byName = Object.fromEntries(profiles.map((p) => [p.name, p]))
    expect(byName['วันที่']).toMatchObject({ type: 'date', semantic: 'date', nonEmpty: 5, empty: 0, populatedPct: 100 })
    expect(byName['จำนวนเงิน']).toMatchObject({ semantic: 'amount' })
    expect(byName['หมายเหตุ']).toMatchObject({ semantic: 'note', nonEmpty: 1, populatedPct: 20 })
    expect(byName['ประเภท']).toMatchObject({ type: 'text', semantic: 'type' })
  })

  it('suggests a mapping from the headers', async () => {
    const { mapping } = await run(cleanLedger())
    expect(mapping).toMatchObject({ date: 0, type: 1, amount: 2, account: 3, category: 4, description: 5, note: 6, debt: null, toAccount: null })
  })

  it('classifies datasets; business data is never personal by default', async () => {
    expect((await run(cleanLedger())).dataset).toMatchObject({ kind: 'transaction_history', personal: true })
    expect((await run(salesFile())).dataset).toMatchObject({ kind: 'sales_history', personal: false })
    expect((await run(receivableFile())).dataset).toMatchObject({ kind: 'receivables', personal: false })
    expect((await run(debtFile())).dataset).toMatchObject({ kind: 'debt_schedule', personal: true })
    const lists = await parseWorkbook(mixedFile())
    expect(classifyDataset(profileColumns(lists.sheets[1]!, 0)).kind).toBe('unknown')
    expect((await run(salesFile())).header.index).toBe(1)
  })

  it('matching: exact names are matched, synonyms and partial names only suggested', () => {
    const accounts = existing.accounts.map((a) => ({ id: a.id, name: a.name }))
    const categories = existing.categories.map((c) => ({ id: c.id, name: c.name }))
    expect(matchValues([{ value: ' kbank ', count: 1 }], accounts)[0]).toMatchObject({ status: 'matched', targetId: 'kbank' })
    expect(matchValues([{ value: 'Food', count: 3 }], categories)[0]).toMatchObject({ status: 'suggested', targetId: 'food', reason: 'synonym' })
    expect(matchValues([{ value: 'SCB', count: 1 }], accounts)[0]).toMatchObject({ status: 'unmatched', targetId: null })
    expect(appliedTargets(matchValues([{ value: 'Food', count: 3 }], categories))).toEqual({ Food: null })
    expect(matchTypeValues([{ value: 'ของขวัญ', count: 1 }])[0]).toMatchObject({ status: 'unmatched' })
  })
})

describe('normalization', () => {
  it.each([
    ['27,500.00', 2_750_000],
    ['฿27,500', 2_750_000],
    ['27500.5', 2_750_050],
    ['  1,234.56 บาท ', 123_456],
    ['(1,200.00)', -120_000],
    ['-250', -25_000],
    [3550, 355_000],
    [12.3, 1_230],
  ])('money %s → %i satang', (input, satang) => {
    expect(parseMoney(input)).toEqual({ ok: true, satang })
  })

  it.each([
    ['abc', 'invalid'],
    ['1,23,4', 'invalid'],
    ['NaN', 'invalid'],
    ['Infinity', 'invalid'],
    ['12.345', 'too_precise'],
    ['', 'empty'],
  ])('money %s → %s (never rounded)', (input, reason) => {
    expect(parseMoney(input)).toEqual({ ok: false, reason })
    expect(parseMoney(Number.NaN)).toEqual({ ok: false, reason: 'invalid' })
    expect(parseMoney(1.005)).toEqual({ ok: false, reason: 'too_precise' })
  })

  it('dates: exact Excel dates, unambiguous text, flagged ambiguity, พ.ศ. converted and reported', () => {
    expect(parseDate({ kind: 'date', iso: '2026-09-30' }, 'auto')).toEqual({ ok: true, iso: '2026-09-30' })
    expect(parseDate('03/04/2026', 'auto')).toEqual({ ok: false, reason: 'ambiguous' })
    expect(parseDate('03/04/2026', 'DMY')).toEqual({ ok: true, iso: '2026-04-03' })
    expect(parseDate('03/04/2026', 'MDY')).toEqual({ ok: true, iso: '2026-03-04' })
    expect(parseDate('25/09/2026', 'auto')).toEqual({ ok: true, iso: '2026-09-25' })
    expect(parseDate('26 ก.ย. 2569', 'auto')).toEqual({ ok: true, iso: '2026-09-26', buddhistYear: true })
    expect(parseDate('31/02/2026', 'DMY')).toEqual({ ok: false, reason: 'invalid' })
    expect(parseDate('26/09/26', 'auto')).toEqual({ ok: false, reason: 'two_digit_year' })
    expect(parseDate(45_000, 'auto')).toEqual({ ok: false, reason: 'not_a_date' })
  })
})

describe('preview: validation and classification', () => {
  it('clean ledger: row numbers from Excel, blank rows skipped, card purchase is an expense; missing debt / destination are errors', async () => {
    const { result } = await run(cleanLedger())
    expect(result.summary).toMatchObject({ sourceRows: 5, blankRowsSkipped: 1 })
    expect(row(result, 4)).toMatchObject({
      status: 'ready',
      classification: 'expense',
      normalized: { date: '2026-09-03', amountSatang: 250_000, accountId: 'cash', categoryId: 'food', description: 'ข้าวกลางวัน' },
    })
    expect(row(result, 5)).toMatchObject({
      status: 'ready',
      classification: 'expense',
      normalized: { accountId: 'card', categoryId: 'shop', note: 'ซื้อด้วยบัตร' },
    })
    expect(row(result, 6)).toMatchObject({ status: 'ready', classification: 'income', normalized: { amountSatang: 2_750_000, categoryId: 'salary' } })
    expect(row(result, 8)).toMatchObject({ status: 'error', classification: 'debt_payment' })
    expect(codes(result, 8)).toContain('debt_missing')
    expect(codes(result, 9)).toContain('toAccount_missing')
    expect(row(result, 4).source).toEqual({ fileName: 'ledger.xlsx', sheetName: 'รายการ', rowNumber: 4 })
    expect(row(result, 4).original).toMatchObject({ วันที่: '2026-09-03', จำนวนเงิน: '2,500.00', บัญชี: 'Cash' })
  })

  it('card payment: a debt payment into the card account, never an expense; transfer into a card is refused', async () => {
    const withDebt = xlsxFile('card.xlsx', [
      {
        name: 'S',
        rows: [
          ['วันที่', 'ประเภท', 'จำนวนเงิน', 'บัญชี', 'หนี้', 'ไปบัญชี'],
          [xd('2026-09-07'), 'รายจ่าย', 1200, 'บัตร KBank', null, null],
          [xd('2026-09-20'), 'ชำระหนี้', 1200, 'KBank', 'บัตร KBank', null],
          [xd('2026-09-21'), 'โอน', 1200, 'KBank', null, 'บัตร KBank'],
        ],
      },
    ])
    const { result } = await run(withDebt, {}, (m, v) => {
      m.debt = 4
      m.toAccount = 5
      m.category = null
      v.debt = { 'บัตร KBank': 'cc' }
      v.toAccount = { 'บัตร KBank': 'card' }
    })
    expect(codes(result, 2)).toContain('category_missing') // an expense needs a category — never guessed
    expect(row(result, 3)).toMatchObject({
      status: 'ready',
      classification: 'debt_payment',
      normalized: { debtId: 'cc', toAccountId: 'card', amountSatang: 120_000 },
    })
    expect(codes(result, 4)).toContain('rule_transfer_liability_not_allowed')
  })

  it('debt payments: explicit split only; a split that does not add up is an error; no split = unallocated (info)', async () => {
    const { result } = await run(debtFile(), {}, (m, v) => {
      m.debt = 4
      v.debt = { สินเชื่อบ้าน: 'home' }
    })
    expect(row(result, 2)).toMatchObject({ status: 'ready', normalized: { principalSatang: 600_000, interestSatang: 180_000, feeSatang: 0 } })
    expect(codes(result, 3)).toContain('rule_allocation_mismatch')
    expect(row(result, 4).status).toBe('ready')
    expect(codes(result, 4)).toContain('debt_unallocated')
  })

  it('opening balances are account settings, not transactions (negative allowed for a card)', async () => {
    const { result } = await run(openingFile())
    expect(result.summary.openingBalances).toBe(2)
    expect(row(result, 2)).toMatchObject({ classification: 'opening_balance', normalized: { accountId: 'kbank', amountSatang: 5_000_000, date: '2026-09-01' } })
    expect(row(result, 3).normalized.amountSatang).toBe(-120_000)
    expect(codes(result, 2)).toEqual(expect.arrayContaining(['opening_balance_not_transaction', 'opening_balance_replaces_existing']))
    expect(result.rows.every((r) => r.status !== 'error')).toBe(true)
  })

  it('dates: ambiguous and 2-digit years need review until a format is chosen; impossible dates are errors', async () => {
    const food = (_m: ColumnMapping, v: ValueMappings) => void (v.category.Food = 'food')
    const auto = (await run(textDates(), {}, food)).result
    expect(row(auto, 2).status).toBe('review')
    expect(codes(auto, 2)).toContain('date_ambiguous')
    expect(row(auto, 3).normalized.date).toBe('2026-09-25')
    expect(row(auto, 5)).toMatchObject({ normalized: { date: '2026-09-26' } })
    expect(codes(auto, 5)).toContain('buddhist_year_converted')
    expect(codes(auto, 6)).toContain('date_invalid')
    expect(codes(auto, 7)).toContain('date_two_digit_year')
    expect(codes(auto, 8)).toContain('date_invalid')
    const dmy = (await run(textDates(), { dateFormat: 'DMY' }, food)).result
    expect(row(dmy, 2).normalized.date).toBe('2026-04-03')
    expect(codes(dmy, 2)).not.toContain('date_ambiguous')
  })

  it('problem rows: each problem named; nothing dropped; totals add up', async () => {
    const { result } = await run(problemRows())
    expect(codes(result, 2)).toContain('amount_invalid')
    expect(codes(result, 3)).toContain('amount_missing')
    expect(row(result, 4).status).toBe('review')
    expect(codes(result, 4)).toContain('amount_too_precise')
    expect(codes(result, 5)).toContain('amount_negative')
    expect(codes(result, 6)).toContain('type_unknown')
    expect(codes(result, 7)).toContain('account_unmapped')
    expect(codes(result, 8)).toContain('category_unmapped')
    expect(codes(result, 9)).toContain('account_missing')
    expect(codes(result, 10)).toContain('category_missing')
    expect(codes(result, 11)).toContain('possible_duplicate')
    expect(codes(result, 12)).toContain('possible_duplicate')
    expect(row(result, 11).duplicates).toEqual([{ kind: 'file', ref: '12', basis: 'composite' }])
    expect(codes(result, 13)).toContain('amount_invalid')
    expect(codes(result, 14)).toContain('looks_like_total')
    const s = result.summary
    expect(s.sourceRows).toBe(13)
    expect(s.ready + s.errors + s.review + s.ignored).toBe(s.sourceRows)
    expect(s.duplicates).toBe(2)
  })

  it('a row is never an expense just because it has an amount', async () => {
    const noType = xlsxFile('plain.xlsx', [
      {
        name: 'S',
        rows: [
          ['Date', 'Amount', 'Description', 'Account'],
          [xd('2026-09-01'), '-50', 'Coffee', 'Cash'],
          [xd('2026-09-02'), '100', 'Refund', 'Cash'],
        ],
      },
    ])
    const none = (await run(noType)).result
    expect(none.rows.every((r) => r.classification === 'unclassified' && r.status === 'review')).toBe(true)
    expect(none.sheetMessages.map((m) => m.code)).toContain('no_row_type')
    // Only when the user explicitly says the sign means direction:
    const direction = (await run(noType, { rowTypeMode: 'direction' })).result
    expect(direction.rows.map((r) => [r.classification, r.normalized.amountSatang])).toEqual([
      ['expense', 5_000],
      ['income', 10_000],
    ])
  })

  it('an ignored type value is counted as ignored (explicit), not dropped', async () => {
    const { result } = await run(problemRows(), {}, (_m, v) => {
      v.type['ของขวัญ'] = '__ignore'
    })
    expect(row(result, 6).status).toBe('ignored')
    expect(result.summary.ignored).toBe(1)
  })

  it('possible duplicates against existing transactions (date + amount + account + type, same description when both have one)', async () => {
    const data = {
      ...existing,
      transactions: [
        makeTx({
          id: 'old',
          type: 'expense',
          amountSatang: baht(2_500),
          accountId: 'cash',
          categoryId: 'food',
          date: '2026-09-03',
          description: 'ข้าวกลางวัน',
        }),
      ],
    }
    const { result } = await run(cleanLedger(), {}, undefined, data)
    expect(row(result, 4).duplicates).toEqual([{ kind: 'existing', ref: 'old', basis: 'composite' }])
    expect(row(result, 4).status).toBe('warning')
    expect(result.summary).toMatchObject({ duplicates: 1, warnings: 1 })
  })

  it('business sales data: flagged as not personal; invoice lines sharing a number are not duplicates', async () => {
    const { result, mapping } = await run(salesFile())
    expect(result.sheetMessages.map((m) => m.code)).toContain('business_dataset')
    expect(mapping.reference).toBe(1)
    expect(result.rows.every((r) => r.classification === 'unclassified')).toBe(true)
    expect(codes(result, 3)).toContain('shared_reference')
    expect(result.rows.some((r) => r.duplicates.length > 0)).toBe(false)
  })
})

describe('export', () => {
  it('JSON and CSV keep source file, sheet, row, normalized values, classification and status', async () => {
    const { result, mapping, sheet, header } = await run(cleanLedger())
    const json = JSON.parse(
      previewToJson(result, {
        fileName: 'ledger.xlsx',
        sheetName: sheet.name,
        generatedAt: '2026-09-26T00:00:00.000Z',
        mapping,
        columns: profileColumns(sheet, header.index).map((p) => p.name),
        options: { rowTypeMode: 'column', dateFormat: 'auto' },
      }),
    )
    expect(json.format).toBe('personal-finance-import-preview')
    expect(json.mapping).toMatchObject({ date: 'วันที่', amount: 'จำนวนเงิน' })
    expect(json.rows[0]).toMatchObject({
      sourceFile: 'ledger.xlsx',
      sheet: 'รายการ',
      sourceRow: 4,
      status: 'ready',
      classification: 'expense',
      normalized: { amountSatang: 250_000 },
    })
    const csv = previewToCsv(result)
    expect(csv.startsWith('﻿sourceFile,sheet,sourceRow,status,classification,date,amountSatang')).toBe(true)
    expect(csv).toContain('ledger.xlsx,รายการ,4,ready,expense,2026-09-03,250000,cash,,food')
  })
})

describe('10,000 rows', () => {
  it('parses, profiles and previews every row', async () => {
    const t0 = performance.now()
    const { result } = await run(bigLedger(10_000))
    const ms = performance.now() - t0
    expect(result.summary.sourceRows).toBe(10_000)
    expect(result.summary.ready).toBe(10_000)
    expect(ms).toBeLessThan(30_000)
  }, 60_000)
})

describe('value fields', () => {
  it('every value field has a mapping table', async () => {
    const { values } = await run(cleanLedger())
    expect(Object.keys(values).sort()).toEqual((['type', 'account', 'toAccount', 'category', 'debt'] satisfies ValueField[]).sort())
  })
})
