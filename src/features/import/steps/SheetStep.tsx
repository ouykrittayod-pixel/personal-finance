import { SelectField } from '@/components/forms/SelectField'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cellText } from '@/domain/import'
import { cn } from '@/lib/utils'
import { datasetLabel, typeLabel } from '../import-labels'
import type { ImportWizard } from '../use-import-wizard'
import { ti } from '../import-messages'

const SEMANTIC_LABEL: Record<string, string> = {
  id: 'ID',
  date: 'วันที่',
  due_date: 'วันครบกำหนด',
  customer: 'ลูกค้า',
  description: 'รายละเอียด',
  note: 'หมายเหตุ',
  category: 'หมวดหมู่',
  account: 'บัญชี',
  type: 'ประเภท',
  amount: 'จำนวนเงิน',
  debit: 'เงินออก/เดบิต',
  credit: 'เงินเข้า/เครดิต',
  balance: 'ยอดคงเหลือ',
  principal: 'เงินต้น',
  interest: 'ดอกเบี้ย',
  fee: 'ค่าธรรมเนียม',
  invoice: 'ใบแจ้งหนี้',
  reference: 'อ้างอิง',
  quantity: 'จำนวนชิ้น',
  product: 'สินค้า',
  status: 'สถานะ',
  budget: 'งบประมาณ',
  installment: 'งวด',
  attachment: 'ไฟล์แนบ',
  unknown: '—',
}

/** Step 3: one sheet — header row (detected, overridable), first rows, column profiles, dataset guess. */
export function SheetStep({ wizard }: { wizard: ImportWizard }) {
  const sheet = wizard.sheet!
  const { dataset, profiles, headerIndex } = wizard
  const excelRow = (index: number) => sheet.firstRowNumber + index
  const firstShown = Math.max(0, headerIndex - 2)
  const shown = sheet.rows.slice(firstShown, headerIndex + 6)
  const headerOptions = sheet.rows.slice(0, 25).map((_, index) => ({ value: String(index), label: ti('import.sheet.headerRow', { row: excelRow(index) }) }))

  return (
    <div className="flex flex-col gap-section">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{sheet.name}</h2>
          </CardTitle>
          <CardDescription>{ti('import.sheet.rows', { rows: sheet.rows.length.toLocaleString('th-TH'), cols: sheet.columnCount })}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <div className={cn('rounded-lg border p-3', dataset.personal ? 'border-border' : 'border-warning/40 bg-warning/5')}>
            <p className="font-medium">
              {ti('import.sheet.guess', { kind: datasetLabel(dataset.kind) })}{' '}
              <span className="text-muted-foreground">({ti(`import.sheet.confidence.${dataset.confidence}`)})</span>
            </p>
            {!dataset.personal && (
              <>
                <p className="mt-1 font-medium text-warning">{ti('import.sheet.notPersonal')}</p>
                <p className="mt-1 text-muted-foreground">{ti('import.sheet.notPersonalHint')}</p>
              </>
            )}
          </div>

          <SelectField
            label={ti('import.sheet.header')}
            hint={wizard.detection ? ti('import.sheet.headerDetected', { row: excelRow(wizard.detection.index) }) : undefined}
            value={String(headerIndex)}
            options={headerOptions}
            onValueChange={(value) => wizard.setHeader(Number(value))}
            className="max-w-xs"
          />

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-xs">
              <caption className="sr-only">{ti('import.sheet.firstRows')}</caption>
              <tbody>
                {shown.map((row, i) => {
                  const index = firstShown + i
                  return (
                    <tr key={index} className={cn('border-b last:border-0', index === headerIndex && 'bg-primary/10 font-semibold')}>
                      <th scope="row" className="w-12 px-2 py-1.5 text-right font-normal text-muted-foreground tabular-nums">
                        {excelRow(index)}
                      </th>
                      {Array.from({ length: Math.min(sheet.columnCount, 12) }, (_, c) => (
                        <td key={c} className="max-w-40 truncate px-2 py-1.5 whitespace-nowrap">
                          {cellText(row[c] ?? null)}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{ti('import.sheet.columns')}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{ti('import.sheet.columns')}</caption>
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th scope="col" className="py-1.5 pr-3 font-normal">
                  {ti('import.profile.name')}
                </th>
                <th scope="col" className="py-1.5 pr-3 text-right font-normal">
                  {ti('import.profile.filled')}
                </th>
                <th scope="col" className="py-1.5 pr-3 font-normal">
                  {ti('import.profile.type')}
                </th>
                <th scope="col" className="py-1.5 pr-3 font-normal">
                  {ti('import.profile.meaning')}
                </th>
                <th scope="col" className="py-1.5 font-normal">
                  {ti('import.profile.samples')}
                </th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.index} className="border-t align-top">
                  <th scope="row" className="py-1.5 pr-3 text-left font-medium">
                    {p.name}
                  </th>
                  <td className="py-1.5 pr-3 text-right whitespace-nowrap tabular-nums">
                    {p.nonEmpty.toLocaleString('th-TH')} ({p.populatedPct}%)
                  </td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{typeLabel(p.type)}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{SEMANTIC_LABEL[p.semantic]}</td>
                  <td className="max-w-56 truncate py-1.5 text-muted-foreground">{p.samples.join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button size="touch" onClick={() => wizard.setStep(4)} variant={dataset.personal ? 'default' : 'outline'}>
          {dataset.personal ? ti('import.sheet.use') : ti('import.sheet.useAnyway')}
        </Button>
        <Button size="touch" variant={dataset.personal ? 'outline' : 'default'} onClick={() => wizard.setStep(2)}>
          {ti('import.sheet.ignore')}
        </Button>
      </div>
    </div>
  )
}
