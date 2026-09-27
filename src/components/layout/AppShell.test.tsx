// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { NAV_ITEMS } from '@/app/router/nav-items'
import { t } from '@/lib/i18n'
import { AppShell } from './AppShell'

function renderShell(path = '/', onQuickAdd = vi.fn<() => void>()) {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <AppShell
            navItems={NAV_ITEMS}
            quickAction={{ labelKey: 'quickAdd.title', onSelect: onQuickAdd }}
            headerActions={<button type="button">header action</button>}
          >
            <h1>content</h1>
          </AppShell>
        ),
      },
    ],
    { initialEntries: [path] },
  )
  render(<RouterProvider router={router} />)
  return router
}

describe('AppShell', () => {
  it('renders sidebar, header, main landmark and bottom navigation', () => {
    renderShell('/transactions')
    expect(screen.getByRole('navigation', { name: t('nav.main') })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: t('nav.mobile') })).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content')
    // Header shows the current section name.
    expect(screen.getByRole('banner')).toHaveTextContent(t('nav.transactions'))
  })

  it('offers a skip link to the main content', () => {
    renderShell()
    expect(screen.getByText(t('nav.skipToContent'))).toHaveAttribute('href', '#main-content')
  })

  it('bottom navigation has 3 destinations, a central "+" and a menu button', () => {
    renderShell()
    const bottom = within(screen.getByRole('navigation', { name: t('nav.mobile') }))
    expect(bottom.getAllByRole('link')).toHaveLength(3)
    expect(bottom.getByRole('button', { name: t('quickAdd.title') })).toHaveAttribute('aria-haspopup', 'dialog')
    expect(bottom.getByRole('button', { name: t('nav.more') })).toHaveAttribute('aria-expanded', 'false')
  })

  it('"+" calls the quick-add action; header actions render', async () => {
    const onQuickAdd = vi.fn<() => void>()
    renderShell('/', onQuickAdd)
    await userEvent.click(screen.getByRole('button', { name: t('quickAdd.title') }))
    expect(onQuickAdd).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'header action' })).toBeInTheDocument()
  })

  it('opens the full menu from "เพิ่มเติม" and closes it after navigating', async () => {
    const user = userEvent.setup()
    const router = renderShell()
    await user.click(screen.getByRole('button', { name: t('nav.more') }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('link', { name: t('nav.settings') }))

    expect(router.state.location.pathname).toBe('/settings')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('hides the bottom navigation while a text field has focus (soft keyboard)', async () => {
    const user = userEvent.setup()
    renderShell()
    const bottomNav = screen.getByRole('navigation', { name: t('nav.mobile') })
    const input = document.createElement('input')
    document.body.append(input)
    await user.click(input)
    expect(bottomNav).toHaveAttribute('hidden')
    input.remove()
    await user.click(document.body)
    await waitFor(() => expect(bottomNav).not.toHaveAttribute('hidden'))
  })
})
