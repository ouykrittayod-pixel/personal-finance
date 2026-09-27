// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RouteErrorBoundary } from '@/app/layout/RouteErrorBoundary'
import { StorageContext } from '@/app/providers/storage-context'
import { ToastProvider } from '@/components/feedback/Toast'
import { db } from '@/db/dexie'
import { transactionsRepository } from '@/db/repositories'
import { todayISO } from '@/lib/dates'
import { t } from '@/lib/i18n'
import { makeAccount, makeCategory, makeTx } from '@/test/factories'
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

const loading = () => screen.queryAllByRole('status').filter((el) => el.textContent?.includes(t('state.loading')))

beforeEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(db.tables.map((table) => table.clear()))
})

describe('every route on an empty database', () => {
  it.each(NAV_ITEMS.map((item) => [item.path] as const))(
    '%s: loads, no error, no endless spinner, has content',
    async (path) => {
      renderAt(path)
      await screen.findByRole('heading', { level: 1 }, { timeout: 15_000 })
      await waitFor(() => expect(loading()).toEqual([]), { timeout: 5_000 })
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      const main = screen.getByRole('main')
      // Something beyond the heading: an empty state, a form or controls.
      expect(main.textContent!.trim().length).toBeGreaterThan(20)
      expect(main).not.toHaveTextContent(/undefined|NaN/)
    },
    20_000,
  )
})

describe('a page that fails', () => {
  it('a failed read shows the page’s own error state (data is safe, retry)', async () => {
    vi.spyOn(transactionsRepository, 'listAll').mockRejectedValue(new Error('IndexedDB read failed'))
    renderAt('/transactions')
    const alert = await screen.findByRole('alert', {}, { timeout: 10_000 })
    expect(alert).toHaveTextContent(t('state.error.title'))
    expect(screen.getAllByRole('link', { name: t('nav.dashboard') }).length).toBeGreaterThan(0)
  })

  it.each(['/', '/transactions', '/accounts', '/budget', '/calendar', '/analytics'])(
    'a corrupt record (money 1.5) on %s shows an error inside the shell, never a blank app',
    async (path) => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      await db.accounts.add(makeAccount({ id: 'a' }))
      await db.categories.add(makeCategory({ id: 'c' }))
      await db.transactions.add(makeTx({ type: 'expense', amountSatang: 1.5 as never, accountId: 'a', categoryId: 'c', date: todayISO() }))
      renderAt(path)
      const alert = await screen.findByRole('alert', {}, { timeout: 15_000 })
      expect([t('error.title'), t('state.error.title')].some((title) => alert.textContent?.includes(title))).toBe(true)
      expect(screen.getAllByRole('link', { name: t('nav.transactions') }).length).toBeGreaterThan(0)
    },
    20_000,
  )

  it('the page-level boundary renders inside the shell', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const Boom = () => {
      throw new Error('render failed')
    }
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: (
            <nav aria-label="shell">
              <Outlet />
            </nav>
          ),
          children: [{ errorElement: <RouteErrorBoundary inline />, children: [{ index: true, element: <Boom /> }] }],
        },
      ],
      { initialEntries: ['/'] },
    )
    render(<RouterProvider router={router} />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(t('error.title'))
    expect(alert).toHaveTextContent('render failed')
    expect(screen.getByRole('navigation', { name: 'shell' })).toContainElement(alert)
  })
})
