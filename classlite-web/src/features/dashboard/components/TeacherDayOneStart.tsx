/**
 * TeacherDayOneStart — the s53 teacher first-visit guided start (Story 10.5).
 * An ACTIVATION surface (not an empty state): a 3-step progress funnel that
 * greets a brand-new teacher with zero classes with momentum instead of a dead,
 * empty dashboard. Built on the canonical `EmptyState` (`tone='guided'`,
 * children slot, headline suppressed — the page-head `<h1>` in
 * `RealTeacherDashboard` carries the message, so EmptyState stamps no second
 * headline).
 *
 * The three steps are mock-correct (06b-empty-states.html s53) and logically
 * honest for login-minute-one:
 *   1. Profile set   — DONE (endowed-progress; accepting the invite set up the
 *                      profile). Derived from `profileDone` = Boolean(fullName).
 *   2. Create class  — the ACTIVE card; the single live primary CTA opens the
 *                      shipped create-class dialog (owned by the host).
 *   3. Invite students — LOCKED (disabled CTA) until a class exists.
 *
 * It reuses the FinishSetupCard checklist idiom (done / active / disabled card
 * states) rather than inventing a parallel one. Each state carries a text
 * status badge so the progression is announced by text, never colour alone
 * (AC4 a11y). It renders its own i18n-resolved strings and passes NONE of them
 * into EmptyState's headline (suppressed) — EmptyState itself never calls t().
 */
import type { ReactElement, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/domain/EmptyState'

type DayOneStepState = 'done' | 'todo' | 'active' | 'locked'

export interface TeacherDayOneProps {
  /** Step-1 done state — `Boolean(user.fullName)` (AC3). */
  profileDone: boolean
  /** Opens the shipped create-class dialog (step-2 live CTA). */
  onCreateClass: () => void
}

const GLYPH: Record<DayOneStepState, string> = {
  done: '✓',
  todo: '○',
  active: '→',
  locked: '🔒',
}

function StepCard({
  n,
  state,
  title,
  description,
  cta,
}: {
  n: number
  state: DayOneStepState
  title: string
  description: string
  cta?: ReactNode
}): ReactElement {
  const { t } = useTranslation()
  const border =
    state === 'active'
      ? 'border-[color:var(--cl-accent)] ring-1 ring-[color:var(--cl-accent)]'
      : 'border-[var(--cl-border)]'
  const dim = state === 'locked' ? 'opacity-60' : ''
  const badgeTone =
    state === 'done'
      ? 'bg-emerald-100 text-emerald-700'
      : state === 'active'
        ? 'bg-[color:var(--cl-accent)]/10 text-[color:var(--cl-accent)]'
        : 'bg-muted/60 text-[color:var(--cl-ink-soft)]'

  return (
    <li
      data-testid={`day-one-step-${n}`}
      data-step-state={state}
      className={`flex flex-col gap-3 rounded-2xl border bg-white p-5 text-left ${border} ${dim}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs uppercase tracking-wide text-[color:var(--cl-ink-soft)]">
          {t('dashboard.teacher.dayOne.eyebrow', { n })}
        </span>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${badgeTone}`}
        >
          <span aria-hidden="true">{GLYPH[state]}</span>
          {t(`dashboard.teacher.dayOne.status.${state}` as const)}
        </span>
      </div>
      <p className="font-medium text-[color:var(--cl-ink)]">{title}</p>
      <p className="text-sm text-[color:var(--cl-ink-soft)]">{description}</p>
      {cta ? <div className="mt-auto pt-1">{cta}</div> : null}
    </li>
  )
}

export function TeacherDayOneStart({
  profileDone,
  onCreateClass,
}: TeacherDayOneProps): ReactElement {
  const { t } = useTranslation()
  return (
    <EmptyState tone="guided" data-testid="teacher-day-one">
      <ol className="grid w-full gap-4 text-left md:grid-cols-3">
        <StepCard
          n={1}
          state={profileDone ? 'done' : 'todo'}
          title={t('dashboard.teacher.dayOne.step1.title')}
          description={t('dashboard.teacher.dayOne.step1.description')}
        />
        <StepCard
          n={2}
          state="active"
          title={t('dashboard.teacher.dayOne.step2.title')}
          description={t('dashboard.teacher.dayOne.step2.description')}
          cta={
            <Button data-testid="day-one-create-class-cta" onClick={onCreateClass}>
              {t('dashboard.teacher.dayOne.step2.cta')}
            </Button>
          }
        />
        <StepCard
          n={3}
          state="locked"
          title={t('dashboard.teacher.dayOne.step3.title')}
          description={t('dashboard.teacher.dayOne.step3.description')}
          cta={
            <Button
              data-testid="day-one-invite-cta"
              variant="outline"
              disabled
            >
              {t('dashboard.teacher.dayOne.step3.cta')}
            </Button>
          }
        />
      </ol>
    </EmptyState>
  )
}
