// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { ToastProvider } from '@/components/feedback/Toast'
import { db } from '@/db/dexie'
import { t } from '@/lib/i18n'
import { useQuickEntry } from './quick-entry-context'
import { QuickEntryProvider } from './QuickEntryProvider'

function PlusButton() {
  const { openMenu } = useQuickEntry()
  return (
    <button type="button" onClick={openMenu}>
      +
    </button>
  )
}

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()))
})

describe('QuickEntryProvider', () => {
  it('"+" offers expense, income, bill and debt; expense opens the form', async () => {
    const user = userEvent.setup()
    render(
      <ToastProvider>
        <QuickEntryProvider>
          <PlusButton />
        </QuickEntryProvider>
      </ToastProvider>,
    )
    await user.click(screen.getByRole('button', { name: '+' }))
    const menu = await screen.findByRole('dialog', { name: t('quickAdd.title') })
    const expense = within(menu).getByRole('button', { name: new RegExp(t('quickAdd.expense')) })
    expect(within(menu).getByRole('button', { name: new RegExp(t('quickAdd.income')) })).toBeEnabled()
    expect(within(menu).getByRole('button', { name: new RegExp(t('quickAdd.bill')) })).toBeEnabled()
    expect(within(menu).getByRole('button', { name: new RegExp(t('quickAdd.debt')) })).toBeEnabled()

    await user.click(expense)
    expect(await screen.findByRole('dialog', { name: t('expense.title') }, { timeout: 5000 })).toBeInTheDocument()
  })

  it('income opens the same quick form in income mode', async () => {
    const user = userEvent.setup()
    render(
      <ToastProvider>
        <QuickEntryProvider>
          <PlusButton />
        </QuickEntryProvider>
      </ToastProvider>,
    )
    await user.click(screen.getByRole('button', { name: '+' }))
    const menu = await screen.findByRole('dialog', { name: t('quickAdd.title') })
    await user.click(within(menu).getByRole('button', { name: new RegExp(t('quickAdd.income')) }))
    expect(await screen.findByRole('dialog', { name: t('income.sheetTitle') }, { timeout: 5000 })).toBeInTheDocument()
  })

  it('โอนเงิน opens the same quick form in transfer mode', async () => {
    const user = userEvent.setup()
    render(
      <ToastProvider>
        <QuickEntryProvider>
          <PlusButton />
        </QuickEntryProvider>
      </ToastProvider>,
    )
    await user.click(screen.getByRole('button', { name: '+' }))
    const menu = await screen.findByRole('dialog', { name: t('quickAdd.title') })
    await user.click(within(menu).getByRole('button', { name: new RegExp(t('quickAdd.transfer')) }))
    expect(await screen.findByRole('dialog', { name: t('transfer.title') }, { timeout: 5000 })).toBeInTheDocument()
  })

  it('the debt action opens the debts page', async () => {
    const user = userEvent.setup()
    render(
      <ToastProvider>
        <QuickEntryProvider>
          <PlusButton />
        </QuickEntryProvider>
      </ToastProvider>,
    )
    await user.click(screen.getByRole('button', { name: '+' }))
    const menu = await screen.findByRole('dialog', { name: t('quickAdd.title') })
    await user.click(within(menu).getByRole('button', { name: new RegExp(t('quickAdd.debt')) }))
    expect(window.location.hash).toBe('#/debts')
  })
})
