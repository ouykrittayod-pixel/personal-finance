import { Camera, FileUp, Images } from 'lucide-react'
import { useId, useRef, useState, type ChangeEvent } from 'react'
import { SecondaryButton } from '@/components/actions/buttons'
import { AttachmentPreview } from '@/components/data/AttachmentPreview'
import type { NewAttachment } from '@/db/repositories'
import { t } from '@/lib/i18n'
import { AttachmentFileError, MAX_ATTACHMENTS, prepareAttachment } from './prepare-attachment'

export interface PendingAttachment extends NewAttachment {
  /** Local key for the list (not persisted). */
  key: string
}

export interface AttachmentPickerProps {
  value: readonly PendingAttachment[]
  onChange: (next: PendingAttachment[]) => void
  disabled?: boolean
}

/**
 * Camera (phones), gallery (multiple images) and file picker (images + PDF).
 * Files stay in memory until the expense is saved.
 */
export function AttachmentPicker({ value, onChange, disabled = false }: AttachmentPickerProps) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const errorId = useId()

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])]
    event.target.value = '' // allow picking the same file again
    if (files.length === 0) return
    setError(null)

    const room = MAX_ATTACHMENTS - value.length
    if (files.length > room) setError(t('attachment.error.tooMany', { max: MAX_ATTACHMENTS }))

    setBusy(true)
    const added: PendingAttachment[] = []
    for (const file of files.slice(0, Math.max(0, room))) {
      try {
        added.push({ ...(await prepareAttachment(file)), key: crypto.randomUUID() })
      } catch (cause) {
        const problem = cause instanceof AttachmentFileError ? cause.problem : 'read'
        setError(t(`attachment.error.${problem}`, { name: file.name }))
      }
    }
    setBusy(false)
    if (added.length > 0) onChange([...value, ...added])
  }

  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={error ? errorId : undefined}>
      <legend className="mb-1.5 text-sm font-medium">{t('attachment.title')}</legend>
      <div className="flex flex-wrap gap-2">
        <SecondaryButton type="button" disabled={disabled || busy} onClick={() => cameraRef.current?.click()}>
          <Camera aria-hidden="true" />
          {t('attachment.camera')}
        </SecondaryButton>
        <SecondaryButton type="button" disabled={disabled || busy} onClick={() => galleryRef.current?.click()}>
          <Images aria-hidden="true" />
          {t('attachment.gallery')}
        </SecondaryButton>
        <SecondaryButton type="button" disabled={disabled || busy} onClick={() => fileRef.current?.click()}>
          <FileUp aria-hidden="true" />
          {t('attachment.file')}
        </SecondaryButton>
      </div>
      {/* capture opens the camera directly on supporting phones; elsewhere it behaves like a file picker. */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={handleFiles} data-testid="attachment-camera" />
      <input ref={galleryRef} type="file" accept="image/*" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={handleFiles} data-testid="attachment-gallery" />
      <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={handleFiles} data-testid="attachment-file" />

      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      {value.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {value.map((item) => (
            <li key={item.key}>
              <AttachmentPreview
                fileName={item.fileName}
                mimeType={item.mimeType}
                sizeBytes={item.blob.size}
                blob={item.blob}
                onRemove={disabled ? undefined : () => onChange(value.filter((other) => other.key !== item.key))}
              />
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  )
}
