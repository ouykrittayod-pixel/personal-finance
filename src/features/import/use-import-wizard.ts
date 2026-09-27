import { useCallback, useMemo, useState } from 'react'
import {
  appliedTargets,
  buildPreview,
  classifyDataset,
  dataRows,
  detectHeaderRow,
  distinctValues,
  emptyMapping,
  matchTypeValues,
  matchValues,
  profileColumns,
  suggestMapping,
  type ColumnMapping,
  type ExistingData,
  type ImportField,
  type ImportOptions,
  type ParsedWorkbook,
  type PreviewResult,
  type ValueField,
  type ValueMappings,
  type ValueMatch,
} from '@/domain/import'
import { parseWorkbook, WorkbookError } from './import-parser'

export const VALUE_FIELDS: readonly ValueField[] = ['type', 'account', 'toAccount', 'category', 'debt']
const emptyValues = (): ValueMappings => ({ type: {}, account: {}, toAccount: {}, category: {}, debt: {} })

export type FileState = { status: 'idle' } | { status: 'reading' } | { status: 'error'; kind: WorkbookError['kind'] }

/**
 * Wizard state for the Import Center. Everything is in memory; the only
 * database access is reading `existing` (passed in). Nothing is written.
 */
export function useImportWizard(existing: ExistingData | undefined) {
  const [step, setStep] = useState(1)
  const [file, setFile] = useState<FileState>({ status: 'idle' })
  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null)
  const [parseMs, setParseMs] = useState(0)
  const [sheetIndex, setSheetIndex] = useState<number | null>(null)
  const [headerIndex, setHeaderIndex] = useState(0)
  const [mapping, setMappingState] = useState<ColumnMapping>(emptyMapping)
  const [suggested, setSuggested] = useState<ColumnMapping>(emptyMapping)
  /** Only the user's explicit choices; exact matches are added on top in `values`. */
  const [choices, setChoices] = useState<ValueMappings>(emptyValues)
  const [options, setOptions] = useState<ImportOptions>({ rowTypeMode: 'none', dateFormat: 'auto' })
  const [result, setResult] = useState<PreviewResult | null>(null)
  const [previewMs, setPreviewMs] = useState(0)

  const sheet = workbook && sheetIndex !== null ? (workbook.sheets[sheetIndex] ?? null) : null
  const detection = useMemo(() => (sheet ? detectHeaderRow(sheet) : null), [sheet])
  const profiles = useMemo(() => (sheet ? profileColumns(sheet, headerIndex) : []), [sheet, headerIndex])
  const dataset = useMemo(() => classifyDataset(profiles), [profiles])
  const sheetSummaries = useMemo(
    () =>
      workbook?.sheets.map((s) => {
        const header = detectHeaderRow(s)
        return {
          name: s.name,
          rows: s.rows.length,
          columns: s.columnCount,
          header: header.index,
          firstRow: s.firstRowNumber,
          dataset: classifyDataset(profileColumns(s, header.index)),
        }
      }) ?? [],
    [workbook],
  )

  const targets = useMemo(
    () => ({
      account: existing?.accounts.map((a) => ({ id: a.id, name: a.name })) ?? [],
      category: existing?.categories.map((c) => ({ id: c.id, name: c.name })) ?? [],
      debt: existing?.debts.map((d) => ({ id: d.id, name: d.name })) ?? [],
    }),
    [existing],
  )

  const matches = useMemo(() => {
    const out: Partial<Record<ValueField, ValueMatch[]>> = {}
    if (!sheet) return out
    const rows = dataRows(sheet, headerIndex)
    for (const field of VALUE_FIELDS) {
      const column = mapping[field]
      if (column === null) continue
      const values = distinctValues(rows.map((row) => row[column] ?? null))
      out[field] =
        field === 'type'
          ? matchTypeValues(values)
          : matchValues(values, field === 'category' ? targets.category : field === 'debt' ? targets.debt : targets.account)
    }
    return out
  }, [sheet, headerIndex, mapping, targets])

  const values = useMemo<ValueMappings>(() => {
    const out = emptyValues()
    for (const field of VALUE_FIELDS) out[field] = { ...appliedTargets(matches[field] ?? []), ...choices[field] }
    return out
  }, [matches, choices])

  const loadFile = useCallback(async (selected: File) => {
    setFile({ status: 'reading' })
    setResult(null)
    try {
      const start = performance.now()
      const parsed = await parseWorkbook(selected)
      setParseMs(Math.round(performance.now() - start))
      setWorkbook(parsed)
      setSheetIndex(null)
      setFile({ status: 'idle' })
      setStep(2)
    } catch (error) {
      // Only the kind is logged — never the file's contents.
      console.warn('Workbook not read:', error instanceof WorkbookError ? error.kind : 'unreadable')
      setFile({ status: 'error', kind: error instanceof WorkbookError ? error.kind : 'unreadable' })
    }
  }, [])

  const resetMapping = useCallback((grid: NonNullable<typeof sheet>, header: number) => {
    const suggestion = suggestMapping(profileColumns(grid, header))
    setSuggested(suggestion)
    setMappingState(suggestion)
    setChoices(emptyValues())
    setOptions((o) => ({ ...o, rowTypeMode: suggestion.type === null ? 'none' : 'column' }))
    setResult(null)
  }, [])

  const selectSheet = useCallback(
    (index: number) => {
      const grid = workbook?.sheets[index]
      if (!grid) return
      const header = detectHeaderRow(grid).index
      setSheetIndex(index)
      setHeaderIndex(header)
      resetMapping(grid, header)
      setStep(3)
    },
    [workbook, resetMapping],
  )

  const setHeader = useCallback(
    (index: number) => {
      if (!sheet) return
      setHeaderIndex(index)
      resetMapping(sheet, index)
    },
    [sheet, resetMapping],
  )

  const setMapping = useCallback((field: ImportField, column: number | null) => {
    setMappingState((m) => ({ ...m, [field]: column }))
    if ((VALUE_FIELDS as readonly string[]).includes(field)) setChoices((c) => ({ ...c, [field]: {} }))
    if (field === 'type') setOptions((o) => ({ ...o, rowTypeMode: column === null ? (o.rowTypeMode === 'column' ? 'none' : o.rowTypeMode) : 'column' }))
    setResult(null)
  }, [])

  const setValue = useCallback((field: ValueField, source: string, target: string | null) => {
    setChoices((c) => ({ ...c, [field]: { ...c[field], [source]: target } }))
    setResult(null)
  }, [])

  const acceptSuggestions = useCallback(
    (field: ValueField) => {
      const accepted = Object.fromEntries((matches[field] ?? []).filter((m) => m.status === 'suggested').map((m) => [m.value, m.targetId]))
      setChoices((c) => ({ ...c, [field]: { ...c[field], ...accepted } }))
      setResult(null)
    },
    [matches],
  )

  const setOption = useCallback(<K extends keyof ImportOptions>(key: K, value: ImportOptions[K]) => {
    setOptions((o) => ({ ...o, [key]: value }))
    setResult(null)
  }, [])

  const validate = useCallback(() => {
    if (!sheet || !workbook || !existing) return
    const start = performance.now()
    setResult(buildPreview({ fileName: workbook.fileName, sheet, headerIndex, mapping, values, options, dataset, existing }))
    setPreviewMs(Math.round(performance.now() - start))
    setStep(5)
  }, [sheet, workbook, existing, headerIndex, mapping, values, options, dataset])

  const restart = useCallback(() => {
    setStep(1)
    setWorkbook(null)
    setSheetIndex(null)
    setResult(null)
    setFile({ status: 'idle' })
  }, [])

  return {
    step,
    setStep,
    file,
    workbook,
    parseMs,
    sheet,
    sheetIndex,
    sheetSummaries,
    detection,
    headerIndex,
    profiles,
    dataset,
    mapping,
    suggested,
    matches,
    values,
    options,
    result,
    previewMs,
    targets,
    loadFile,
    selectSheet,
    setHeader,
    setMapping,
    setValue,
    acceptSuggestions,
    setOption,
    validate,
    restart,
  }
}

export type ImportWizard = ReturnType<typeof useImportWizard>
