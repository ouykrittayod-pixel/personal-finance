import { FileSpreadsheet } from 'lucide-react'
import { useId, useRef } from 'react'
import { ErrorState } from '@/components/feedback/ErrorState'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatBytes } from '@/lib/formatting'
import { cn } from '@/lib/utils'
import { datasetLabel } from '../import-labels'
import { ACCEPT_ATTRIBUTE } from '../import-parser'
import type { ImportWizard } from '../use-import-wizard'
import { ti } from '../import-messages'

export function FileStep({ wizard }: { wizard: ImportWizard }) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const reading = wizard.file.status === 'reading'
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{ti('import.step.1')}</h2>
        </CardTitle>
        <CardDescription>{ti('import.file.hint')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <label htmlFor={id} className="sr-only">
          {ti('import.file.label')}
        </label>
        <input
          ref={input}
          id={id}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void wizard.loadFile(file)
          }}
        />
        <Button size="touch" className="self-start" disabled={reading} onClick={() => input.current?.click()}>
          <FileSpreadsheet aria-hidden="true" />
          {ti('import.file.choose')}
        </Button>
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {reading ? ti('import.file.reading') : ''}
        </p>
        {wizard.file.status === 'error' && <ErrorState title={ti(`import.file.error.${wizard.file.kind}`)} description={ti('import.noWrite')} />}
      </CardContent>
    </Card>
  )
}

/** Step 2: the workbook — name, size, sheets with a first classification. */
export function FileSummaryStep({ wizard }: { wizard: ImportWizard }) {
  const workbook = wizard.workbook!
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{ti('import.step.2')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{ti('import.file.name')}</dt>
            <dd className="truncate font-medium" title={workbook.fileName}>
              {workbook.fileName}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{ti('import.file.size')}</dt>
            <dd className="font-medium tabular-nums">{formatBytes(workbook.fileSize)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{ti('import.file.sheets')}</dt>
            <dd className="font-medium tabular-nums">{workbook.sheets.length}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{ti('import.file.readTime')}</dt>
            <dd className="font-medium tabular-nums">{wizard.parseMs} ms</dd>
          </div>
        </dl>
        <ul className="flex flex-col gap-2">
          {wizard.sheetSummaries.map((s, index) => (
            <li key={s.name} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate font-medium">{s.name}</p>
                <p className="text-xs text-muted-foreground">
                  {s.rows === 0
                    ? ti('import.sheet.empty')
                    : `${ti('import.sheet.rows', { rows: s.rows.toLocaleString('th-TH'), cols: s.columns })} · ${ti('import.sheet.headerDetected', { row: s.firstRow + s.header })}`}
                </p>
                {s.rows > 0 && (
                  <p className={cn('text-xs', s.dataset.personal ? 'text-muted-foreground' : 'font-medium text-warning')}>
                    {ti('import.sheet.guess', { kind: datasetLabel(s.dataset.kind) })}
                    {!s.dataset.personal && ` · ${ti('import.sheet.notPersonal')}`}
                  </p>
                )}
              </div>
              <Button variant="outline" size="touch" disabled={s.rows === 0} onClick={() => wizard.selectSheet(index)} className="shrink-0">
                {ti('import.sheet.select', { name: s.name })}
              </Button>
            </li>
          ))}
        </ul>
        <Button variant="ghost" size="touch" className="self-start" onClick={wizard.restart}>
          {ti('import.restart')}
        </Button>
      </CardContent>
    </Card>
  )
}
