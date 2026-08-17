/**
 * AssignmentRow — one row of the student assignments list (Story 5.2c,
 * AC2/AC4/AC5). Renders the exercise title, a skill badge, the i18n-formatted
 * deadline, a status badge, a non-blocking overdue marker, and the primary CTA.
 *
 * The CTA composes the pure row-model (`rowStatus` × `attemptRouteForSkill`):
 *   - `graded` → badge only, NO action (the result view is Story 5.5, deferred).
 *   - skill whose attempt UI is not built yet (route `null`) → disabled
 *     "Available soon" (D2), NEVER a 404 link.
 *   - otherwise → a link into the attempt route (Start / Continue / read-only View).
 *
 * The CTA carries a title-interpolated aria-label so a screen reader announces
 * WHICH assignment the action targets (AC7) — the title is a raw value fed
 * through i18next interpolation, never string-concatenated (UX-2).
 */
import { type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  attemptRouteForSkill,
  isOverdue,
  reviewCtaForRow,
  rowStatus,
  type RowCta,
} from './lib/assignmentRow'
import { formatAssignmentDate } from './lib/formatAssignmentDate'
import type { StudentAssignmentListItem } from './api/useStudentAssignments'

/** i18n label + aria templates per CTA kind. `none` renders no action. */
const CTA_KEYS: Record<
  Exclude<RowCta, 'none'>,
  { labelKey: string; ariaKey: string }
> = {
  start: { labelKey: 'assignments.cta.start', ariaKey: 'assignments.cta.startFor' },
  continue: {
    labelKey: 'assignments.cta.continue',
    ariaKey: 'assignments.cta.continueFor',
  },
  view: { labelKey: 'assignments.cta.view', ariaKey: 'assignments.cta.viewFor' },
}

const STATUS_BADGE_CLASS: Record<string, string> = {
  'assignments.status.notStarted': 'bg-slate-100 text-slate-600',
  'assignments.status.inProgress': 'bg-blue-100 text-blue-700',
  'assignments.status.submitted': 'bg-indigo-100 text-indigo-700',
  'assignments.status.graded': 'bg-emerald-100 text-emerald-700',
}

export function AssignmentRow({
  row,
  serverTime,
}: {
  row: StudentAssignmentListItem
  serverTime: string
}): ReactElement {
  const { t, i18n } = useTranslation()

  const route = attemptRouteForSkill(row.exerciseSkill, row.id)
  const { statusKey, cta } = rowStatus(row.submissionStatus)
  const overdue = isOverdue(row.deadlineAt, row.submissionStatus, serverTime)
  // Story 5.5a AC13 — a terminal row also offers a "Review submission" entry-point
  // into the pre-grade read-back (`/assignments/{id}/submission`).
  const reviewCta = reviewCtaForRow(row.submissionStatus, row.id)

  return (
    <li
      className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 px-4 py-3"
      data-testid={`assignment-row-${row.id}`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-slate-900" data-testid={`assignment-title-${row.id}`}>
          {row.exerciseTitle}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
            {t(`assignments.skill.${row.exerciseSkill}`)}
          </span>
          <span data-testid={`assignment-deadline-${row.id}`}>
            {t('assignments.deadlineLabel', {
              date: formatAssignmentDate(row.deadlineAt, i18n.language),
            })}
          </span>
          {overdue ? (
            <span
              className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700"
              data-testid={`assignment-overdue-${row.id}`}
            >
              {row.latePenalty > 0
                ? t('assignments.overdue.penalty', { penalty: row.latePenalty })
                : t('assignments.overdue.marker')}
            </span>
          ) : null}
        </div>
      </div>

      <span
        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
          STATUS_BADGE_CLASS[statusKey] ?? 'bg-slate-100 text-slate-600'
        }`}
        data-testid={`assignment-status-${row.id}`}
      >
        {t(statusKey)}
      </span>

      {cta === 'none' ? null : route === null ? (
        <Button
          size="sm"
          variant="outline"
          disabled
          aria-label={t('assignments.cta.availableSoonFor', { title: row.exerciseTitle })}
          data-testid={`assignment-cta-${row.id}`}
        >
          {t('assignments.cta.availableSoon')}
        </Button>
      ) : (
        <Link
          to={route}
          aria-label={t(CTA_KEYS[cta].ariaKey, { title: row.exerciseTitle })}
          className={buttonVariants({
            size: 'sm',
            variant: cta === 'view' ? 'outline' : 'default',
          })}
          data-testid={`assignment-cta-${row.id}`}
        >
          {t(CTA_KEYS[cta].labelKey)}
        </Link>
      )}

      {reviewCta ? (
        <Link
          to={reviewCta.to}
          aria-label={t('assignments.cta.reviewSubmissionFor', { title: row.exerciseTitle })}
          className={buttonVariants({ size: 'sm', variant: 'outline' })}
          data-testid={`assignment-review-cta-${row.id}`}
        >
          {t(reviewCta.label)}
        </Link>
      ) : null}
    </li>
  )
}
