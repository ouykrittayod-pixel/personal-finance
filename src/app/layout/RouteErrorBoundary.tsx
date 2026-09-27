import { isRouteErrorResponse, useRouteError } from 'react-router'
import { ErrorState } from '@/components/feedback/ErrorState'
import { t } from '@/lib/i18n'

/**
 * `inline`: a page failed — shown inside the app shell, so navigation keeps
 * working. Without it: the shell itself failed (full-screen fallback).
 * Only the error message is shown (never a stack trace or record data).
 */
export function RouteErrorBoundary({ inline = false }: { inline?: boolean }) {
  const error = useRouteError()
  const detail = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error instanceof Error ? error.message : String(error)
  console.error('Route error:', detail)

  if (inline) {
    return (
      <div className="flex flex-col gap-section">
        <ErrorState title={t('error.title')} detail={detail} onRetry={() => window.location.reload()} />
      </div>
    )
  }
  return (
    <div className="mx-auto flex min-h-svh max-w-form flex-col justify-center p-page-x">
      <ErrorState title={t('error.title')} detail={detail} onRetry={() => window.location.reload()} />
    </div>
  )
}
