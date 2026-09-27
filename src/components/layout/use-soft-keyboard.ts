import { useEffect, useState } from 'react'

const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit'])

function opensKeyboard(element: Element | null): boolean {
  if (!element) return false
  if (element instanceof HTMLTextAreaElement) return true
  if (element instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(element.type)
  return element instanceof HTMLElement && element.isContentEditable
}

/**
 * True while a text field has focus — i.e. the on-screen keyboard is probably open.
 * Used to hide the bottom navigation so it doesn't ride on top of the keyboard.
 */
export function useSoftKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const update = () => setOpen(opensKeyboard(document.activeElement))
    // focusout fires before focus moves; re-check on the next frame.
    const recheckSoon = () => requestAnimationFrame(update)
    // Removing a focused field (e.g. a form unmounting after save) fires no
    // focus event, so also re-check on the next tap and when the visual
    // viewport resizes (the keyboard closing).
    const viewport = window.visualViewport
    document.addEventListener('focusin', update)
    document.addEventListener('focusout', recheckSoon)
    document.addEventListener('pointerdown', recheckSoon)
    viewport?.addEventListener('resize', recheckSoon)
    return () => {
      document.removeEventListener('focusin', update)
      document.removeEventListener('focusout', recheckSoon)
      document.removeEventListener('pointerdown', recheckSoon)
      viewport?.removeEventListener('resize', recheckSoon)
    }
  }, [])

  return open
}
