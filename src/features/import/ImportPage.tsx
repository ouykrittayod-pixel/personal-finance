import { useLiveQuery } from 'dexie-react-hooks'
import { ShieldCheck } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { LoadingState } from '@/components/feedback/LoadingState'
import { cn } from '@/lib/utils'
import { loadExistingData } from './import-data'
import { FileStep, FileSummaryStep } from './steps/FileStep'
import { MappingStep } from './steps/MappingStep'
import { PreviewStep } from './steps/PreviewStep'
import { ReadyStep } from './steps/ReadyStep'
import { SheetStep } from './steps/SheetStep'
import { ValidationStep } from './steps/ValidationStep'
import { useImportWizard } from './use-import-wizard'
import { ti } from './import-messages'

const STEPS = [1, 2, 3, 4, 5, 6, 7] as const

/**
 * Import Center (development only, #/import). Phase 15A: read → normalize →
 * validate → preview. It reads existing records for matching; it never writes.
 */
export function ImportPage() {
  const existing = useLiveQuery(loadExistingData, [])
  const wizard = useImportWizard(existing)

  return (
    <div className="flex flex-col gap-section">
      <PageHeader title={ti('import.title')} description={ti('import.subtitle')} />
      <p role="note" className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/5 p-3 text-sm">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-info" />
        <span>
          <strong className="font-semibold">{ti('import.noWrite')}</strong> · {ti('import.noWriteHint')}
        </span>
      </p>

      <nav aria-label={ti('import.steps')}>
        <ol className="flex gap-1 overflow-x-auto pb-1 text-xs">
          {STEPS.map((n) => {
            const reachable = n <= wizard.step || (n === 6 && wizard.result !== null) || (n === 7 && wizard.result !== null)
            return (
              <li key={n} className="shrink-0">
                <button
                  type="button"
                  disabled={!reachable}
                  aria-current={wizard.step === n ? 'step' : undefined}
                  onClick={() => wizard.setStep(n)}
                  className={cn(
                    'flex min-h-touch items-center gap-1.5 rounded-md px-2.5 md:min-h-9',
                    wizard.step === n ? 'bg-primary/10 font-semibold text-primary' : 'text-muted-foreground',
                    reachable ? 'hover:bg-muted' : 'opacity-50',
                  )}
                >
                  <span aria-hidden="true" className="flex size-5 items-center justify-center rounded-full border text-[0.7rem] tabular-nums">
                    {n}
                  </span>
                  {ti(`import.step.${n}`)}
                </button>
              </li>
            )
          })}
        </ol>
      </nav>

      {!existing ? (
        <LoadingState />
      ) : wizard.step === 1 ? (
        <FileStep wizard={wizard} />
      ) : wizard.step === 2 ? (
        <FileSummaryStep wizard={wizard} />
      ) : wizard.step === 3 ? (
        <SheetStep wizard={wizard} />
      ) : wizard.step === 4 ? (
        <MappingStep wizard={wizard} existing={existing} />
      ) : wizard.step === 5 ? (
        <ValidationStep wizard={wizard} />
      ) : wizard.step === 6 ? (
        <PreviewStep wizard={wizard} />
      ) : (
        <ReadyStep wizard={wizard} />
      )}
    </div>
  )
}
