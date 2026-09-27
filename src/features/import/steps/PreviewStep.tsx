import { Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { EmptyState } from '@/components/feedback/EmptyState'
import { Tabs, TabsList, TabsTrigger } from '@/components/navigation/Tabs'
import { Dialog } from '@/components/overlays/Dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { previewFileName, previewToCsv, previewToJson, type PreviewRow } from '@/domain/import'
import { toDecimalString } from '@/domain/money'
import { downloadBlob } from '@/lib/download'
import { formatTHB } from '@/lib/formatting'
import { cn } from '@/lib/utils'
import { fieldLabel, kindLabel, statusLabel, STATUS_TONE } from '../import-labels'
import type { ImportWizard } from '../use-import-wizard'
import { ImportSummary, MessageList } from './ValidationStep'
import { FILTERS, filterRows, type PreviewFilter } from '../preview-filter'
import { ti } from '../import-messages'

export const ROW_HEIGHT = 64
const VIEWPORT = 480
const OVERSCAN = 6

/** Only the visible rows are in the DOM (10,000-row files stay responsive). */
export function VirtualRowList({ rows, onOpen }: { rows: readonly PreviewRow[]; onOpen: (row: PreviewRow) => void }) {
  const [scrollTop, setScrollTop] = useState(0)
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(rows.length, Math.ceil((scrollTop + VIEWPORT) / ROW_HEIGHT) + OVERSCAN)
  return (
    <div
      className="overflow-y-auto rounded-lg border"
      style={{ height: Math.min(VIEWPORT, rows.length * ROW_HEIGHT + 2) }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      data-testid="preview-scroll"
    >
      <ul aria-label={ti('import.preview.list')} className="relative" style={{ height: rows.length * ROW_HEIGHT }}>
        {rows.slice(first, last).map((row, i) => {
          const n = row.normalized
          return (
            <li
              key={row.key}
              aria-setsize={rows.length}
              aria-posinset={first + i + 1}
              className="absolute inset-x-0 border-b"
              style={{ top: (first + i) * ROW_HEIGHT, height: ROW_HEIGHT }}
            >
              <button
                type="button"
                onClick={() => onOpen(row)}
                className="flex h-full w-full items-center gap-3 px-3 text-left hover:bg-muted focus-visible:bg-muted"
              >
                <span className="w-14 shrink-0 text-xs text-muted-foreground tabular-nums">{ti('import.preview.row', { row: row.source.rowNumber })}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{n.description ?? n.reference ?? kindLabel(row.classification)}</span>
                  <span className="truncate text-xs text-muted-foreground">{[n.date, kindLabel(row.classification)].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="shrink-0 text-sm tabular-nums">{n.amountSatang !== undefined ? formatTHB(n.amountSatang) : '—'}</span>
                <span className={cn('w-24 shrink-0 rounded px-1.5 py-0.5 text-center text-xs', STATUS_TONE[row.status])}>
                  {statusLabel(row.status)}
                  {row.duplicates.length > 0 && <span className="block text-[0.65rem]">{ti('import.filter.duplicate')}</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function RowDetail({ row, wizard }: { row: PreviewRow; wizard: ImportWizard }) {
  const n = row.normalized
  const money = (v: number | undefined) => (v === undefined ? undefined : `${formatTHB(v as never)} (${toDecimalString(v as never)})`)
  const normalized: [string, string | undefined][] = [
    [fieldLabel('date'), n.date],
    [fieldLabel('amount'), money(n.amountSatang)],
    [fieldLabel('account'), n.accountId && wizard.targets.account.find((a) => a.id === n.accountId)?.name],
    [fieldLabel('toAccount'), n.toAccountId && wizard.targets.account.find((a) => a.id === n.toAccountId)?.name],
    [fieldLabel('category'), n.categoryId && wizard.targets.category.find((c) => c.id === n.categoryId)?.name],
    [fieldLabel('debt'), n.debtId && wizard.targets.debt.find((d) => d.id === n.debtId)?.name],
    [fieldLabel('principal'), money(n.principalSatang)],
    [fieldLabel('interest'), money(n.interestSatang)],
    [fieldLabel('fee'), money(n.feeSatang)],
    [fieldLabel('description'), n.description],
    [fieldLabel('note'), n.note],
    [fieldLabel('reference'), n.reference],
  ]
  const used = Object.entries(wizard.mapping).filter(([, column]) => column !== null) as [keyof typeof wizard.mapping, number][]
  return (
    <div className="flex flex-col gap-4 text-sm">
      <section>
        <h3 className="font-medium">{ti('import.detail.source')}</h3>
        <p className="text-muted-foreground">
          {ti('import.detail.file')}: {row.source.fileName} · {ti('import.detail.sheet')}: {row.source.sheetName} · {ti('import.detail.rowNumber')}:{' '}
          {row.source.rowNumber}
        </p>
      </section>
      <section>
        <h3 className="font-medium">{ti('import.detail.classification')}</h3>
        <p>
          {kindLabel(row.classification)} · <span className={cn('rounded px-1.5 py-0.5 text-xs', STATUS_TONE[row.status])}>{statusLabel(row.status)}</span>
        </p>
      </section>
      <section>
        <h3 className="font-medium">{ti('import.detail.messages')}</h3>
        {row.messages.length ? <MessageList messages={row.messages} /> : <p className="text-muted-foreground">{ti('import.detail.noMessages')}</p>}
      </section>
      {row.duplicates.length > 0 && (
        <section>
          <h3 className="font-medium">{ti('import.detail.duplicates')}</h3>
          <ul className="list-disc pl-5">
            {row.duplicates.map((d) => (
              <li key={`${d.kind}-${d.ref}`}>
                {d.kind === 'file' ? ti('import.detail.duplicateFile', { row: d.ref }) : ti('import.detail.duplicateExisting')}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3 className="font-medium">{ti('import.detail.normalized')}</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          {normalized
            .filter(([, v]) => v)
            .map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="break-words">{value}</dd>
              </div>
            ))}
        </dl>
      </section>
      <section>
        <h3 className="font-medium">{ti('import.detail.original')}</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          {Object.entries(row.original).map(([column, value]) => (
            <div key={column} className="contents">
              <dt className="text-muted-foreground">{column}</dt>
              <dd className="break-words">{value || '—'}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section>
        <h3 className="font-medium">{ti('import.detail.mapping')}</h3>
        <p className="text-muted-foreground">
          {used.map(([field, column]) => `${fieldLabel(field)} ← ${wizard.profiles[column]?.name ?? column}`).join(' · ')}
        </p>
      </section>
    </div>
  )
}

/** Step 6: filterable, virtualized preview with row details and export. */
export function PreviewStep({ wizard }: { wizard: ImportWizard }) {
  const result = wizard.result!
  const [filter, setFilter] = useState<PreviewFilter>('all')
  const [open, setOpen] = useState<PreviewRow | null>(null)
  const rows = useMemo(() => filterRows(result.rows, filter), [result, filter])

  const exportFile = (kind: 'json' | 'csv') => {
    const text =
      kind === 'json'
        ? previewToJson(result, {
            fileName: wizard.workbook!.fileName,
            sheetName: wizard.sheet!.name,
            generatedAt: new Date().toISOString(),
            mapping: wizard.mapping,
            columns: wizard.profiles.map((p) => p.name),
            options: wizard.options,
          })
        : previewToCsv(result)
    downloadBlob(new Blob([text], { type: kind === 'json' ? 'application/json' : 'text/csv;charset=utf-8' }), previewFileName(kind))
  }

  return (
    <div className="flex flex-col gap-section">
      <ImportSummary wizard={wizard} />
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{ti('import.preview.list')}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as PreviewFilter)}>
            <TabsList aria-label={ti('import.filter.label')} className="h-auto flex-wrap">
              {FILTERS.map((f) => (
                <TabsTrigger key={f} value={f} className="min-h-touch md:min-h-8">
                  {ti(`import.filter.${f}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
            {ti('import.preview.rows', { count: rows.length.toLocaleString('th-TH') })}
          </p>
          {rows.length === 0 ? <EmptyState title={ti('import.preview.empty')} /> : <VirtualRowList rows={rows} onOpen={setOpen} />}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" size="touch" onClick={() => exportFile('json')}>
              <Download aria-hidden="true" />
              {ti('import.export.json')}
            </Button>
            <Button variant="outline" size="touch" onClick={() => exportFile('csv')}>
              <Download aria-hidden="true" />
              {ti('import.export.csv')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{ti('import.export.hint')}</p>
        </CardContent>
      </Card>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button size="touch" onClick={() => wizard.setStep(7)}>
          {ti('import.next')}
        </Button>
        <Button size="touch" variant="outline" onClick={() => wizard.setStep(4)}>
          {ti('import.step.4')}
        </Button>
      </div>
      <Dialog
        open={open !== null}
        onOpenChange={(next) => !next && setOpen(null)}
        title={open ? ti('import.detail.title', { row: open.source.rowNumber }) : ''}
        className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
      >
        {open && <RowDetail row={open} wizard={wizard} />}
      </Dialog>
    </div>
  )
}
