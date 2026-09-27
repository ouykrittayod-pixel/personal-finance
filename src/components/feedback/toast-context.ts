import { createContext, useContext } from 'react'

export type ToastTone = 'success' | 'error' | 'info'

export interface ToastInput {
  message: string
  tone?: ToastTone
  /** Milliseconds before auto-dismiss (default 4000). */
  duration?: number
}

export interface ToastApi {
  show: (toast: ToastInput) => void
}

export const ToastContext = createContext<ToastApi | null>(null)

/** Show short, non-blocking feedback. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast must be used inside <ToastProvider>')
  return api
}
