// Must run before the router is created (it reads the address).
import '@/app/oauth-return'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'
import { AppProviders } from '@/app/providers/AppProviders'
import { router } from '@/app/router'
import { reloadForNewVersion } from '@/app/stale-version'
import './index.css'

// Vite reports a screen file that failed to load (e.g. replaced by a newer deploy): reload once to get the new version.
window.addEventListener('vite:preloadError', () => {
  reloadForNewVersion()
})

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')

createRoot(rootElement).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
)
