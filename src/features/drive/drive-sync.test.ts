/**
 * Connecting a device to Google Drive, reconnecting, switching account and
 * signing out — with a fake Google sign-in and an in-memory Drive per account.
 */
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { FinanceDatabase } from '@/db/dexie'
import { ensureSyncFoundation } from '@/db/sync/foundation'
import { GoogleAuthError } from '@/lib/google/auth'
import { createFakeDrive, type FakeDrive } from '@/test/fake-drive'
import { baht, makeAccount, makeTx } from '@/test/factories'
import { createDriveSync, type DriveAuth } from './drive-sync'
import type { SheetMirror } from './google-sheet'
import type { SheetTab } from './sheet-tabs'
import { syncOnce } from './sync-engine'

const opened: FinanceDatabase[] = []
async function device() {
  const database = new FinanceDatabase(`drive-ctl-${crypto.randomUUID()}`)
  opened.push(database)
  await ensureSyncFoundation(database)
  return database
}
afterEach(async () => {
  for (const database of opened.splice(0)) {
    database.close()
    await Dexie.delete(database.name)
  }
})

let clock = Date.parse('2026-10-04T00:00:00.000Z')
const now = () => new Date((clock += 1000)).toISOString()

interface Account {
  sub: string
  email: string
  drive: FakeDrive
}
const account = (sub: string): Account => ({ sub, email: `${sub}@example.com`, drive: createFakeDrive(now) })

interface FakeGoogle {
  next: Account
  signedIn: Account | null
  cancel: boolean
  signIns: number
  auth: DriveAuth
}

/** Google as seen by one device: who signs in next, and whether a valid token is cached. */
function fakeGoogle(first: Account): FakeGoogle {
  const google: FakeGoogle = {
    next: first,
    signedIn: null,
    cancel: false,
    signIns: 0,
    auth: {
      currentToken: () => (google.signedIn ? `token-${google.signedIn.sub}` : null),
      signIn: async () => {
        google.signIns++
        if (google.cancel) throw new GoogleAuthError('cancelled')
        google.signedIn = google.next
        return `token-${google.next.sub}`
      },
      user: async (token: string) => {
        const who = token.replace('token-', '')
        return { sub: who, email: `${who}@example.com` }
      },
      signOut: async () => {
        google.signedIn = null
      },
    },
  }
  return google
}

function controller(database: FinanceDatabase, google: FakeGoogle, accounts: Account[], configured = true, mirror?: SheetMirror) {
  return createDriveSync({
    ...(mirror ? { createMirror: () => mirror } : {}),
    database,
    configured,
    auth: google.auth,
    now,
    createStore: (getToken) => {
      const store = () => accounts.find((a) => a.sub === google.signedIn?.sub)!.drive.store()
      // Every call asks for a token first, like the real store.
      const guarded = (name: keyof ReturnType<FakeDrive['store']>) =>
        async (...args: unknown[]) => {
          await getToken()
          return (store()[name] as (...a: unknown[]) => unknown)(...args)
        }
      return {
        version: guarded('version'),
        read: guarded('read'),
        write: guarded('write'),
        listAttachments: guarded('listAttachments'),
        uploadAttachment: guarded('uploadAttachment'),
        downloadAttachment: guarded('downloadAttachment'),
        deleteAttachment: guarded('deleteAttachment'),
      } as ReturnType<FakeDrive['store']>
    },
  })
}

/** Put data into an account's Drive as if another device had synced it. */
async function seedDrive(target: Account) {
  const other = await device()
  await other.accounts.add(makeAccount({ id: 'kbank', name: 'KBank' }))
  await other.transactions.add(makeTx({ id: 'salary', type: 'income', amountSatang: baht(27_500), accountId: 'kbank' }))
  await syncOnce(other, target.drive.store(), { now })
}

