// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { t } from '@/lib/i18n'
import { ErrorState } from './ErrorState'
import { LoadingState } from './LoadingState'
import { ProgressBar } from './ProgressBar'

describe('ProgressBar', () => {
  it('exposes progress to assistive technology', () => {
    render(<ProgressBar value={62.4} label="งบอาหาร" valueText="ใช้ไป ฿3,120 จาก ฿5,000" />)
    const bar = screen.getByRole('progressbar', { name: 'งบอาหาร' })
    expect(bar).toHaveAttribute('aria-valuenow', '62')
    expect(bar).toHaveAttribute('aria-valuetext', 'ใช้ไป ฿3,120 จาก ฿5,000')
  })

  it('caps the bar at 100% but still reports the real percentage', () => {
    render(<ProgressBar value={112} label="เกินงบ" showValue />)
    const bar = screen.getByRole('progressbar', { name: 'เกินงบ' })
    expect(bar).toHaveAttribute('aria-valuenow', '100')
    expect(bar).toHaveAttribute('aria-valuetext', '112%')
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('100%')
  })
})

describe('LoadingState / ErrorState', () => {
  it('announces loading politely', () => {
    render(<LoadingState variant="list" />)
    expect(screen.getByRole('status')).toHaveTextContent(t('state.loading'))
  })

  it('is an alert with a retry action', async () => {
    const onRetry = vi.fn<() => void>()
    render(<ErrorState onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent(t('state.error.title'))
    await userEvent.click(screen.getByRole('button', { name: t('common.retry') }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
