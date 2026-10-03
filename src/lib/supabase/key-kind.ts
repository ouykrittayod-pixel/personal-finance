/**
 * Is a Supabase key safe for a browser? Pure and environment-free: used by the
 * app at runtime and by vite.config.ts at build time.
 */
function jwtRole(token: string): string | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const json = atob(
      parts[1]!
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(parts[1]!.length / 4) * 4, '='),
    )
    const role = (JSON.parse(json) as { role?: unknown }).role
    return typeof role === 'string' ? role : null
  } catch {
    return null
  }
}

/** 'secret' for anything that must never be in a browser; 'public' for anon/publishable keys; 'invalid' otherwise. */
export function classifySupabaseKey(key: string): 'public' | 'secret' | 'invalid' {
  if (key.startsWith('sb_secret_')) return 'secret'
  if (/^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(key)) return 'public'
  const role = jwtRole(key)
  if (role === 'anon') return 'public'
  if (role !== null) return 'secret' // service_role or any other privileged role
  return 'invalid'
}