describe('Drive connection on a device', () => {
  it('without a Client ID the app stays local and never asks', async () => {
    const database = await device()
    const me = account('me')
    const google = fakeGoogle(me)
    const drive = controller(database, google, [me], false)
    await drive.start()
    expect(drive.getState().status).toBe('unconfigured')
    expect(google.signIns).toBe(0)
  })

  it('a new device must connect; connecting downloads the data already in Drive', async () => {
    const me = account('me')
    await seedDrive(me)
    const database = await device()
    const google = fakeGoogle(me)
    const drive = controller(database, google, [me])
    await drive.start()
    expect(drive.getState().status).toBe('not_linked')

    expect(await drive.connect()).toBe(true)
    expect(drive.getState()).toMatchObject({ status: 'synced', email: 'me@example.com', error: null })
    expect((await database.transactions.get('salary'))?.amountSatang).toBe(baht(27_500))
  })

  it('a cancelled sign-in leaves the device unconnected with a reason', async () => {
    const me = account('me')
    const database = await device()
    const google = fakeGoogle(me)
    google.cancel = true
    const drive = controller(database, google, [me])
    await drive.start()
    expect(await drive.connect()).toBe(false)
    expect(drive.getState()).toMatchObject({ status: 'not_linked', error: 'cancelled' })
  })

  it('when the hour-long token has expired, sync waits for one tap; data stays usable', async () => {
    const me = account('me')
    const database = await device()
    const google = fakeGoogle(me)
    const drive = controller(database, google, [me])
    await drive.start()
    await drive.connect()
    await database.accounts.add(makeAccount({ id: 'offline-edit' }))
    google.signedIn = null // token expired

    await drive.sync()
    expect(drive.getState().status).toBe('needs_sign_in')
    expect(await database.accounts.get('offline-edit')).toBeDefined()

    expect(await drive.connect()).toBe(true)
    expect(drive.getState().status).toBe('synced')
    expect(me.drive.snapshot()!.data.accounts.map((a) => a.id)).toContain('offline-edit')
  })

  it('reopening the app on a linked device syncs without a pop-up', async () => {
    const me = account('me')
    const database = await device()
    const google = fakeGoogle(me)
    const first = controller(database, google, [me])
    await first.start()
    await first.connect()
    const signIns = google.signIns
    await seedDrive(me) // another device added data meanwhile

    const reopened = controller(database, google, [me])
    await reopened.start()
    expect(reopened.getState().status).toBe('synced')
    expect(google.signIns).toBe(signIns)
    expect(await database.transactions.get('salary')).toBeDefined()
  })

  it('switching to another Google account empties the cache first, then loads that account', async () => {
    const me = account('me')
    const work = account('work')
    await seedDrive(work)
    const database = await device()
    const google = fakeGoogle(me)
    const drive = controller(database, google, [me, work])
    await drive.start()
    await drive.connect()
    await database.accounts.add(makeAccount({ id: 'personal-only' }))
    await drive.sync()

    google.signedIn = null
    google.next = work
    expect(await drive.connect()).toBe(true)
    expect(drive.getState().email).toBe('work@example.com')
    expect(await database.accounts.get('personal-only')).toBeUndefined()
    expect(await database.accounts.get('kbank')).toBeDefined()
    // Nothing of the first account leaked into the second account's Drive.
    expect(work.drive.snapshot()!.data.accounts.map((a) => a.id)).toEqual(['kbank'])
  })

  it('refuses to switch account while this device has changes that never reached Drive', async () => {
    const me = account('me')
    const work = account('work')
    const database = await device()
    const google = fakeGoogle(me)
    const drive = controller(database, google, [me, work])
    await drive.start()
    await drive.connect()
    google.signedIn = null // offline-ish: the edit cannot go up
    await database.accounts.add(makeAccount({ id: 'unsynced' }))

    google.next = work
    expect(await drive.connect()).toBe(false)
    expect(drive.getState().error).toBe('other_account_pending')
    expect(await database.accounts.get('unsynced')).toBeDefined()
    expect(work.drive.snapshot()).toBeNull()
  })

  it('signing out deletes the cache on this device; the data stays in Drive', async () => {
    const me = account('me')
    await seedDrive(me)
    const database = await device()
    const google = fakeGoogle(me)
    const drive = controller(database, google, [me])
    await drive.start()
    await drive.connect()
    await drive.signOut()
    expect(drive.getState().status).toBe('not_linked')
    expect(await database.transactions.count()).toBe(0)
    expect(await database.syncOutbox.count()).toBe(0)
    expect(me.drive.snapshot()!.data.transactions.map((t) => t.id)).toEqual(['salary'])
  })

  it('after a restore, the restored data replaces Drive', async () => {
    const me = account('me')
    await seedDrive(me)
    const database = await device()
    const google = fakeGoogle(me)
    const drive = controller(database, google, [me])
    await drive.start()
    await drive.connect()
    await database.transaction('rw', database.tables, async () => {
      for (const table of [database.transactions, database.accounts, database.syncOutbox, database.syncTombstones]) await table.clear()
      await database.accounts.add(makeAccount({ id: 'restored' }))
      await database.syncOutbox.clear()
    })
    await drive.replaceRemoteWithLocal()
    expect(me.drive.snapshot()!.data.accounts.map((a) => a.id)).toEqual(['restored'])
    expect(me.drive.snapshot()!.data.transactions).toEqual([])
  })

  it('keeps the read-only sheet up to date after syncs that changed data', async () => {
    const me = account('me')
    await seedDrive(me)
    const database = await device()
    const google = fakeGoogle(me)
    const published: SheetTab[][] = []
    const mirror: SheetMirror = {
      publish: async (tabs) => {
        published.push(tabs)
        return 'https://docs.google.com/spreadsheets/d/s1'
      },
    }
    const drive = controller(database, google, [me], true, mirror)
    await drive.start()
    await drive.connect()
    expect(drive.getState().sheetUrl).toBe('https://docs.google.com/spreadsheets/d/s1')
    expect(published).toHaveLength(1)
    expect(published[0]!.find((t) => t.title === 'รายการ')!.rows).toHaveLength(1)

    await drive.sync() // nothing changed: the sheet is not rewritten
    expect(published).toHaveLength(1)
    await database.transactions.add(makeTx({ id: 'coffee', type: 'expense', amountSatang: baht(60), accountId: 'kbank' }))
    await drive.sync()
    expect(published).toHaveLength(2)
  })

  it('a failed sheet update never fails the sync, and is retried next time', async () => {
    const me = account('me')
    const database = await device()
    const google = fakeGoogle(me)
    let fail = true
    let publishes = 0
    const mirror: SheetMirror = {
      publish: async () => {
        publishes++
        if (fail) throw new Error('Sheets quota')
        return 'https://docs.google.com/spreadsheets/d/s1'
      },
    }
    const drive = controller(database, google, [me], true, mirror)
    await drive.start()
    await drive.connect()
    expect(drive.getState()).toMatchObject({ status: 'synced', sheetError: true })
    fail = false
    await drive.sync()
    expect(publishes).toBe(2)
    expect(drive.getState()).toMatchObject({ status: 'synced', sheetError: false, sheetUrl: 'https://docs.google.com/spreadsheets/d/s1' })
  })

  it('a home-screen app coming back from the Google sign-in page finishes connecting by itself', async () => {
    const me = account('me')
    await seedDrive(me)
    const database = await device()
    const google = fakeGoogle(me)
    let redirect: string | null = 'ok'
    google.auth.takeRedirectResult = () => {
      const result = redirect
      redirect = null
      return result
    }
    google.signedIn = me // the token arrived in the URL and was stored before the app started
    const drive = controller(database, google, [me])
    await drive.start()
    expect(drive.getState()).toMatchObject({ status: 'synced', email: 'me@example.com' })
    expect(google.signIns).toBe(0)
    expect(await database.transactions.get('salary')).toBeDefined()
  })

  it('a refusal on the Google page shows why, without connecting', async () => {
    const me = account('me')
    const database = await device()
    const google = fakeGoogle(me)
    google.auth.takeRedirectResult = () => 'access_denied'
    const drive = controller(database, google, [me])
    await drive.start()
    expect(drive.getState()).toMatchObject({ status: 'not_linked', error: 'cancelled' })
  })
})
