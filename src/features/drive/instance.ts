/** The app-wide Drive sync, wired to the real Google sign-in and Drive API. */
import { useSyncExternalStore } from 'react'
import { db } from '@/db/dexie'
import { currentAccessToken, fetchGoogleUser, requestAccessToken, revokeAccess } from '@/lib/google/auth'
import { driveConfigured } from '@/lib/google/config'
import { createDriveSync } from './drive-sync'
import { createDriveStore } from './google-drive-store'

export const driveSync = createDriveSync({
  database: db,
  configured: driveConfigured,
  auth: {
    currentToken: () => currentAccessToken(),
    signIn: (loginHint) => requestAccessToken({ loginHint }),
    user: fetchGoogleUser,
    signOut: revokeAccess,
  },
  createStore: (getToken, deviceId) => createDriveStore({ getToken, deviceId }),
})

export const useDriveSync = () => useSyncExternalStore(driveSync.subscribe, driveSync.getState)
