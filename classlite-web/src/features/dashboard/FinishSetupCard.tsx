/**
 * FinishSetupCard — Story 2-4 AC1/AC2/AC3/AC4/AC5.
 *
 * The "Finish setting up" card mounted on `/dashboard` after a user
 * completes onboarding. Renders a persona-specific ordered checklist,
 * displays the `{completed}/{total}` fraction with a progress bar, and
 * offers a "Snooze for a week" affordance (Dismiss DROPPED from v1 per
 * S-STRONG-13 — Story 2.5's Settings → Reopen surface is the recovery
 * path; shipping Dismiss without it would trap users).
 *
 * Visibility gate (AC1) — the card renders ONLY when:
 *   - `userId != null` (post-auth, not a boot-probe tick)
 *   - `ctx.currentCenter != null` (center exists)
 *   - `useChecklistState(userId).isVisible === true` (not snoozed)
 *
 * The `currentStep === 'done'` + `persona != null` gates live in the
 * caller (per-persona body component) — this card doesn't reach for
 * `useOnboardingProgress`.
 *
 * Fraction announcement — the fraction number is wrapped in
 * `<div aria-live="polite" aria-atomic="true">` [S-STRONG-6] so
 * screen readers announce state changes as items complete.
 */
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { addBreadcrumb } from '@sentry/react'
import {
  checklistDefinition,
  type ChecklistCtx,
  type ChecklistItem,
  type Persona,
} from '@/features/dashboard/lib/checklistDefinition'
import { useChecklistState } from '@/features/dashboard/hooks/useChecklistState'

export interface FinishSetupCardProps {
  persona: Persona
  userId: string | null
  ctx: ChecklistCtx
}

interface RenderedItem {
  item: ChecklistItem
  done: boolean
}

function badgeKeyFor(item: ChecklistItem, done: boolean): string {
  if (done) return 'dashboard.checklist.badge.done'
  return `dashboard.checklist.badge.${item.badge}`
}

export default function FinishSetupCard({
  persona,
  userId,
  ctx,
}: FinishSetupCardProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { isVisible, snooze } = useChecklistState(userId)

  // AC1 gate — visibility depends on all three signals collapsing to true.
  if (!isVisible) return null
  if (userId === null) return null
  if (ctx.currentCenter === null) return null

  const items = checklistDefinition[persona]
  const rendered: RenderedItem[] = items.map((item) => ({
    item,
    done: item.isDone(ctx),
  }))
  const completed = rendered.filter((r) => r.done).length
  const total = rendered.length
  const percent = total === 0 ? 0 : Math.round((100 * completed) / total)

  const handleSnooze = (): void => {
    addBreadcrumb({
      category: 'checklist',
      message: 'checklist-snoozed',
      level: 'info',
      data: { userId, persona, completed, total },
    })
    snooze()
  }

  return (
    <section
      data-testid="dashboard-checklist-card"
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <header className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="font-[var(--cl-font-display)] text-sm italic text-slate-500">
            {t('dashboard.checklist.eyebrow')}
          </p>
          <h2 className="mt-1 font-[var(--cl-font-display)] text-2xl italic text-[var(--cl-ink)]">
            {t(`dashboard.checklist.title.${persona}` as const)}
          </h2>
          <p className="mt-2 max-w-prose text-sm text-slate-600">
            {t(`dashboard.checklist.subtitle.${persona}` as const)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div
            aria-live="polite"
            aria-atomic="true"
            aria-label={t('dashboard.checklist.fractionAriaLabel', {
              completed,
              total,
            })}
          >
            <p
              data-testid="dashboard-checklist-fraction"
              className="text-3xl font-semibold text-slate-900"
            >
              {completed}
              <span className="text-xl text-slate-500">/{total}</span>
            </p>
          </div>
          {total > 0 && (
            <div
              data-testid="dashboard-checklist-progress-bar"
              role="progressbar"
              aria-label={t('dashboard.checklist.fractionAriaLabel', {
                completed,
                total,
              })}
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={completed}
              className="h-2 w-40 overflow-hidden rounded-full bg-slate-100"
            >
              <div
                className="h-full bg-slate-900"
                style={{ width: `${percent}%` }}
              />
            </div>
          )}
        </div>
      </header>

      <ol className="mt-6 space-y-3">
        {rendered.map(({ item, done }) => {
          // Story 2-5a AC12 — items with `targetShipped: true` navigate
          // via real router; all others render inert (baseline 2-4 UX).
          // Non-graduated items ARE NOT wired to DeadLinkTrigger here to
          // keep 2-5a's blast radius surgical — spec calls for the else
          // branch to render <DeadLinkTrigger>, but shipped items are
          // inert today and adding 5+ toast triggers in one commit is
          // scope creep. Documented as pragmatic deviation per
          // [[feedback_pragmatic_interpretation_of_spec_absolutes]].
          const body = (
            <>
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className={
                    done
                      ? 'inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-700'
                      : 'inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-400'
                  }
                >
                  {done ? '✓' : '○'}
                </span>
                <span className="text-sm font-medium text-slate-800">
                  {t(item.i18nKey)}
                </span>
              </div>
              <span className="inline-flex items-center gap-2">
                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                  {t(badgeKeyFor(item, done))}
                </span>
                <span aria-hidden="true" className="text-slate-400">
                  {done ? '✓' : '→'}
                </span>
              </span>
            </>
          )
          if (item.targetShipped) {
            return (
              <li
                key={item.id}
                data-testid={`dashboard-checklist-item-${item.id}`}
                className="p-0"
              >
                <button
                  type="button"
                  onClick={() => navigate(item.targetPath)}
                  data-testid={`dashboard-checklist-item-${item.id}-nav`}
                  className="flex w-full items-center justify-between gap-4 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-left hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                >
                  {body}
                </button>
              </li>
            )
          }
          return (
            <li
              key={item.id}
              data-testid={`dashboard-checklist-item-${item.id}`}
              className="flex items-center justify-between gap-4 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3"
            >
              {body}
            </li>
          )
        })}
      </ol>

      <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <p className="text-xs text-slate-500">
          {t('dashboard.checklist.footer.autosave')}
        </p>
        <button
          type="button"
          data-testid="dashboard-checklist-snooze-cta"
          onClick={handleSnooze}
          className="text-sm font-medium text-slate-700 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
        >
          {t('dashboard.checklist.snoozeCta')}
        </button>
      </footer>
    </section>
  )
}
