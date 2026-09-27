// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/feedback/Toast'
import { db } from '@/db/dexie'
import { todayISO } from '@/lib/dates'
import { downloadBlob } from '@/lib/download'
import { t } from '@/lib/i18n'
import { baht, makeAccount, makeCategory, makeTx } from '@/test/factories'
import { BackupCard, ExportCard, RestoreCard } from '.'
import { createBackup } from './create-backup'

vi.mock('@/lib/download', () => ({ downloadBlob: vi.fn<typeof downloadBlob>() }))
const download = vi.mocked(downloadBlob)

const NOW = '2026-09-26T07:30:00.000Z'

function renderCards() {
  const user = userEvent.setup()
  render(
    <ToastProvider>
      <BackupCard />
      <RestoreCard />
      <ExportCard />
    </ToastProvider>,
  )
  return { user }
}

async function seedA() {
  await db.accounts.bulkAdd([
    makeAccount({ id: 'kbank', name: 'KBank', openingBalanceSatang: baht(50_000) }),
    makeAccount({ id: 'cash', name: 'เงินสด', kind: 'cash' }),
  ])
  await db.categories.bulkAdd([makeCategory({ id: 'food', name: 'อาหาร' }), makeCategory({ id: 'salary', name: 'เงินเดือน', kind: 'income' })])
  await db.transactions.bulkAdd([
    makeTx({ id: 'wage', type: 'income', amountSatang: baht(27_500), accountId: 'kbank', categoryId: 'salary', date: '2026-09-25' }),
    makeTx({ id: 'lunch', type: 'expense', amountSatang: baht(2_500), accountId: 'cash', categoryId: 'food', date: '2026-09-03', description: 'ข้าวกลางวัน' }),
  ])
}

/** A backup of seedA, then the database is changed to something else (Test Account + one transaction). */
async function backupThenChange(): Promise<string> {
  await seedA()
  const text = JSON.stringify(await createBackup(db, NOW, '0.1.0'))
  await db.transactions.clear()
  await db.accounts.add(makeAccount({ id: 'test', name: 'Test Account' }))
  await db.transactions.add(makeTx({ id: 'temp', type: 'income', amountSatang: baht(1), accountId: 'test', categoryId: 'salary', date: '2026-09-26' }))
  return text
}

const jsonFile = (text: string, name = 'personal-finance-backup-2026-09-26.json') => new File([text], name, { type: 'application/json' })
const fileInput = () => screen.getByLabelText(t('restore.fileLabel')) as HTMLInputElement
const ids = async () => ({
  accounts: (await db.accounts.toArray()).map((a) => a.id).sort(),
  transactions: (await db.transactions.toArray()).map((tx) => tx.id).sort(),
})
const blobText = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.readAsText(blob)
  })

beforeEach(async () => {
  download.mockClear()
  vi.restoreAllMocks()
  await Promise.all(db.tables.map((table) => table.clear()))
})

describe('Settings: backup', () => {
  it('shows what a backup will contain and that none was made yet', async () => {
    await seedA()
    renderCards()
    const card = screen.getByRole('heading', { name: t('backup.title') }).closest('[data-slot="card"]') as HTMLElement
    expect(card).toHaveTextContent(t('backup.subtitle'))
    await waitFor(() => expect(card).toHaveTextContent(t('backup.recordsValue', { count: '6' })))
    expect(card).toHaveTextContent(t('backup.attachmentsValue', { count: '0' }))
    expect(within(card).getByText(t('backup.size'))).toBeInTheDocument()
    expect(screen.getByTestId('last-backup')).toHaveTextContent(t('backup.never'))
  })

  it('creates a backup file with a dated name, records the time, and the file is a valid backup', async () => {
    await seedA()
    const { user } = renderCards()
    const button = await screen.findByRole('button', { name: t('backup.create') })
    await waitFor(() => expect(button).toBeEnabled())
    await user.click(button)
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1))
    const [blob, fileName] = download.mock.calls[0]!
    expect(fileName).toBe(`personal-finance-backup-${todayISO()}.json`)
    const backup = JSON.parse(await blobText(blob)) as { format: string; counts: Record<string, number> }
    expect(backup.format).toBe('personal-finance-backup')
    expect(backup.counts).toMatchObject({ accounts: 2, categories: 2, transactions: 2 })
    await waitFor(() => expect(screen.getByTestId('last-backup')).not.toHaveTextContent(t('backup.never')))
    expect((await db.meta.get('lastBackupAt'))?.value).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/))
  })
})

