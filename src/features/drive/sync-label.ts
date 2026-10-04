import { t } from '@/lib/i18n'
import type { DriveState } from './drive-sync'

/** Short status text for the header chip and the Drive card. */
export function syncLabel(state: DriveState): string {
  if (state.status === 'synced' && state.pending > 0) return t('drive.status.pending', { count: state.pending.toLocaleString('th-TH') })
  return t(`drive.status.${state.status}`)
}
