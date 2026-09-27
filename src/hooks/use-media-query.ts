import { useSyncExternalStore } from 'react'

/** Live `matchMedia` result. False where matchMedia is unavailable (tests, SSR). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== 'function') return () => {}
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false),
    () => false,
  )
}

/** Tablet/desktop layout (Tailwind `md`, ≥ 768px). */
export const useIsWideScreen = () => useMediaQuery('(min-width: 48rem)')
