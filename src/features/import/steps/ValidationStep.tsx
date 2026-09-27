import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { RowMessage } from '@/domain/import'
import { cn } from '@/lib/utils'
import { LEVEL_TONE, messageText } from '../import-labels'
import type { ImportWizard } from '../use-import-wizard'
import { ti } from '../import-messages'

/** The import summary: counts, dataset readiness, sheet notes, most common messages. */
export function ImportSummary({ wizard }: { wizard: ImportWizard }) {
  const result = wizard.result!
  const s = result.summary
  const lines: [string, number, string?][] = [
    [ti('import.summary.rows'), s.sourceRows],
    [ti('import.summary.ready'), s.ready, 'text-income'],
    [ti('import.summary.warnings'), s.warnings, 'text-warning'],
    [ti('import.summary.errors'), s.errors, 'text-expense'],
    [ti('import.summary.duplicates'), s.duplicates, 'text-warning'],
    [ti('import.summary.review'), s.review, 'text-info'],
    [ti('import.summary.unclassified'), s.unclassified],
    [ti('import.summary.ignored'), s.ignored],
    [ti('import.summary.opening'), s.openingBalances],
    [ti('import.summary.blank'), s.blankRowsSkipped],
  ]
  const datasetReady = s.errors === 0 && s.review === 0
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{ti('import.summary.title')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">{ti('import.summary.source')}</dt>
          <dd className="truncate text-right font-medium">{wizard.workbook!.fileName}</dd>
          <dt className="text-muted-foreground">{ti('import.summary.sheets')}</dt>
          <dd className="text-right font-medium">1 ({wizard.sheet!.name})</dd>
          {lines.map(([label, value, tone]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className={cn('text-right font-semibold tabular-nums', value > 0 && tone)}>{value.toLocaleString('th-TH')}</dd>
            </div>
          ))}
        </dl>
        <p className={cn('rounded-lg p-3 font-medium', datasetReady ? 'bg-income/10 text-income' : 'bg-expense/10 text-expense')}>
          {datasetReady ? ti('import.status.datasetReady') : ti('import.status.datasetNotReady')}
        </p>
        <p className="rounded-lg border border-info/30 bg-info/5 p-3 font-semibold" data-testid="no-write">
          {ti('import.noWrite')}
        </p>
        <p className="text-xs text-muted-foreground">{ti('import.summary.time', { ms: wizard.previewMs })}</p>
      </CardContent>
    </Card>
  )
}

export function MessageList({ messages }: { messages: readonly RowMessage[] }) {
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {messages.map((m, i) => (
        <li key={`${m.code}-${i}`} className="flex gap-2">
          <span className={cn('shrink-0 font-medium', LEVEL_TONE[m.level])}>{ti(`import.level.${m.level}`)}</span>
          <span>
            {messageText(m)}
            {m.detail && <span className="text-muted-foreground"> — {m.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Step 5: summary plus the most frequent messages, so problems can be fixed in the mapping first. */
export function ValidationStep({ wizard }: { wizard: ImportWizard }) {
  const result = wizard.result!
  const counts = new Map<string, { message: RowMessage; count: number }>()
  for (const row of result.rows)
    for (const m of row.messages) {
      const entry = counts.get(m.code) ?? { message: { level: m.level, code: m.code }, count: 0 }
      entry.count += 1
      counts.set(m.code, entry)
    }
  const order = { error: 0, warning: 1, info: 2 } as const
  const top = [...counts.values()].sort((a, b) => order[a.message.level] - order[b.message.level] || b.count - a.count).slice(0, 12)

  return (
    <div className="flex flex-col gap-section">
      <ImportSummary wizard={wizard} />
      {result.sheetMessages.length > 0 && (
        <Card>
          <CardContent className="pt-card">
            <MessageList messages={result.sheetMessages} />
          </CardContent>
        </Card>
      )}
      {top.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{ti('import.summary.byMessage')}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1 text-sm">
              {top.map(({ message, count }) => (
                <li key={message.code} className="flex justify-between gap-3">
                  <span>
                    <span className={cn('font-medium', LEVEL_TONE[message.level])}>{ti(`import.level.${message.level}`)}</span> {messageText(message)}
                  </span>
                  <span className="shrink-0 tabular-nums">{count.toLocaleString('th-TH')}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button size="touch" onClick={() => wizard.setStep(6)}>
          {ti('import.toPreview')}
        </Button>
        <Button size="touch" variant="outline" onClick={() => wizard.setStep(4)}>
          {ti('import.step.4')}
        </Button>
      </div>
    </div>
  )
}
