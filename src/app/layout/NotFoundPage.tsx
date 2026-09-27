import { SearchX } from 'lucide-react'
import { Link } from 'react-router'
import { PrimaryButton } from '@/components/actions/buttons'
import { EmptyState } from '@/components/feedback/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { t } from '@/lib/i18n'

export function NotFoundPage() {
  return (
    <div className="flex flex-col gap-section">
      <PageHeader title={t('notFound.title')} />
      <EmptyState
        icon={SearchX}
        title={t('notFound.title')}
        action={
          <PrimaryButton asChild>
            <Link to="/">{t('notFound.back')}</Link>
          </PrimaryButton>
        }
      />
    </div>
  )
}
