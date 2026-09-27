import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { ToastContext, type ToastApi, type ToastInput, type ToastTone } from './toast-context'

interface ActiveToast extends Required<ToastInput> {
  id: number
}

const ICON: Record<ToastTone, typeof CheckCircle2> = { success: CheckCircle2, error: AlertCircle, info: Info }
const ICON_TONE: Record<ToastTone, string> = { success: 'text-income', error: 'text-expense', info: 'text-info' }

function ToastItem({ toast, onDismiss }: { toast: ActiveToast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.duration)
    return () => window.clearTimeout(timer)
  }, [toast, onDismiss])
  const Icon = ICON[toast.tone]
  return (
    <div className="pointer-events-auto flex w-full items-center gap-3 rounded-lg border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-md animate-in fade-in-0 slide-in-from-bottom-2 duration-(--duration-base)">
      <Icon className={cn('size-5 shrink-0', ICON_TONE[toast.tone])} aria-hidden="true" />
      <p className="flex-1 font-medium">{toast.message}</p>
      <button type="button" onClick={() => onDismiss(toast.id)} aria-label={t('common.close')} className="focus-ring -mr-1 rounded-md p-1 text-muted-foreground hover:text-foreground">
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  )
}

/**
 * Non-blocking feedback above the bottom navigation (phones) or bottom-right
 * (desktop). The live region is always mounted so announcements are reliable.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ActiveToast[]>([])
  const nextId = useRef(0)

  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), [])
  const api = useMemo<ToastApi>(
    () => ({
      show: ({ message, tone = 'success', duration = 4000 }) => {
        nextId.current += 1
        const id = nextId.current
        // Keep at most 3 visible.
        setToasts((current) => [...current.slice(-2), { id, message, tone, duration }])
      },
    }),
    [],
  )

  return (
    <ToastContext value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--spacing-bottom-nav)+env(safe-area-inset-bottom)+0.75rem)] z-[60] flex flex-col items-center gap-2 px-page-x md:right-page-x md:bottom-page-y md:left-auto md:w-96 md:items-end md:px-0"
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext>
  )
}
