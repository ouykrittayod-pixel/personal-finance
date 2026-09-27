/**
 * Exporting the normalized preview for manual inspection (not an import file).
 * Amounts are integer satang, dates YYYY-MM-DD; every row keeps its source.
 */
import type { ImportOptions, ColumnMapping, PreviewResult, PreviewRow } from './types'

export const PREVIEW_EXPORT_FORMAT = 'personal-finance-import-preview'

export function previewToJson(
  result: PreviewResult,
  meta: { fileName: string; sheetName: string; generatedAt: string; mapping: ColumnMapping; columns: string[]; options: ImportOptions },
): string {
  const mapping = Object.fromEntries(Object.entries(meta.mapping).map(([field, index]) => [field, index === null ? null : meta.columns[index]]))
  return JSON.stringify(
    {
      format: PREVIEW_EXPORT_FORMAT,
      note: 'Preview only — nothing has been written to the database. Amounts are integer satang (฿1 = 100).',
      generatedAt: meta.generatedAt,
      sourceFile: meta.fileName,
      sheet: meta.sheetName,
      mapping,
      options: meta.options,
      summary: result.summary,
      sheetMessages: result.sheetMessages,
      rows: result.rows.map(exportRow),
    },
    null,
    2,
  )
}

function exportRow(row: PreviewRow) {
  return {
    sourceFile: row.source.fileName,
    sheet: row.source.sheetName,
    sourceRow: row.source.rowNumber,
    status: row.status,
    classification: row.classification,
    normalized: row.normalized,
    messages: row.messages.map((m) => `${m.level}:${m.code}`),
    duplicates: row.duplicates.map((d) => `${d.kind}:${d.ref}`),
  }
}

export const PREVIEW_CSV_COLUMNS = [
  'sourceFile',
  'sheet',
  'sourceRow',
  'status',
  'classification',
  'date',
  'amountSatang',
  'accountId',
  'toAccountId',
  'categoryId',
  'debtId',
  'principalSatang',
  'interestSatang',
  'feeSatang',
  'description',
  'note',
  'reference',
  'messages',
  'duplicates',
] as const

function cell(value: unknown): string {
  const text = value === undefined || value === null ? '' : String(value)
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

/** UTF-8 with BOM (Excel opens Thai correctly), CRLF. */
export function previewToCsv(result: PreviewResult): string {
  const lines = result.rows.map((row) => {
    const n = row.normalized
    return [
      row.source.fileName,
      row.source.sheetName,
      row.source.rowNumber,
      row.status,
      row.classification,
      n.date,
      n.amountSatang,
      n.accountId,
      n.toAccountId,
      n.categoryId,
      n.debtId,
      n.principalSatang,
      n.interestSatang,
      n.feeSatang,
      n.description,
      n.note,
      n.reference,
      row.messages.map((m) => `${m.level}:${m.code}`).join(' '),
      row.duplicates.map((d) => `${d.kind}:${d.ref}`).join(' '),
    ]
      .map(cell)
      .join(',')
  })
  return `﻿${[PREVIEW_CSV_COLUMNS.join(','), ...lines].join('\r\n')}\r\n`
}

export const previewFileName = (kind: 'json' | 'csv') => `normalized-preview.${kind}`
