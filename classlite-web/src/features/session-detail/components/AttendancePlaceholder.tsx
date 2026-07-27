/**
 * AttendancePlaceholder — Story 3.5 (AC2). Attendance recording is DEFERRED to
 * Story 3.5b (it needs the per-class enrollment roster). This renders a
 * future-affordance: an AMBER, dashed, non-error treatment (NOT the red/neutral
 * error surface) with teacher-language copy naming the what + why. It is NOT
 * hidden — hiding it would hide the roadmap. No roster / status selectors / bulk
 * actions are built this story.
 *
 * Deferred detail: FU-3-5-A in deferred-work.md (attendance table + roster +
 * Present/Late/Absent + bulk actions → 3.5b, which depends on Story 3.4.5).
 */
import { type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

export function AttendancePlaceholder(): ReactElement {
  const { t } = useTranslation()
  return (
    <section
      data-testid="session-attendance-placeholder"
      className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-amber-300 bg-amber-50 px-6 py-8 text-center"
    >
      <span
        aria-hidden="true"
        className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-500"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M9 11l3 3L22 4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" strokeLinecap="round" />
        </svg>
      </span>
      <h2 className="font-fraunces text-base text-amber-900">{t('session.attendance.title')}</h2>
      <p className="max-w-sm text-sm text-amber-700">{t('session.attendance.comingSoon')}</p>
    </section>
  )
}
