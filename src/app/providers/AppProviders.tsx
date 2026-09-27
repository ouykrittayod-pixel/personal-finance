import type { ReactNode } from 'react'
import { ToastProvider } from '@/components/feedback/Toast'
import { StorageProvider } from './StorageProvider'

/** All app-wide providers in one place. Add theme/locale providers here later. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <StorageProvider>
      <ToastProvider>{children}</ToastProvider>
    </StorageProvider>
  )
}