describe('Settings: restore', () => {
  it('file picker accepts .json and is labelled', () => {
    renderCards()
    expect(fileInput()).toHaveAttribute('accept', '.json,application/json')
    expect(screen.getByRole('button', { name: t('restore.choose') })).toBeInTheDocument()
  })

  it('invalid JSON: clear error, database unchanged', async () => {
    await seedA()
    const before = await ids()
    const { user } = renderCards()
    await user.upload(fileInput(), jsonFile('{ not json'))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(t('restore.invalid.title'))
    expect(alert).toHaveTextContent(t('restore.error.invalid_json'))
    expect(alert).toHaveTextContent(t('restore.unchanged'))
    expect(await ids()).toEqual(before)
  })

  it('unsupported version and broken references are named', async () => {
    const text = await backupThenChange()
    const { user } = renderCards()
    await user.upload(fileInput(), jsonFile(text.replace('"formatVersion":1', '"formatVersion":999')))
    expect(await screen.findByRole('alert')).toHaveTextContent(t('restore.error.unsupported_version'))
    await user.upload(fileInput(), jsonFile(text.replace('"accountId":"cash"', '"accountId":"nowhere"')))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(t('restore.error.broken_reference')))
  })

  it('preview → confirmation (current vs file) → restore replaces the database and verifies it', async () => {
    const text = await backupThenChange()
    const { user } = renderCards()
    await user.upload(fileInput(), jsonFile(text))

    const preview = await screen.findByRole('dialog', { name: t('restore.preview.title') })
    expect(preview).toHaveTextContent(t('restore.preview.createdAt'))
    expect(within(preview).getByLabelText(t('restore.confirm.incoming'))).toHaveTextContent(`${t('restore.count.transactions')}2`)
    await user.click(within(preview).getByRole('button', { name: t('restore.preview.continue') }))

    const confirm = await screen.findByRole('dialog', { name: t('restore.confirm.title') })
    const row = within(confirm).getByRole('row', { name: new RegExp(t('restore.count.accounts')) })
    expect(row).toHaveTextContent('32') // 3 now (incl. Test Account) → 2 in the file
    expect(confirm).toHaveTextContent(t('restore.confirm.replace'))
    expect(confirm).toHaveTextContent(t('restore.confirm.irreversible'))
    const action = within(confirm).getByRole('button', { name: t('restore.confirm.action') })
    expect(action).toBeDisabled()
    // Nothing is written before the explicit confirmation.
    expect((await ids()).accounts).toContain('test')
    await user.click(within(confirm).getByRole('checkbox', { name: t('restore.confirm.check') }))
    await user.click(action)

    await waitFor(() => expect(screen.getByText(t('restore.success.title'))).toBeInTheDocument())
    expect(screen.getByText(t('restore.success.verified', { count: '6' }))).toBeInTheDocument()
    expect(await ids()).toEqual({ accounts: ['cash', 'kbank'], transactions: ['lunch', 'wage'] })
  })

  it('shows progress while the file is being checked, and blocks a second pick', async () => {
    let finish: (text: string) => void = () => {}
    vi.spyOn(File.prototype, 'text').mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const { user } = renderCards()
    await user.upload(fileInput(), jsonFile('{}'))
    expect(await screen.findByText(t('restore.validating'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('restore.choose') })).toBeDisabled()
    finish('{')
    expect(await screen.findByRole('alert')).toHaveTextContent(t('restore.error.invalid_json'))
    expect(screen.queryByText(t('restore.validating'))).not.toBeInTheDocument()
  })

  it('cancel at the preview leaves everything as it was', async () => {
    const text = await backupThenChange()
    const before = await ids()
    const { user } = renderCards()
    await user.upload(fileInput(), jsonFile(text))
    const preview = await screen.findByRole('dialog', { name: t('restore.preview.title') })
    await user.click(within(preview).getByRole('button', { name: t('detail.cancel') }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await ids()).toEqual(before)
  })

  it('a failure while writing: error shown, current data unchanged', async () => {
    const text = await backupThenChange()
    const before = await ids()
    vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('disk'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { user } = renderCards()
    await user.upload(fileInput(), jsonFile(text))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: t('restore.preview.continue') }))
    const confirm = await screen.findByRole('dialog', { name: t('restore.confirm.title') })
    await user.click(within(confirm).getByRole('checkbox'))
    await user.click(within(confirm).getByRole('button', { name: t('restore.confirm.action') }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(t('restore.failed.title'))
    expect(alert).toHaveTextContent(t('restore.unchanged'))
    expect(await ids()).toEqual(before)
  })
})

describe('Settings: export', () => {
  it('JSON and CSV exports download named files and never write', async () => {
    await seedA()
    const before = await ids()
    const { user } = renderCards()
    await user.click(screen.getByRole('button', { name: t('export.json') }))
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1))
    expect(download.mock.calls[0]![1]).toBe(`personal-finance-data-${todayISO()}.json`)
    expect(JSON.parse(await blobText(download.mock.calls[0]![0]))).toMatchObject({ format: 'personal-finance-data-export', amountUnit: 'satang' })

    await user.click(screen.getByRole('button', { name: t('export.csv') }))
    await waitFor(() => expect(download).toHaveBeenCalledTimes(2))
    const [csv, csvName] = download.mock.calls[1]!
    expect(csvName).toBe(`personal-finance-transactions-${todayISO()}.csv`)
    const text = await blobText(csv)
    expect(text).toContain('วันที่,ประเภท,จำนวนเงิน')
    expect(text).toContain('2026-09-03,รายจ่าย,2500.00,อาหาร,เงินสด,ข้าวกลางวัน')
    expect(await ids()).toEqual(before)
  })

  it('buttons are described by their purpose', () => {
    renderCards()
    expect(screen.getByRole('button', { name: t('export.csv') })).toHaveAccessibleDescription(t('export.csvHint'))
    expect(screen.getByRole('heading', { name: t('export.title') })).toBeInTheDocument()
  })
})
