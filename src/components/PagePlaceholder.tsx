import { Construction } from 'lucide-react'
import type { ReactNode } from 'react'
import { EmptyState } from '@/components/feedback/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { t, type MessageKey } from '@/lib/i18n'

/** Temporary page body used until a feature screen is built. Shows no data. */
export function PagePlaceholder({ titleKey, children }: { titleKey: MessageKey; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-section">
      <PageHeader title={t(titleKey)} />
      {children ?? (
        <EmptyState icon={Construction} title={t('placeholder.comingSoon')} description={t('placeholder.comingSoonHint')} />
      )}
    </div>
  )
}
