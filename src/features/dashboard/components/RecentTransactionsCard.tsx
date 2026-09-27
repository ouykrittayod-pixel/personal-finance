import { Plus, ReceiptText } from 'lucide-react'
import { PrimaryButton } from '@/components/actions/buttons'
import { EmptyState } from '@/components/feedback/EmptyState'
import { TransactionList } from '@/components/finance/TransactionList'
import { TransactionRow } from '@/components/finance/TransactionRow'
import { useOptionalQuickEntry } from '@/app/providers/quick-entry-context'
import { t } from '@/lib/i18n'
import type { RecentRow } from '../dashboard-data'
import { DashboardSection } from './DashboardSection'

export function RecentTransactionsCard({ rows }: { rows: RecentRow[] }) {
  const title = t('dashboard.recent.title')
  const quickEntry = useOptionalQuickEntry()
  return (
    <DashboardSection title={title} to={rows.length > 0 ? '/transactions' : undefined} flush={rows.length > 0}>
      {rows.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title={t('dashboard.recent.empty')}
          description={t('dashboard.recent.emptyHint')}
          className="border-none py-6"
          action={
            quickEntry && (
              <PrimaryButton onClick={quickEntry.openExpense}>
                <Plus aria-hidden="true" />
                {t('nav.quickAdd')}
              </PrimaryButton>
            )
          }
        />
      ) : (
        <TransactionList label={title} className="border-t">
          {rows.map((row) => (
            <TransactionRow
              key={row.id}
              type={row.type}
              title={row.title}
              amount={row.amount}
              date={row.date}
              categoryLabel={row.categoryLabel}
              categoryIcon={row.categoryIcon}
              accountLabel={row.accountLabel}
              toAccountLabel={row.toAccountLabel}
              hasAttachment={row.hasAttachment}
            />
          ))}
        </TransactionList>
      )}
    </DashboardSection>
  )
}
