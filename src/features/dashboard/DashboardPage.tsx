import { SetupCard } from '@/features/setup'
import { todayISO } from '@/lib/dates'
import { Dashboard } from './Dashboard'

/** Route entry (lazy-loaded): the dashboard for the real current date. */
export function DashboardPage() {
  const today = todayISO()
  return <Dashboard today={today} intro={<SetupCard today={today} />} />
}
