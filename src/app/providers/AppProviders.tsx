import type { ReactNode } from 'react'
import { ToastProvider } from '@/components/feedback/Toast'
import { DriveGate } from '@/features/drive/DriveGate'
import { StorageProvider } from './StorageProvider'

/** All app-wide providers in one place. Add theme/locale providers here later. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <StorageProvider>
      <ToastProvider>
        <DriveGate>{children}</DriveGate>
      </ToastProvider>
    </StorageProvider>
  )
}
