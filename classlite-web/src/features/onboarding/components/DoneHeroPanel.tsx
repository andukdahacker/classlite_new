/**
 * DoneHeroPanel — Story 2-3c AC1, Task 2.2. Pure display component (canonical
 * debut per component-inventory line 74).
 *
 * Renders the terminal `/setup/done` celebration hero: SVG check + Fraunces
 * italic headline focusable on mount (`tabIndex={-1}` — a `useEffect` calls
 * `.focus()` so screen readers announce the heading via the natural
 * focus-change side-effect per S-B2), a semantic `<dl>` stat strip with
 * per-tile `<dt>` label + `<dd>` value (SR reads "Classes ready: 3"
 * naturally — no parent aria-label needed, R1-C1-P19), and a primary
 * `<button>` CTA (client-side navigate — never `<a>`).
 *
 * NO business logic here. All derivation (spawnedClassIds count, teacher
 * self-exclusion, shortCode composition) lives in `OnboardingDonePage`; this
 * component receives fully-materialized primitives (per A-S2).
 */
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

export type DoneHeroPersona = 'operator' | 'founder' | 'solo_teacher'

export interface DoneHeroPanelProps {
  centerName: string
  shortCode: string
  persona: DoneHeroPersona
  classCount: number
  teachersInvitedCount: number
  onOpenDashboard: () => void
}

// R1-C1-P18: literal map so i18n resource-typing catches missing persona keys
// at compile time. A future persona added to `DoneHeroPersona` fails the
// `satisfies` check unless the corresponding key is added here.
const SUBTITLE_KEYS = {
  operator: 'onboarding.done.subtitle.operator',
  founder: 'onboarding.done.subtitle.founder',
  solo_teacher: 'onboarding.done.subtitle.solo_teacher',
} as const satisfies Record<DoneHeroPersona, string>

// S-S1 Vietnamese overflow discipline: min-w-0 + break-words on the headline;
// responsive step-down text-3xl → md:text-4xl → lg:text-5xl. R1-C1-P6:
// `focus:outline-none` → `focus-visible:*` so keyboard-focus indicators
// remain visible (mouse focus stays clean).
const HEADING_CLASS =
  'min-w-0 break-words font-serif italic tracking-tight text-slate-900 text-3xl md:text-4xl lg:text-5xl focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500'

export default function DoneHeroPanel({
  centerName,
  shortCode,
  persona,
  classCount,
  teachersInvitedCount,
  onOpenDashboard,
}: DoneHeroPanelProps) {
  const { t } = useTranslation()
  const subdomainValue = `${shortCode}.classlite.app`

  // R1-C1-P5: focus-on-mount via useEffect (per AC11 "useEffect on mount").
  // Ref callback fires on every remount; useEffect with empty deps fires
  // exactly once when this component mounts.
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <section className="mx-auto max-w-2xl px-4 py-16 text-center">
      <div className="flex justify-center">
        <svg
          aria-hidden="true"
          viewBox="0 0 64 64"
          className="h-16 w-16 text-emerald-600"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle
            cx="32"
            cy="32"
            r="28"
            className="text-emerald-100"
            fill="currentColor"
            stroke="none"
          />
          <path d="M18 33 L28 43 L46 23" />
        </svg>
      </div>

      <h1
        ref={headingRef}
        tabIndex={-1}
        className={`mt-6 ${HEADING_CLASS}`}
      >
        {t('onboarding.done.title', { centerName })}
      </h1>

      <p className="mt-4 text-slate-600">{t(SUBTITLE_KEYS[persona])}</p>

      {/* Semantic <dl>: <dt> = label, <dd> = value. SR reads "Classes ready: 3"
          naturally — no parent aria-label needed (R1-C1-P19 dropped it to
          prevent double-announce). R1-C1-P7 dropped `stripCountPrefix`
          regex — dedicated `*Label` keys carry the bare label instead. */}
      <dl className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div
          data-testid="stat-tile-classes"
          className="rounded-lg border border-slate-200 bg-white p-4"
        >
          <dt className="text-xs uppercase tracking-wide text-slate-500">
            {t('onboarding.done.stat.classesReadyLabel')}
          </dt>
          <dd className="mt-1 text-2xl font-semibold text-slate-900">
            {classCount}
          </dd>
        </div>

        <div
          data-testid="stat-tile-teachers"
          className="rounded-lg border border-slate-200 bg-white p-4"
        >
          <dt className="text-xs uppercase tracking-wide text-slate-500">
            {t('onboarding.done.stat.teachersInvitedLabel')}
          </dt>
          <dd className="mt-1 text-2xl font-semibold text-slate-900">
            {teachersInvitedCount}
          </dd>
        </div>

        <div
          data-testid="stat-tile-subdomain"
          className="rounded-lg border border-slate-200 bg-white p-4"
        >
          <dt className="text-xs uppercase tracking-wide text-slate-500">
            {t('onboarding.done.stat.subdomain')}
          </dt>
          <dd className="mt-1 break-all text-sm font-medium text-slate-900">
            {subdomainValue}
          </dd>
        </div>
      </dl>

      <div className="mt-10">
        <button
          type="button"
          onClick={onOpenDashboard}
          className="inline-flex items-center rounded-md bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2"
        >
          {t('onboarding.done.openDashboardCta')}
        </button>
      </div>
    </section>
  )
}
