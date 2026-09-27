// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { ToastProvider } from '@/components/feedback/Toast'
import { db } from '@/db/dexie'
import { t } from '@/lib/i18n'
import { makeCategory } from '@/test/factories'
import { CategoriesCard } from '.'

function renderCard() {
  const user = userEvent.setup()
  render(
    <ToastProvider>
      <CategoriesCard />
    </ToastProvider>,
  )
  return { user }
}

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()))
})

describe('Settings: categories', () => {
  it('no categories: offers the starter set (created once, on request)', async () => {
    const { user } = renderCard()
    await user.click(await screen.findByRole('button', { name: t('categories.starter') }))
    await waitFor(async () => expect(await db.categories.where('kind').equals('expense').count()).toBe(9))
    expect(screen.queryByRole('button', { name: t('categories.starter') })).not.toBeInTheDocument()
  })

  it('adds a personal category; a duplicate name is refused with a message', async () => {
    await db.categories.add(makeCategory({ id: 'food', name: 'อาหาร', sortOrder: 0 }))
    const { user } = renderCard()
    await user.click(await screen.findByRole('button', { name: t('categories.add') }))
    let dialog = await screen.findByRole('dialog', { name: t('categories.form.createTitle') })
    await user.type(within(dialog).getByLabelText(t('categories.form.name')), 'ค่าใช้จ่ายส่วนตัว')
    await user.type(within(dialog).getByLabelText(t('categories.form.icon')), '🧴')
    await user.click(within(dialog).getByRole('button', { name: t('categories.form.save') }))
    await waitFor(() => expect(screen.getByText('ค่าใช้จ่ายส่วนตัว')).toBeInTheDocument())
    expect(await db.categories.count()).toBe(2)

    await user.click(screen.getByRole('button', { name: t('categories.add') }))
    dialog = await screen.findByRole('dialog', { name: t('categories.form.createTitle') })
    await user.type(within(dialog).getByLabelText(t('categories.form.name')), ' อาหาร ')
    await user.click(within(dialog).getByRole('button', { name: t('categories.form.save') }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(t('categories.error.duplicate'))
    expect(await db.categories.count()).toBe(2)
  })

  it('renames, archives (never deletes) and restores; income categories have their own tab', async () => {
    await db.categories.bulkAdd([makeCategory({ id: 'food', name: 'อาหาร' }), makeCategory({ id: 'salary', name: 'เงินเดือน', kind: 'income' })])
    const { user } = renderCard()
    await user.click(await screen.findByRole('button', { name: t('categories.edit', { name: 'อาหาร' }) }))
    const dialog = await screen.findByRole('dialog', { name: t('categories.form.editTitle') })
    const name = within(dialog).getByLabelText(t('categories.form.name'))
    await user.clear(name)
    await user.type(name, 'อาหารและเครื่องดื่ม')
    await user.click(within(dialog).getByRole('button', { name: t('categories.form.save') }))
    await waitFor(async () => expect((await db.categories.get('food'))?.name).toBe('อาหารและเครื่องดื่ม'))

    await user.click(screen.getByRole('button', { name: t('categories.archive', { name: 'อาหารและเครื่องดื่ม' }) }))
    await waitFor(async () => expect((await db.categories.get('food'))?.archivedAt).toBeDefined())
    await user.click(screen.getByText(`${t('categories.archived')} (1)`))
    await user.click(screen.getByRole('button', { name: t('categories.restore', { name: 'อาหารและเครื่องดื่ม' }) }))
    await waitFor(async () => expect((await db.categories.get('food'))?.archivedAt).toBeUndefined())
    expect(await db.categories.count()).toBe(2)

    await user.click(screen.getByRole('tab', { name: t('categories.tab.income') }))
    expect(await screen.findByText('เงินเดือน')).toBeInTheDocument()
  })
})
