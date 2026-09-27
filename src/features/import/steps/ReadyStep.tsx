import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { ImportWizard } from '../use-import-wizard'
import { ImportSummary } from './ValidationStep'
import { ti } from '../import-messages'

const REQUIREMENTS = [1, 2, 3, 4, 5, 6, 7] as const

/** Step 7: the actual import is a later phase — this step only states what it will require. */
export function ReadyStep({ wizard }: { wizard: ImportWizard }) {
  return (
    <div className="flex flex-col gap-section">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{ti('import.ready.title')}</h2>
          </CardTitle>
          <CardDescription>{ti('import.ready.body')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <ol className="list-decimal pl-5">
            {REQUIREMENTS.map((n) => (
              <li key={n}>{ti(`import.ready.req.${n}`)}</li>
            ))}
          </ol>
          <Button size="touch" disabled className="self-start">
            {ti('import.ready.disabled')}
          </Button>
        </CardContent>
      </Card>
      {wizard.result && <ImportSummary wizard={wizard} />}
      <Button size="touch" variant="outline" className="self-start" onClick={wizard.restart}>
        {ti('import.restart')}
      </Button>
    </div>
  )
}
