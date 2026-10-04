/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Google OAuth Client ID (public). Optional: without it the app keeps data in this browser only. */
  readonly VITE_GOOGLE_CLIENT_ID?: string
  readonly VITE_APP_VERSION?: string
}
