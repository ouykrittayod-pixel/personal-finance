/** The app-wide Drive sync, wired to the real Google sign-in and Drive API. */
import { useSyncExternalStore } from 'react'
import { db } from '@/db/dexie'
import { currentAccessToken, fetchGoogleUser, requestAccessToken, revokeAccess } from '@/lib/google/auth'
import { driveConfigured } from '@/lib/google/config'
import { takeRedirectResult } from '@/lib/google/oauth-redirect'
import { createDriveSync } from './drive-sync'
import { createDriveStore } from './google-drive-store'
import { createGoogleSheetMirror } from './google-sheet'

export const driveSync = createDriveSync({
  database: db,
  configured: driveConfigured,
  auth: {
    currentToken: () => currentAccessToken(),
    signIn: (loginHint) => requestAccessToken({ loginHint }),
    user: fetchGoogleUser,
    signOut: revokeAccess,
    takeRedirectResult,
  },
  createStore: (getToken, deviceId) => createDriveStore({ getToken, deviceId }),
  createMirror: (getToken) => createGoogleSheetMirror({ getToken }),
})

export const useDriveSync = () => useSyncExternalStore(driveSync.subscribe, driveSync.getState)
