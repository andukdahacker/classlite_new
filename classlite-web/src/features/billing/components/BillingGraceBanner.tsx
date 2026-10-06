/**
 * BillingGraceBanner — the s73 app-wide payment-failure grace strip (Story 9.3, AC11-13; R4).
 *
 * Role-scoped (R4): the OWNER sees the actionable red strip (countdown to the day-7 deadline +
 * "Update payment method" link + the recovery timeline); an ADMIN sees an INFORMATIONAL variant
 * (same problem + deadline, but NO action link — only the owner can fix payment, so an
 * absentee-owner center is not silently downgraded for the admin); teacher/student never fetch
 * the grace source and never see the strip (TEST-FE-6 — absent from the DOM, not merely hidden).
 *
 * Source: the scoped owner+admin `GET /api/billing/grace` (useGrace), gated so non-billing roles
 * never fire it. Non-null only while past_due; a recovery / post-downgrade grace:null clears the
 * strip on the next poll. The deadline renders from `graceEndsAt` via `{{val, vnDateLong}}`
 * (M7 — never a server-baked label, so a vi owner sees a localized date). Red = hard-failure
 * severity (UX §327), mirroring the dashboard error tokens.
 *
 * Mounted into the reserved AppShell.banner slot via AppLayout (every authenticated page). Uses
 * a plain <a> (not a router Link): it renders app-wide, outside any route subtree.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRole } from '@/hooks/useRole'
import { useGrace } from '../api/useGrace'

/** The owner's recovery surface — the billing dashboard, where the re-checkout / card update lives. */
const RECOVERY_SURFACE_URL = '/settings/billing'

/** How often the live countdown re-renders (code-review D8). A minute is plenty for a day/hour
 *  countdown and avoids a per-second timer; the useGrace poll clears the strip on recovery. */
const COUNTDOWN_REFRESH_MS = 60_000
const MS_PER_HOUR = 60 * 60 * 1000
const MS_PER_DAY = 24 * MS_PER_HOUR

export function BillingGraceBanner() {
  const { t } = useTranslation()
  const role = useRole()
  const canSeeGrace = role === 'owner' || role === 'admin'
  const { data: grace } = useGrace(canSeeGrace)

  // Live countdown clock (code-review D8 / AC11). A timer is a permitted useEffect use (not data
  // fetching); the elapsed math is on absolute epoch-ms, so it is timezone-agnostic — the deadline
  // instant is the same whether rendered in UTC or VN-local (the date LABEL is VN-local via
  // vnDateLong). Hooks run unconditionally, before the early return (rules of hooks).
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), COUNTDOWN_REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  // Absent from the DOM for non-billing roles (no fetch fired) and whenever grace is null
  // (not past_due / recovered / downgraded).
  if (!canSeeGrace || !grace) {
    return null
  }

  const isOwner = role === 'owner'
  const remainingMs = Math.max(0, Date.parse(grace.graceEndsAt) - nowMs)
  const countdownDays = Math.floor(remainingMs / MS_PER_DAY)
  const countdownHours = Math.floor((remainingMs % MS_PER_DAY) / MS_PER_HOUR)
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 border-l-4 border-[color:var(--cl-red)] bg-[color:var(--cl-tint-red)] px-4 py-3 text-sm text-[color:var(--cl-red)]"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <strong className="font-semibold">{t('billing.grace.title')}</strong>
        <span>{t('billing.grace.body')}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-medium">{t('billing.grace.deadline', { val: grace.graceEndsAt })}</span>
        <span className="font-semibold" data-testid="grace-countdown">
          {t('billing.grace.countdown', { days: countdownDays, hours: countdownHours })}
        </span>
        {isOwner ? (
          <a href={RECOVERY_SURFACE_URL} className="font-semibold underline">
            {t('billing.grace.updatePayment')}
          </a>
        ) : (
          <span>{t('billing.grace.adminInfo')}</span>
        )}
      </div>
      {/* AC13 — the recovery timeline + the anti-panic "nothing deleted" reassurance. */}
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs opacity-90">
        <li>{t('billing.grace.timeline.declined')}</li>
        <li>{t('billing.grace.timeline.retry')}</li>
        <li>{t('billing.grace.timeline.warning')}</li>
        <li>{t('billing.grace.timeline.downgrade')}</li>
        <li>{t('billing.grace.timeline.safe')}</li>
      </ul>
    </div>
  )
}
