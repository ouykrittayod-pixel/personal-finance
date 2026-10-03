/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL (public). Optional: without it the app is local-only. */
  readonly VITE_SUPABASE_URL?: string
  /** Supabase anon / publishable key (public by design; RLS protects data). Never a service_role or secret key. */
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_APP_VERSION?: string
}
