/**
 * OverviewTab — Story 3.2 (AC2/AC4). Renders the real, shipped class metadata
 * as a finished page — the primary surface of the detail shell.
 *
 * Reuses the SAME `useClass(id)` hook the layout warmed (byte-identical
 * `classesKeys.detail(id)` key ⇒ shared cache, NO second fetch). The layout
 * owns the Loading/Not-found/Error trilogy and resolves it before this tab
 * mounts (AC6), so a missing `data` here can only be a transient race — render
 * nothing rather than a second trilogy.
 *
 * Deliberately does NOT render the epic-AC "next upcoming session" or "quick
 * analytics" widgets (AC2) — they have no data source this story and would make
 * the primary page read under-construction. They return with their data in
 * Story 3.4 / 3.5 / Epic 7 / Epic 8. Dates render via the i18n formatter
 * (TS-6). The right-rail dashed Actions card's "Save as template" affordance is
 * dormant/absent (templates CRUD is Story 3.3).
 */
import { type ReactElement, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import i18n from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { useClass } from '../api/useClass'
import { ClassStatusPill } from '../components/ClassStatusPill'
import { formatClassDate, formatClassDateRange } from '../lib/formatClassDate'

export default function OverviewTab(): ReactElement | null {
  const { t } = useTranslation()
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: cls } = useClass(id)

  if (!cls) return null

  // Story 3.3 — Save as template: prefill the create form with the class's
  // scalars ONLY. A class has no materialized sessions until Story 3.4, so the
  // template captures scalars, not a session plan (limitation surfaced on-screen).
  function handleSaveAsTemplate(): void {
    if (!cls) return
    navigate('/classes/templates/new', {
      state: {
        prefill: {
          name: cls.name,
          targetBand: cls.targetBand ?? undefined,
          primarySkill: cls.primarySkill ?? undefined,
          color: cls.color ?? undefined,
          savedAsTemplate: true,
        },
      },
    })
  }

  const schedule = formatClassDateRange(cls.startDate, cls.endDate, i18n.language)
  // The wire carries `teacherId` + `pendingTeacherEmail` only — the resolved
  // teacher's display name lands in Epic 7 (People). So we render the three
  // states this shell can honestly show: a pending invite (email); a neutral
  // "Assigned" when a teacher is accepted (`teacherId` set) but we have no name
  // source yet; else "Unassigned". Rendering "Unassigned" for an assigned class
  // would be affirmatively wrong (CR-review P4).
  const teacher = cls.pendingTeacherEmail
    ? t('classes.detail.overview.teacherPending', {
        email: cls.pendingTeacherEmail,
      })
    : cls.teacherId
      ? t('classes.detail.overview.teacherAssigned')
      : t('classes.detail.overview.teacherUnassigned')
  // `createdAt` is non-null on the wire, but guard the sole unguarded deref so
  // contract drift (absent/empty) cannot throw and blank the whole page — there
  // is no tab-level error boundary (CR-review P2).
  const createdDisplay = cls.createdAt
    ? formatClassDate(cls.createdAt.slice(0, 10), i18n.language)
    : t('classes.detail.overview.notSet')

  return (
    <div
      className="flex flex-col gap-6 lg:flex-row"
      data-testid="class-tab-overview"
    >
      <div className="min-w-0 flex-1">
        <section className="rounded-lg border border-slate-200 p-5">
          <h2 className="mb-4 font-fraunces text-lg text-slate-900">
            {t('classes.detail.overview.sectionHeading')}
          </h2>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            <Field label={t('classes.detail.overview.fields.status')}>
              <ClassStatusPill status={cls.status} />
            </Field>
            <Field label={t('classes.detail.overview.fields.teacher')}>
              {teacher}
            </Field>
            <Field label={t('classes.detail.overview.fields.schedule')}>
              {schedule ?? t('classes.detail.overview.notSet')}
            </Field>
            <Field label={t('classes.detail.overview.fields.targetBand')}>
              {cls.targetBand != null
                ? cls.targetBand.toFixed(1)
                : t('classes.detail.overview.notSet')}
            </Field>
            <Field label={t('classes.detail.overview.fields.primarySkill')}>
              {cls.primarySkill
                ? t(`classes.skill.${cls.primarySkill}`)
                : t('classes.detail.overview.notSet')}
            </Field>
            <Field label={t('classes.detail.overview.fields.sessionCount')}>
              {cls.sessionCount != null
                ? String(cls.sessionCount)
                : t('classes.detail.overview.notSet')}
            </Field>
            <Field label={t('classes.detail.overview.fields.capacity')}>
              {cls.capacity != null
                ? String(cls.capacity)
                : t('classes.detail.overview.notSet')}
            </Field>
            <Field label={t('classes.detail.overview.fields.dueDates')}>
              {cls.dueDatesEnabled
                ? t('classes.detail.overview.dueDates.on')
                : t('classes.detail.overview.dueDates.off')}
            </Field>
            <Field
              label={t('classes.detail.overview.fields.description')}
              className="sm:col-span-2"
            >
              {cls.description?.trim()
                ? cls.description
                : t('classes.detail.overview.notSet')}
            </Field>
          </dl>
        </section>
      </div>

      {/* Right rail (detail-side, ~300px) — info card + dashed Actions card. */}
      <aside
        className="w-full shrink-0 space-y-4 lg:w-[300px]"
        data-testid="class-detail-side"
      >
        <section className="rounded-lg border border-slate-200 p-4">
          <h3 className="mb-2 text-sm font-medium text-slate-900">
            {t('classes.detail.info.heading')}
          </h3>
          <p className="text-xs text-slate-500">
            {t('classes.detail.info.created', {
              date: createdDisplay,
            })}
          </p>
        </section>
        <section
          className="rounded-lg border border-slate-200 p-4"
          data-testid="class-detail-actions-card"
        >
          <h3 className="mb-2 text-sm font-medium text-slate-900">
            {t('classes.detail.actions.heading')}
          </h3>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={handleSaveAsTemplate}
            data-testid="class-save-as-template"
          >
            {t('classes.detail.actions.saveAsTemplate')}
          </Button>
          <p className="mt-2 text-xs text-slate-400">
            {t('classes.detail.actions.saveAsTemplateHint')}
          </p>
        </section>
      </aside>
    </div>
  )
}

function Field({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}): ReactElement {
  return (
    <div className={className}>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 text-sm text-slate-700">{children}</dd>
    </div>
  )
}
