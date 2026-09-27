import { MoneyDisplay } from '@/components/finance/MoneyDisplay'
import { Card } from '@/components/ui/card'
import type { DateRange, PeriodTotals } from '@/domain/ledger'
import { formatDate } from '@/lib/formatting'
import { t } from '@/lib/i18n'

/**
 * Income, expenses and debt payments for the selected period — three separate
 * figures (debt payments are never part of expenses; transfers are in neither).
 */
export function LedgerSummary({ totals, range }: { totals: PeriodTotals; range: DateRange }) {
  const period = range.start === range.end ? formatDate(range.start) : `${formatDate(range.start)} – ${formatDate(range.end)}`
  const figures = [
    { label: t('txType.income'), amount: totals.income, tone: 'income' as const, sign: 'plus' as const },
    { label: t('txType.expense'), amount: totals.expense, tone: 'expense' as const, sign: 'minus' as const },
    { label: t('txType.debt_payment'), amount: totals.debtPayment, tone: 'debt' as const, sign: 'minus' as const },
  ]
  return (
    <Card className="gap-stack px-card">
      <p className="text-xs text-muted-foreground">
        {t('ledger.summary')} · {period}
      </p>
      <dl aria-label={t('ledger.summary')} className="grid grid-cols-3 gap-2">
        {figures.map((figure) => (
          <div key={figure.label} className="flex min-w-0 flex-col gap-0.5 border-l-2 border-border pl-2 sm:pl-3">
            <dt className="text-xs text-muted-foreground">{figure.label}</dt>
            <dd className="min-w-0 truncate">
              <MoneyDisplay amount={figure.amount} tone={figure.tone} sign={figure.amount > 0 ? figure.sign : 'none'} size="md" />
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}
