import { FileText, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { IconButton } from '@/components/actions/buttons'
import { formatBytes } from '@/lib/formatting'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export interface AttachmentPreviewProps {
  fileName: string
  mimeType: string
  sizeBytes: number
  /** Local binary (from IndexedDB or a file input). An object URL is created and revoked automatically. */
  blob?: Blob
  /** Or an existing URL. */
  src?: string
  onOpen?: () => void
  onRemove?: () => void
  className?: string
}

/**
 * Object URLs are an external resource: create in the effect and revoke in its
 * cleanup (a useMemo URL would be revoked by StrictMode's effect re-run while still in use).
 */
function useObjectUrl(blob: Blob | undefined): string | undefined {
  const [entry, setEntry] = useState<{ blob: Blob; url: string }>()
  useEffect(() => {
    if (!blob) return
    let url: string
    try {
      url = URL.createObjectURL(blob)
    } catch {
      return // No preview possible: the file icon is shown instead.
    }
    // oxlint-disable-next-line react/set-state-in-effect -- publishing an external resource created here
    setEntry({ blob, url })
    return () => URL.revokeObjectURL(url)
  }, [blob])
  // Ignore a stale URL from a previous blob.
  return entry && entry.blob === blob ? entry.url : undefined
}

/** Receipt thumbnail (images) or file icon (PDF/other) with name, size and optional remove. */
export function AttachmentPreview({
  fileName,
  mimeType,
  sizeBytes,
  blob,
  src,
  onOpen,
  onRemove,
  className,
}: AttachmentPreviewProps) {
  const objectUrl = useObjectUrl(blob)
  const url = src ?? objectUrl
  const isImage = mimeType.startsWith('image/')

  const thumbnail = (
    <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted text-muted-foreground">
      {isImage && url ? (
        <img src={url} alt="" className="size-full object-cover" loading="lazy" decoding="async" />
      ) : (
        <FileText className="size-6" aria-hidden="true" />
      )}
    </span>
  )

  const details = (
    <span className="flex min-w-0 flex-1 flex-col text-left">
      <span className="truncate text-sm font-medium">{fileName}</span>
      <span className="text-xs text-muted-foreground">{formatBytes(sizeBytes)}</span>
    </span>
  )

  return (
    <div className={cn('flex items-center gap-3 rounded-lg border p-2', className)}>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={t('attachment.open', { name: fileName })}
          className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-md"
        >
          {thumbnail}
          {details}
        </button>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-3">
          {thumbnail}
          {details}
        </span>
      )}
      {onRemove && <IconButton label={t('attachment.remove', { name: fileName })} icon={<X />} onClick={onRemove} />}
    </div>
  )
}
