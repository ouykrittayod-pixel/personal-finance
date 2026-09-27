// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/feedback/Toast'
import { db } from '@/db/dexie'
import { loadIntegritySnapshot } from '@/db/integrity-snapshot'
import { downloadBlob } from '@/lib/download'
import { makeAccount, makeCategory } from '@/test/factories'
import { bigLedger, cleanLedger, salesFile, xd, xlsxFile } from '@/test/import-fixtures'
import { ImportPage } from './ImportPage'
import { ti } from './import-messages'

vi.mock('@/lib/download', () => ({ downloadBlob: vi.fn<typeof downloadBlob>() }))
const download = vi.mocked(downloadBlob)

const WRITES = ['add', 'put', 'bulkAdd', 'bulkPut', 'update', 'bulkUpdate', 'delete', 'bulkDelete', 'clear'] as const
let writeSpies: ReturnType<typeof vi.spyOn>[] = []
let before = ''

async function toFile(fixture: { name: string; arrayBuffer: () => Promise<ArrayBuffer> }) {
  return new File([await fixture.arrayBuffer()], fixture.name)
}

function renderPage() {
  const user = userEvent.setup()
  render(
    <ToastProvider>
      <ImportPage />
    </ToastProvider>,
  )
  return { user }
}

async function upload(user: ReturnType<typeof userEvent.setup>, fixture: Parameters<typeof toFile>[0]) {
  await screen.findByRole('button', { name: ti('import.file.choose') })
  await user.upload(screen.getByLabelText(ti('import.file.label')), await toFile(fixture))
  await screen.findByRole('heading', { name: ti('import.step.2') }, { timeout: 20_000 })
}

beforeEach(async () => {
  vi.restoreAllMocks()
  download.mockClear()
  await Promise.all(db.tables.map((table) => table.clear()))
  await db.accounts.bulkAdd([
    makeAccount({ id: 'cash', name: 'Cash', kind: 'cash' }),
    makeAccount({ id: 'kbank', name: 'KBank' }),
    makeAccount({ id: 'card', name: 'บัตร KBank', kind: 'credit_card' }),
  ])
  await db.categories.bulkAdd([
    makeCategory({ id: 'food', name: 'อาหาร' }),
    makeCategory({ id: 'shop', name: 'ช้อปปิ้ง' }),
    makeCategory({ id: 'salary', name: 'เงินเดือน', kind: 'income' }),
  ])
  before = JSON.stringify(await loadIntegritySnapshot(db))
  // From here on, any write to any table fails the test.
  const proto = Object.getPrototypeOf(db.transactions) as Record<string, unknown>
  writeSpies = WRITES.map((method) => vi.spyOn(proto as never, method as never))
})

afterEach(() => {
  writeSpies.forEach((spy) => spy.mockRestore())
})

/** No table write was attempted and the database is exactly as before. */
async function expectNothingWritten() {
  expect(writeSpies.filter((spy) => spy.mock.calls.length > 0)).toEqual([])
  expect(JSON.stringify(await loadIntegritySnapshot(db))).toBe(before)
}

