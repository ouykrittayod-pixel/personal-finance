import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void) {
  const viewport = window.visualViewport
  if (!viewport) return () => {}
  viewport.addEventListener('resize', onChange)
  viewport.addEventListener('scroll', onChange)
  return () => {
    viewport.removeEventListener('resize', onChange)
    viewport.removeEventListener('scroll', onChange)
  }
}

/**
 * Height of the visible area in px — shrinks when the on-screen keyboard opens
 * (iOS Safari doesn't resize the layout viewport). Null where unsupported.
 */
export function useVisualViewportHeight(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => (window.visualViewport ? Math.round(window.visualViewport.height) : null),
    () => null,
  )
}
