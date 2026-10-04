import { Plus } from 'lucide-react'
import { Outlet } from 'react-router'
import { PrimaryButton } from '@/components/actions/buttons'
import { AppShell } from '@/components/layout/AppShell'
import { NAV_ITEMS } from '@/app/router/nav-items'
import { useQuickEntry } from '@/app/providers/quick-entry-context'
import { QuickEntryProvider } from '@/app/providers/QuickEntryProvider'
import { SyncStatus } from '@/features/drive/SyncStatus'
import { t } from '@/lib/i18n'

function Shell() {
  const quickEntry = useQuickEntry()
  return (
    <AppShell
      navItems={NAV_ITEMS}
      quickAction={{ labelKey: 'quickAdd.title', onSelect: quickEntry.openMenu }}
      headerStatus={<SyncStatus />}
      headerActions={
        <PrimaryButton onClick={quickEntry.openExpense}>
          <Plus aria-hidden="true" />
          {t('nav.quickAdd')}
        </PrimaryButton>
      }
    >
      <Outlet />
    </AppShell>
  )
}

export function AppLayout() {
  return (
    <QuickEntryProvider>
      <Shell />
    </QuickEntryProvider>
  )
}
