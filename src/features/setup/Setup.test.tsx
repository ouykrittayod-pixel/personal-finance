// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { routes } from '@/app/router/routes'
import { StorageContext } from '@/app/providers/storage-context'
import { ToastProvider } from '@/components/feedback/Toast'
import { db } from '@/db/dexie'
import { t } from '@/lib/i18n'
import { baht, makeAccount, makeCategory, makeObligation } from '@/test/factories'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const user = userEvent.setup()
  render(
    <StorageContext value={{ persistence: 'unsupported', requestPersistence: async () => {} }}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </StorageContext>,
  )
  return { user, router }
}

const setupCard = () => screen.findByRole('heading', { level: 2, name: /เริ่มต้น/ }, { timeout: 15_000 })
const card = (heading: HTMLElement) => heading.closest('[data-slot="card"]') as HTMLElement

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()))
})

describe('first run', () => {
  it('empty database: "what do I do first?" with numbered steps that open the existing pages; the Dashboard shows ฿0, no fake numbers', async () => {
    const { user, router } = renderAt('/')
    const heading = await setupCard()
    expect(heading).toHaveTextContent(t('start.firstRun.title'))
    const list = within(card(heading)).getByRole('list')
    const items = within(list).getAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining(`1. ${t('start.item.accounts')}`),
      expect.stringContaining(`2. ${t('start.item.categories')}`),
      expect.stringContaining(`3. ${t('start.item.income')}`),
      expect.stringContaining(`4. ${t('start.item.debts')}`),
      expect.stringContaining(`5. ${t('start.item.recurring')}`),
      expect.stringContaining(`6. ${t('start.item.budget')}`),
      expect.stringContaining(`7. ${t('start.item.firstEntry')}`),
    ])
    expect(within(list).getByRole('link', { name: t('start.go', { name: t('start.item.accounts') }) })).toHaveAttribute('href', '/accounts')
    expect(within(list).getByRole('link', { name: t('start.go', { name: t('start.item.recurring') }) })).toHaveAttribute('href', '/recurring')
    // Summary cards show real zeros.
    const main = screen.getByRole('main')
    await waitFor(() => expect(main).toHaveTextContent(t('dashboard.income.label')))
    expect(main.textContent).toContain('฿0')
    // The first-entry step opens Quick Expense directly.
    await user.click(within(list).getByRole('button', { name: t('start.record') }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(within(list).getByRole('link', { name: t('start.go', { name: t('start.item.accounts') }) }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/accounts'), { timeout: 10_000 })
  }, 30_000)

  it('with data: progress comes from the database; done items show what exists', async () => {
    await db.accounts.bulkAdd([makeAccount({ id: 'kbank', name: 'KBank' }), makeAccount({ id: 'cash', name: 'Cash', kind: 'cash' })])
    await db.categories.bulkAdd([makeCategory({ id: 'food' }), makeCategory({ id: 'salary', kind: 'income' })])
    await db.recurringObligations.add(
      makeObligation({ id: 'sal', name: 'เงินเดือน', kind: 'income', expectedAmountSatang: baht(27_500), categoryId: 'salary', defaultAccountId: 'kbank' }),
    )
    renderAt('/')
    const heading = await setupCard()
    expect(heading).toHaveTextContent(t('start.title'))
    const box = card(heading)
    expect(box).toHaveTextContent(t('start.progress', { done: 3, total: 7 }))
    expect(box).toHaveTextContent(t('start.item.accounts.done', { count: '2' }))
    expect(box).toHaveTextContent(t('start.item.income.doneRules', { count: 1 }))
    expect(within(box).queryByRole('link', { name: t('start.go', { name: t('start.item.accounts') }) })).not.toBeInTheDocument()
  }, 30_000)

  it('can be dismissed, and shown again from Settings; it never creates records', async () => {
    const { user } = renderAt('/')
    const heading = await setupCard()
    await user.click(within(card(heading)).getByRole('button', { name: t('start.dismiss') }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: t('start.firstRun.title') })).not.toBeInTheDocument())
    expect((await db.meta.get('setupDismissedAt'))?.value).toEqual(expect.any(String))
    expect(await db.accounts.count()).toBe(0)
    expect(await db.categories.count()).toBe(0)

    await user.click(screen.getAllByRole('link', { name: t('nav.settings') })[0]!)
    await user.click(await screen.findByRole('button', { name: t('start.showAgain') }, { timeout: 10_000 }))
    await waitFor(async () => expect(await db.meta.get('setupDismissedAt')).toBeUndefined())
  }, 30_000)
})