describe('Import Center (no database writes)', () => {
  it('file → sheet → mapping → validation → preview → ready, with the "not written" notice throughout', async () => {
    const { user } = renderPage()
    expect(screen.getByRole('note')).toHaveTextContent(ti('import.noWrite'))
    await upload(user, cleanLedger())

    // Step 2: the workbook
    const summary = screen.getByRole('heading', { name: ti('import.step.2') }).closest('[data-slot="card"]') as HTMLElement
    expect(summary).toHaveTextContent('ledger.xlsx')
    expect(summary).toHaveTextContent(ti('import.sheet.guess', { kind: ti('import.kind.transaction_history') }))
    expect(summary).toHaveTextContent(ti('import.sheet.headerDetected', { row: 3 }))
    await user.click(within(summary).getByRole('button', { name: ti('import.sheet.select', { name: 'รายการ' }) }))

    // Step 3: header row + profiles
    expect(await screen.findByRole('heading', { name: 'รายการ' })).toBeInTheDocument()
    expect(screen.getByLabelText(ti('import.sheet.header'))).toHaveValue('2')
    const columns = screen.getByRole('table', { name: ti('import.sheet.columns') })
    expect(within(columns).getByRole('row', { name: /จำนวนเงิน/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: ti('import.sheet.use') }))

    // Step 4: mapping (suggested, editable) and value mappings
    expect(await screen.findByRole('heading', { name: ti('import.map.title') })).toBeInTheDocument()
    expect(screen.getByLabelText(ti('import.field.date'))).toHaveDisplayValue('วันที่')
    expect(screen.getByLabelText(ti('import.field.amount'))).toHaveDisplayValue('จำนวนเงิน')
    expect(screen.getByRole('heading', { name: ti('import.values.title', { field: ti('import.field.account') }) })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: ti('import.validate') }))

    // Step 5: summary
    const noWrite = await screen.findByTestId('no-write')
    expect(noWrite).toHaveTextContent(ti('import.noWrite'))
    const summaryCard = screen.getByRole('heading', { name: ti('import.summary.title') }).closest('[data-slot="card"]') as HTMLElement
    expect(summaryCard).toHaveTextContent(`${ti('import.summary.rows')}5`)
    expect(summaryCard).toHaveTextContent(`${ti('import.summary.ready')}3`)
    expect(summaryCard).toHaveTextContent(`${ti('import.summary.errors')}2`)
    expect(summaryCard).toHaveTextContent(ti('import.status.datasetNotReady'))
    await user.click(screen.getByRole('button', { name: ti('import.toPreview') }))

    // Step 6: filter, row detail, export
    const list = await screen.findByRole('list', { name: ti('import.preview.list') })
    expect(within(list).getAllByRole('listitem')).toHaveLength(5)
    await user.click(screen.getByRole('tab', { name: ti('import.filter.error') }))
    await waitFor(() => expect(within(screen.getByRole('list', { name: ti('import.preview.list') })).getAllByRole('listitem')).toHaveLength(2))
    await user.click(within(screen.getByRole('list', { name: ti('import.preview.list') })).getAllByRole('button')[0]!)
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(ti('import.detail.source'))
    expect(dialog).toHaveTextContent('ledger.xlsx')
    expect(dialog).toHaveTextContent(ti('import.msg.debt_missing'))
    expect(dialog).toHaveTextContent(ti('import.detail.original'))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: ti('import.export.json') }))
    await user.click(screen.getByRole('button', { name: ti('import.export.csv') }))
    expect(download.mock.calls.map((call) => call[1])).toEqual(['normalized-preview.json', 'normalized-preview.csv'])
    await user.click(screen.getByRole('button', { name: ti('import.next') }))

    // Step 7: no import yet
    expect(await screen.findByRole('heading', { name: ti('import.ready.title') })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: ti('import.ready.disabled') })).toBeDisabled()
    await expectNothingWritten()
  }, 60_000)

  it('business sales data is flagged as not personal income/expense', async () => {
    const { user } = renderPage()
    await upload(user, salesFile())
    expect(screen.getAllByText(new RegExp(ti('import.sheet.notPersonal'))).length).toBeGreaterThan(0)
    await user.click(screen.getAllByRole('button', { name: /^เลือก Sheet .+/ })[0]!)
    expect(await screen.findByRole('button', { name: ti('import.sheet.useAnyway') })).toBeInTheDocument()
    expect(screen.getByText(ti('import.sheet.notPersonalHint'))).toBeInTheDocument()
    await expectNothingWritten()
  }, 30_000)

  it('a suggested match is applied only when the user accepts it', async () => {
    const file = xlsxFile('food.xlsx', [
      {
        name: 'S',
        rows: [
          ['Date', 'Type', 'Amount', 'Account', 'Category'],
          [xd('2026-09-01'), 'expense', '50', 'Cash', 'Food'],
        ],
      },
    ])
    const { user } = renderPage()
    await upload(user, file)
    await user.click(screen.getAllByRole('button', { name: /^เลือก Sheet .+/ })[0]!)
    await user.click(await screen.findByRole('button', { name: ti('import.sheet.use') }))
    const select = await screen.findByLabelText(`${ti('import.field.category')}: Food`)
    expect(select).toHaveValue('')
    await user.click(screen.getByRole('button', { name: new RegExp('^' + ti('import.values.accept') + ':') }))
    expect(select).toHaveValue('food')
    await expectNothingWritten()
  }, 30_000)

  it('an unreadable file shows an error; nothing else happens', async () => {
    const { user } = renderPage()
    await screen.findByRole('button', { name: ti('import.file.choose') })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await user.upload(screen.getByLabelText(ti('import.file.label')), new File(['not excel'], 'fake.xlsx'))
    expect(await screen.findByRole('alert')).toHaveTextContent(ti('import.file.error.unreadable'))
    await expectNothingWritten()
  })

  it('10,000 rows: the preview renders only the visible rows', async () => {
    const { user } = renderPage()
    await upload(user, bigLedger(10_000))
    await user.click(screen.getAllByRole('button', { name: /^เลือก Sheet .+/ })[0]!)
    await user.click(await screen.findByRole('button', { name: ti('import.sheet.use') }))
    await user.click(await screen.findByRole('button', { name: ti('import.validate') }))
    await user.click(await screen.findByRole('button', { name: ti('import.toPreview') }, { timeout: 30_000 }))
    const list = await screen.findByRole('list', { name: ti('import.preview.list') })
    const items = within(list).getAllByRole('listitem')
    expect(items.length).toBeLessThan(40)
    expect(items[0]).toHaveAttribute('aria-setsize', '10000')
    await expectNothingWritten()
  }, 120_000)
})
