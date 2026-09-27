import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SelectField } from '@/components/forms/SelectField'
import { IGNORE, IMPORT_FIELDS, type DateFormat, type ExistingData, type ImportField, type RowTypeMode, type ValueField } from '@/domain/import'
import { cn } from '@/lib/utils'
import { fieldLabel, kindLabel } from '../import-labels'
import { VALUE_FIELDS, type ImportWizard } from '../use-import-wizard'
import { ti, type ImportMessageKey } from '../import-messages'

const REQUIRED: readonly ImportField[] = ['date', 'amount', 'account']
const CONDITIONAL: Partial<Record<ImportField, string>> = {
  category: 'import.map.requiredFor.category',
  toAccount: 'import.map.requiredFor.toAccount',
  debt: 'import.map.requiredFor.debt',
  type: 'import.map.requiredFor.type',
}
const ROW_TYPE_MODES: readonly RowTypeMode[] = ['column', 'expense', 'income', 'direction', 'none']
const DATE_FORMATS: readonly DateFormat[] = ['auto', 'DMY', 'MDY', 'YMD']
const KIND_TARGETS = ['expense', 'income', 'debt_payment', 'transfer', 'opening_balance'] as const
const SHOWN_VALUES = 50

export function MappingStep({ wizard, existing }: { wizard: ImportWizard; existing: ExistingData }) {
  const { mapping, suggested, profiles, options } = wizard
  const columnOptions = [{ value: '', label: ti('import.map.notUsed') }, ...profiles.map((p) => ({ value: String(p.index), label: p.name }))]

  const targetOptions = (field: ValueField) => {
    const base = [{ value: '', label: ti('import.values.notChosen') }]
    if (field === 'type')
      return [...base, ...KIND_TARGETS.map((k) => ({ value: k, label: kindLabel(k) })), { value: IGNORE, label: ti('import.values.ignore') }]
    if (field === 'category')
      return [
        ...base,
        ...existing.categories.map((c) => ({
          value: c.id,
          label: `${c.name} (${c.kind === 'income' ? ti('import.kindValue.income') : ti('import.kindValue.expense')})`,
        })),
      ]
    if (field === 'debt') return [...base, ...existing.debts.map((d) => ({ value: d.id, label: d.name }))]
    return [...base, ...existing.accounts.map((a) => ({ value: a.id, label: a.name }))]
  }
  const targetName = (field: ValueField, id: string | null) => targetOptions(field).find((o) => o.value === id)?.label ?? ''

  return (
    <div className="flex flex-col gap-section">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{ti('import.map.title')}</h2>
          </CardTitle>
          <CardDescription>{ti('import.map.hint')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ul className="grid gap-3 md:grid-cols-2">
            {IMPORT_FIELDS.map((field) => {
              const value = mapping[field]
              const isSuggested = value !== null && value === suggested[field]
              return (
                <li key={field} className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    {REQUIRED.includes(field) ? (
                      <Badge className="bg-expense/10 text-expense">{ti('import.map.required')}</Badge>
                    ) : CONDITIONAL[field] ? (
                      <Badge className="bg-warning/10 text-warning">{ti(CONDITIONAL[field] as ImportMessageKey)}</Badge>
                    ) : (
                      <Badge className="bg-muted text-muted-foreground">{ti('import.map.optional')}</Badge>
                    )}
                    {isSuggested && <Badge className="bg-info/10 text-info">{ti('import.map.suggested')}</Badge>}
                  </div>
                  <SelectField
                    label={fieldLabel(field)}
                    value={value === null ? '' : String(value)}
                    options={columnOptions}
                    onValueChange={(v) => wizard.setMapping(field, v === '' ? null : Number(v))}
                  />
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-3 pt-card md:grid-cols-2">
          <SelectField
            label={ti('import.options.rowType')}
            value={options.rowTypeMode}
            options={ROW_TYPE_MODES.filter((m) => m !== 'column' || mapping.type !== null).map((m) => ({ value: m, label: ti(`import.options.rowType.${m}`) }))}
            onValueChange={(v) => wizard.setOption('rowTypeMode', v as RowTypeMode)}
          />
          <SelectField
            label={ti('import.options.dateFormat')}
            value={options.dateFormat}
            options={DATE_FORMATS.map((f) => ({ value: f, label: ti(`import.options.dateFormat.${f}`) }))}
            onValueChange={(v) => wizard.setOption('dateFormat', v as DateFormat)}
          />
        </CardContent>
      </Card>

      {VALUE_FIELDS.filter((field) => wizard.matches[field] && (field !== 'type' || options.rowTypeMode === 'column')).map((field) => {
        const matches = wizard.matches[field]!
        const suggestions = matches.filter((m) => m.status === 'suggested' && wizard.values[field][m.value] !== m.targetId)
        return (
          <Card key={field}>
            <CardHeader>
              <CardTitle>
                <h2>{ti('import.values.title', { field: fieldLabel(field) })}</h2>
              </CardTitle>
              {field !== 'type' && <CardDescription>{ti('import.values.createLater')}</CardDescription>}
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {suggestions.length > 0 && (
                <Button variant="outline" size="touch" className="self-start" onClick={() => wizard.acceptSuggestions(field)}>
                  {ti('import.values.acceptAll', { count: suggestions.length })}
                </Button>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">{ti('import.values.title', { field: fieldLabel(field) })}</caption>
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th scope="col" className="py-1.5 pr-3 font-normal">
                        {ti('import.values.source')}
                      </th>
                      <th scope="col" className="py-1.5 pr-3 text-right font-normal">
                        {ti('import.values.count')}
                      </th>
                      <th scope="col" className="py-1.5 pr-3 font-normal">
                        {ti('import.values.status')}
                      </th>
                      <th scope="col" className="py-1.5 font-normal">
                        {ti('import.values.target')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {matches.slice(0, SHOWN_VALUES).map((m) => {
                      const chosen = wizard.values[field][m.value] ?? null
                      return (
                        <tr key={m.value} className="border-t align-middle">
                          <th scope="row" className="max-w-48 truncate py-1.5 pr-3 text-left font-medium">
                            {m.value}
                          </th>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{m.count.toLocaleString('th-TH')}</td>
                          <td className="py-1.5 pr-3 whitespace-nowrap">
                            <span
                              className={cn(
                                'rounded px-1.5 py-0.5 text-xs',
                                m.status === 'matched'
                                  ? 'bg-income/10 text-income'
                                  : m.status === 'suggested'
                                    ? 'bg-info/10 text-info'
                                    : 'bg-muted text-muted-foreground',
                              )}
                            >
                              {ti(`import.values.${m.status}`)}
                            </span>
                            {m.status === 'suggested' && chosen !== m.targetId && (
                              <Button variant="link" size="sm" onClick={() => wizard.setValue(field, m.value, m.targetId)}>
                                {ti('import.values.accept')}: {targetName(field, m.targetId)}
                              </Button>
                            )}
                          </td>
                          <td className="min-w-48 py-1.5">
                            <SelectField
                              label={`${fieldLabel(field)}: ${m.value}`}
                              className="[&>label]:sr-only"
                              value={chosen ?? ''}
                              options={targetOptions(field)}
                              onValueChange={(v) => wizard.setValue(field, m.value, v === '' ? null : v)}
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {matches.length > SHOWN_VALUES && (
                <p className="text-xs text-muted-foreground">{ti('import.values.more', { shown: SHOWN_VALUES, total: matches.length })}</p>
              )}
            </CardContent>
          </Card>
        )
      })}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button size="touch" onClick={wizard.validate}>
          {ti('import.validate')}
        </Button>
        <Button size="touch" variant="outline" onClick={() => wizard.setStep(3)}>
          {ti('import.back')}
        </Button>
      </div>
    </div>
  )
}
