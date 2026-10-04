/**
 * After a new version is deployed, a page that is still open runs the old
 * code, which may ask for screen files the new version replaced (their names
 * change with every build). The fix is simply to load the new version: reload
 * once. Guarded so a real, persistent failure never causes a reload loop.
 */
const KEY = 'pf-stale-version-reload'
const WINDOW_MS = 30_000

/** Chrome, Firefox and Safari wording for a dynamic import whose file is gone. */
export function isStaleVersionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(message)
}

/** Reload unless this already happened in the last few seconds. Returns whether it reloads. */
export function reloadForNewVersion(now: number = Date.now()): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0)
    if (now - last < WINDOW_MS) return false
    sessionStorage.setItem(KEY, String(now))
  } catch {
    // Storage blocked: still reload once (the page's own state guards nothing here, but a loop needs a broken deploy).
  }
  window.location.reload()
  return true
}
