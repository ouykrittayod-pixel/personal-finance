import { afterEach, describe, expect, it, vi } from 'vitest'
import { isStaleVersionError, reloadForNewVersion } from './stale-version'

describe('stale version after a deploy', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('recognises missing-chunk errors from each browser, nothing else', () => {
    expect(isStaleVersionError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/a.js'))).toBe(true)
    expect(isStaleVersionError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isStaleVersionError(new Error('error loading dynamically imported module'))).toBe(true)
    expect(isStaleVersionError(new Error('Cannot read properties of undefined'))).toBe(false)
  })

  it('reloads once, then not again within the guard window', () => {
    const store = new Map<string, string>()
    let reloads = 0
    const reload = () => {
      reloads++
    }
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) })
    vi.stubGlobal('window', { location: { reload } })
    expect(reloadForNewVersion(1_000_000)).toBe(true)
    expect(reloadForNewVersion(1_005_000)).toBe(false)
    expect(reloadForNewVersion(1_100_000)).toBe(true)
    expect(reloads).toBe(2)
  })
})
