/**
 * DeadLinkTrigger — Story 2-4 AC10/AC11 primitive.
 *
 * A `<button>` that renders like a link but, on click, shows a Sonner toast
 * instead of navigating. Used everywhere the dashboard advertises a surface
 * that hasn't shipped yet (Settings, Templates, Classes, People, Students,
 * Knowledge Hub, Grading). When the owning story lands, swap this trigger
 * for a `<button onClick={() => navigate(item.targetPath)}>` — 1-line
 * change per site.
 *
 * Design [S-BLOCKER-2 + W-STRONG-8 + A-BLOCKER-2 3-way convergence]:
 *   - Uses the shipped `<Toaster />` at `App.tsx:74` (`sonner`) instead of
 *     rolling a custom inline toast. FU-2-4-B (shared toast bus) is
 *     DISCHARGED — Sonner already ships.
 *   - Fixed toast id `dashboard-dead-link` acts as a queue-of-one: rage
 *     clicks REPLACE the toast rather than stacking (Sonner semantics),
 *     so N clicks produce N breadcrumbs + 1 visible toast [W-INFO-16].
 *   - `duration: 4000` — auto-dismiss after 4s (Sonner honors this).
 *   - Sentry breadcrumb `dashboard-dead-link-tapped` fires per click with
 *     `{ targetPath, targetSurface, epicNum }` — feature-demand signal.
 *   - Does NOT call `useNavigate` — silence is more credible than an
 *     unfulfilled navigation.
 *
 * NO_TRIAL_MECHANIC_V1 — AC10 belt: the component does not synthesize `/trial` or `/upgrade` routes; consumers supply the `targetPath`.
 */
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { addBreadcrumb } from '@sentry/react'
import { toast } from 'sonner'

const DEAD_LINK_TOAST_ID = 'dashboard-dead-link'
const DEAD_LINK_TOAST_DURATION_MS = 4000

// Default utility classes — always applied. Consumer `className` is
// appended after defaults so callers can tweak color/spacing without
// dropping the a11y-load-bearing `focus-visible:outline-*` styles.
const DEFAULT_TRIGGER_CLASSES =
  'inline-flex items-center gap-1 text-sm font-medium text-slate-900 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500'

export interface DeadLinkTriggerProps {
  targetPath: string
  targetSurface: string
  epicNum: number
  children: ReactNode
  className?: string
}

export default function DeadLinkTrigger({
  targetPath,
  targetSurface,
  epicNum,
  children,
  className,
}: DeadLinkTriggerProps) {
  const { t } = useTranslation()

  const handleClick = (): void => {
    toast.info(t('dashboard.deadLink.notReady', { epicNum }), {
      id: DEAD_LINK_TOAST_ID,
      duration: DEAD_LINK_TOAST_DURATION_MS,
    })
    addBreadcrumb({
      category: 'dashboard',
      message: 'dashboard-dead-link-tapped',
      level: 'info',
      data: { targetPath, targetSurface, epicNum },
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={
        className != null && className.length > 0
          ? `${DEFAULT_TRIGGER_CLASSES} ${className}`
          : DEFAULT_TRIGGER_CLASSES
      }
    >
      {children}
      <span aria-hidden="true">→</span>
    </button>
  )
}
