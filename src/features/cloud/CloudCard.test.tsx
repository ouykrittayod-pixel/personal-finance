// @vitest-environment jsdom
/** Phase 19 — without cloud configuration (this build), the card only explains; nothing loads, nothing is sent. */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { t } from '@/lib/i18n'
import { cloudConfig } from '@/lib/supabase/config'
import { CloudCard } from '.'

describe('Settings: cloud card without configuration', () => {
  it('says the cloud is not set up, offers no sign-in, and makes no network request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    expect(cloudConfig.status).toBe('missing')
    render(<CloudCard />)
    expect(await screen.findByRole('status')).toHaveTextContent(t('cloud.unconfigured'))
    expect(screen.getByText(t('cloud.sync.off'))).toBeInTheDocument()
    expect(screen.queryByLabelText(t('cloud.email'))).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('cloud.sendCode') })).not.toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
