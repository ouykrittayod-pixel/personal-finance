/**
 * Google sign-in configuration.
 *
 * The OAuth Client ID is public by design (it identifies the app, it is not a
 * secret); access is limited by the scopes the user grants and by the
 * "Authorized JavaScript origins" set in Google Cloud Console.
 *
 * Without a Client ID (and always in tests) the app runs without Google Drive,
 * keeping data in this browser only.
 */
const BUILT_IN_CLIENT_ID = ''

export const GOOGLE_CLIENT_ID: string = import.meta.env.MODE === 'test' ? '' : (import.meta.env.VITE_GOOGLE_CLIENT_ID || BUILT_IN_CLIENT_ID)

export const driveConfigured = GOOGLE_CLIENT_ID !== ''

/**
 * - drive.appdata: the app's hidden folder in the user's Drive (data file, receipts). The app cannot see other files.
 * - drive.file: only files this app creates (the read-only Google Sheet).
 * - openid email: which Google account is connected (so one device never mixes two accounts' data).
 */
export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/drive.appdata', 'https://www.googleapis.com/auth/drive.file', 'openid', 'email']
export const REQUIRED_SCOPES = ['https://www.googleapis.com/auth/drive.appdata']
