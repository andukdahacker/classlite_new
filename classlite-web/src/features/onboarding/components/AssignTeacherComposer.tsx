/**
 * AssignTeacherComposer — Story 2-3b Task 4.2 (Sally-B1 + Sally-B4 + Sally-S7
 * folds).
 *
 * Single-panel invite-only teacher composer. Renders inline below the
 * ClassRow's AssignChip. NOT a modal — the ARIA container uses
 * `role="group"` per Sally-B4 (not `role="dialog"` — the composer is
 * non-modal, focus CAN Tab-leak back to the row's delete button by design).
 *
 * Keyboard:
 *   - Focus lands on email input on mount.
 *   - Escape closes without submit; parent handler is expected to return
 *     focus to the AssignChip trigger.
 *   - Enter on invalid email → validation error shows, composer stays open
 *     (Sally-I6 fold).
 *   - Enter on valid email → onAssign fires then onClose.
 *
 * Self-invite belt (Sally-S7): case-insensitive comparison against
 * `currentUserEmail`. Hint copy directs to leave the field empty — NO
 * reference to the absent "Assign existing" tab (grep-confirmed absent).
 */
import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

// R1-C2-P16 — consolidate on `z.email()` to keep the client belt aligned
// with the server-facing `classSpawnSchema.teacherEmail` (both reject the
// same "teacher@localhost" edges). Zod's email validator is more RFC-aware
// than the previous `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`.
const emailSchema = z.email()

export interface AssignTeacherComposerResult {
  email: string
  displayName?: string
}

export interface AssignTeacherComposerProps {
  currentUserEmail: string
  onAssign: (result: AssignTeacherComposerResult) => void
  onClose: () => void
}

export function AssignTeacherComposer(props: AssignTeacherComposerProps) {
  const { t } = useTranslation()
  const { currentUserEmail, onAssign, onClose } = props
  const headingId = useId()
  const emailInputRef = useRef<HTMLInputElement | null>(null)
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [selfInviteHint, setSelfInviteHint] = useState(false)

  useEffect(() => {
    emailInputRef.current?.focus()
  }, [])

  function validate(value: string): string | null {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      return t('onboarding.spawn.error.teacherEmailInvalid')
    }
    if (!emailSchema.safeParse(trimmed).success) {
      return t('onboarding.spawn.error.teacherEmailInvalid')
    }
    return null
  }

  function isSelfInvite(value: string): boolean {
    return value.trim().toLowerCase() === currentUserEmail.toLowerCase()
  }

  function handleSubmit() {
    const validationError = validate(email)
    if (validationError) {
      setError(validationError)
      return
    }
    onAssign({
      email: email.trim(),
      displayName: displayName.trim() || undefined,
    })
    onClose()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-4"
      onKeyDown={handleKeyDown}
    >
      <h3
        id={headingId}
        className="mb-3 text-sm font-medium text-slate-900"
      >
        {t('onboarding.spawn.teacher.composerTitle')}
      </h3>
      <div className="grid gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-slate-700">
            {t('onboarding.spawn.teacher.composerEmailLabel')}
          </span>
          <input
            ref={emailInputRef}
            type="email"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={email}
            onChange={(event) => {
              const next = event.target.value
              setEmail(next)
              if (error) setError(null)
              setSelfInviteHint(next.trim().length > 0 && isSelfInvite(next))
            }}
            onBlur={() => {
              if (email.trim().length > 0 && isSelfInvite(email)) {
                setSelfInviteHint(true)
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                handleSubmit()
              }
            }}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-700">
            {t('onboarding.spawn.teacher.composerNameLabel')}
          </span>
          <input
            type="text"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            onKeyDown={(event) => {
              // R1-C2-P15 — mirror the email input's Enter behavior so
              // Enter-anywhere submits (the composer container is a
              // `<div role="group">`, not a `<form>`, so browser default
              // form-submit does not fire).
              if (event.key === 'Enter') {
                event.preventDefault()
                handleSubmit()
              }
            }}
          />
        </label>
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}
        {selfInviteHint ? (
          <p className="text-sm text-slate-600">
            {t('onboarding.spawn.teacher.selfInviteHintV1')}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
            onClick={onClose}
          >
            {t('onboarding.spawn.teacher.composerCancelCta')}
          </button>
          <button
            type="button"
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
            onClick={handleSubmit}
          >
            {t('onboarding.spawn.teacher.composerAddCta')}
          </button>
        </div>
      </div>
    </div>
  )
}
