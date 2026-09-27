// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it } from 'vitest'
import { StorageContext } from '@/app/providers/storage-context'
import { ToastProvider } from '@/components/feedback/Toast'
import { t } from '@/lib/i18n'
import { NAV_ITEMS } from './nav-items'
import { routes } from './routes'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <StorageContext value={{ persistence: 'unsupported', requestPersistence: async () => {} }}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </StorageContext>,
  )
}

const EXPECTED_PATHS = ['/', '/expenses', '/transactions', '/recurring', '/debts', '/income', '/accounts', '/calendar', '/budget', '/analytics', '/settings']

describe('routes', () => {
  it('has a nav item for every required route', () => {
    expect(NAV_ITEMS.map((item) => item.path)).toEqual(EXPECTED_PATHS)
  })

  it('renders the dashboard (lazy) at /', async () => {
    renderAt('/')
    // First lazy import compiles the chart library in the test runner, which can take a few seconds.
    expect(await screen.findByRole('heading', { level: 1, name: t('dashboard.title') }, { timeout: 15_000 })).toBeInTheDocument()
  }, 20_000)

  it.each(NAV_ITEMS.filter((item) => item.path !== '/').map((item) => [item.path, item.labelKey] as const))('renders %s (lazy)', async (path, labelKey) => {
    renderAt(path)
    // Pages may use a longer heading than their nav label (e.g. หนี้สิน → หนี้สินของฉัน, บัญชี → บัญชีของฉัน).
    const heading =
      path === '/debts'
        ? t('debts.title')
        : path === '/accounts'
          ? t('accounts.title')
          : path === '/calendar'
            ? t('calendar.title')
            : path === '/analytics'
              ? t('analytics.title')
              : t(labelKey)
    expect(await screen.findByRole('heading', { level: 1, name: heading }, { timeout: 5_000 })).toBeInTheDocument()
  })

  it('marks the current page as active in every navigation (sidebar + bottom bar)', async () => {
    renderAt('/budget')
    await screen.findByRole('heading', { level: 1, name: t('nav.budget') })
    const budgetLinks = screen.getAllByRole('link', { name: t('nav.budget') })
    expect(budgetLinks).toHaveLength(2)
    budgetLinks.forEach((link) => expect(link).toHaveAttribute('aria-current', 'page'))
    screen.getAllByRole('link', { name: t('nav.dashboard') }).forEach((link) => expect(link).not.toHaveAttribute('aria-current'))
  })

  it('shows a not-found page for unknown routes', async () => {
    renderAt('/does-not-exist')
    expect((await screen.findAllByRole('heading', { name: t('notFound.title') }))[0]).toBeInTheDocument()
  })
})
