/**
 * AvatarField — Story 9.4 (AC5) avatar upload control.
 *
 * Client pre-checks size/type and rejects in-language instantly; on a valid
 * pick it uploads to R2 (presign → direct PUT, with 0..1 progress + cancel),
 * then hands the returned object KEY up to the parent (AccountSection), which
 * merges it into the full-snapshot PUT on Save (persistence is a SEPARATE step
 * from transfer — AC5). The fallback (no avatar) is gradient initials derived
 * from the live `name`, so it updates as the name field edits.
 *
 * When `disabled` (a no-center / membership-limbo caller — D11), the control is
 * inert with a bilingual note; the rest of the page keeps working.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  AvatarValidationError,
  uploadAvatarFile,
} from '../api/uploadAvatar'

interface AvatarFieldProps {
  currentAvatarUrl: string | null
  /** The pending (newly-uploaded, not-yet-saved) avatar URL preview, if any. */
  pendingPreviewUrl: string | null
  name: string
  disabled?: boolean
  onUploaded: (key: string, previewUrl: string) => void
}

function initialsOf(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => Array.from(p)[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return parts.length > 0 ? parts : '?'
}

export function AvatarField({
  currentAvatarUrl,
  pendingPreviewUrl,
  name,
  disabled,
  onUploaded,
}: AvatarFieldProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<'idle' | 'uploading'>('idle')
  const [progress, setProgress] = useState(0)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // The object URLs we mint here (review patch P6): revoke the prior one on each
  // new pick and on unmount so repeated picks don't leak blobs.
  const objectUrlRef = useRef<string | null>(null)

  // Abort any in-flight upload + release the last object URL on unmount so a
  // late XHR callback never setState()s an unmounted component (review patch P6).
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    }
  }, [])

  const shownUrl = pendingPreviewUrl ?? currentAvatarUrl
  const safeUrl = shownUrl?.trim() ? shownUrl : null

  const handlePick = async (file: File | undefined) => {
    if (!file) return
    setErrorKey(null)
    const controller = new AbortController()
    abortRef.current = controller
    setStatus('uploading')
    setProgress(0)
    try {
      const key = await uploadAvatarFile(
        file,
        (fraction) => setProgress(fraction),
        controller.signal,
      )
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
      const previewUrl = URL.createObjectURL(file)
      objectUrlRef.current = previewUrl
      onUploaded(key, previewUrl)
      setStatus('idle')
    } catch (err) {
      setStatus('idle')
      if (err instanceof AvatarValidationError) {
        setErrorKey(
          err.code === 'tooLarge'
            ? 'profile.avatar.errors.tooLarge'
            : 'profile.avatar.errors.wrongType',
        )
      } else if ((err as Error)?.name === 'AvatarTransferError') {
        setErrorKey('profile.avatar.errors.transfer')
      } else {
        setErrorKey('profile.avatar.errors.transfer')
      }
    } finally {
      abortRef.current = null
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const handleCancel = () => {
    abortRef.current?.abort()
  }

  return (
    <div className="flex items-center gap-4" data-testid="profile-avatar-field">
      <Avatar size="lg" className="ring-2 ring-[var(--cl-line)]">
        {safeUrl ? <AvatarImage src={safeUrl} alt="" /> : null}
        <AvatarFallback className="bg-[var(--cl-accent)] text-[var(--cl-surface)]">
          {initialsOf(name)}
        </AvatarFallback>
      </Avatar>

      <div className="flex flex-col gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          data-testid="profile-avatar-input"
          aria-label={t('profile.avatar.pick')}
          disabled={disabled || status === 'uploading'}
          onChange={(event) => void handlePick(event.target.files?.[0])}
        />
        {disabled ? (
          <p
            className="text-xs text-[var(--cl-ink-soft)]"
            data-testid="profile-avatar-disabled-note"
          >
            {t('profile.avatar.disabledNote')}
          </p>
        ) : status === 'uploading' ? (
          <div className="flex items-center gap-2" data-testid="profile-avatar-progress">
            <span className="text-sm text-[var(--cl-ink-soft)]">
              {t('profile.avatar.uploading', {
                percent: Math.round(progress * 100),
              })}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              data-testid="profile-avatar-cancel"
            >
              {t('profile.avatar.cancel')}
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            data-testid="profile-avatar-change"
          >
            {t('profile.avatar.change')}
          </Button>
        )}
        {errorKey && (
          <p
            role="alert"
            className="text-xs text-destructive"
            data-testid="profile-avatar-error"
          >
            {t(errorKey)}
          </p>
        )}
      </div>
    </div>
  )
}
