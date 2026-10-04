import type { RouteObject } from 'react-router'
import { AppLayout } from '@/app/layout/AppLayout'
import { RouteErrorBoundary } from '@/app/layout/RouteErrorBoundary'
import { NotFoundPage } from '@/app/layout/NotFoundPage'
import { LoadingState } from '@/components/feedback/LoadingState'

/**
 * Every feature page is lazy-loaded: the initial bundle holds only the app
 * shell, and each screen (with its own libraries, e.g. Recharts for the
 * dashboard) downloads when first visited. The service worker precaches all
 * chunks, so this costs nothing offline.
 */
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        // Development-only gallery; `import.meta.env.DEV` is false in production, so it is tree-shaken out.
        path: 'design-system',
        lazy: async () => ({ Component: (await import('@/app/dev/DesignSystemPage')).DesignSystemPage }),
      },
      {
        // Import Center, Phase 15A (development only; not in the navigation). Reads files and previews — writes nothing.
        path: 'import',
        lazy: async () => ({ Component: (await import('@/features/import')).ImportPage }),
      },
      {
        // Read-only data integrity report (development only).
        path: 'dev/integrity',
        lazy: async () => ({ Component: (await import('@/app/dev/IntegrityPage')).IntegrityPage }),
      },
    ]
  : []

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    errorElement: <RouteErrorBoundary />,
    // Shown while a lazy route loads on first render.
    hydrateFallbackElement: <LoadingState />,
    children: [
      {
        // A page that fails shows its error inside the shell; the sidebar and bottom bar keep working.
        errorElement: <RouteErrorBoundary inline />,
        children: [
          { index: true, lazy: async () => ({ Component: (await import('@/features/dashboard')).DashboardPage }) },
          { path: 'expenses', lazy: async () => ({ Component: (await import('@/features/expenses')).ExpensesPage }) },
          { path: 'transactions', lazy: async () => ({ Component: (await import('@/features/transactions')).TransactionsPage }) },
          { path: 'recurring', lazy: async () => ({ Component: (await import('@/features/recurring')).RecurringPage }) },
          { path: 'debts', lazy: async () => ({ Component: (await import('@/features/debts')).DebtsPage }) },
          { path: 'income', lazy: async () => ({ Component: (await import('@/features/income')).IncomePage }) },
          { path: 'accounts', lazy: async () => ({ Component: (await import('@/features/accounts')).AccountsPage }) },
          { path: 'calendar', lazy: async () => ({ Component: (await import('@/features/calendar')).CalendarPage }) },
          { path: 'budget', lazy: async () => ({ Component: (await import('@/features/budget')).BudgetPage }) },
          { path: 'analytics', lazy: async () => ({ Component: (await import('@/features/analytics')).AnalyticsPage }) },
          { path: 'settings', lazy: async () => ({ Component: (await import('@/features/settings')).SettingsPage }) },
          ...devRoutes,
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]
