/**
 * FirstAIGradeCard — Story 2-4 AC7, upgraded to the UX-DR21 live-first-run FEEL by
 * Story 6.2b (T6, FD8 / FU-2-4-F).
 *
 * A "Try AI grading" CTA plays an animated ~15–30s progress ("AI đang phân tích bài
 * viết…") and then reveals the existing `sampleAIGrade` fixture result with a subtle
 * transition — NO celebratory modal, and `prefers-reduced-motion` is respected
 * (S-INFO-16): under reduced motion the reveal is instant (no analysing phase, no
 * animated bar).
 *
 * SIMULATED (RATIFIED, Ducdo 2026-08-20): the run is purely client-side over the
 * local fixture — it does NOT call `useAiGradeJob` / the enqueue endpoint, seeds no
 * fake submission, and burns NO credit. The real endpoint needs a real
 * teacher-of-class Writing `submissionId`; a dashboard demo must not fabricate one.
 * Real AI grading is experienced in the s23 grading view on real submissions.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { sampleAIGrade } from '@/features/dashboard/lib/sampleAIGrade'

// Band-ring geometry — radius 42, circumference = 2π·r ≈ 263.9. Rounded
// to 264 so the SVG dasharray/offset math stays integer-friendly.
const BAND_RING_CIRCUMFERENCE = 264
const BAND_SCORE_MAX = 9
/** The simulated analysis duration (within the ~15–30s UX-DR21 window). */
const SIMULATED_ANALYSIS_MS = 18_000

type RunPhase = 'idle' | 'analyzing' | 'revealed'

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

export default function FirstAIGradeCard() {
  const { t } = useTranslation()
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [phase, setPhase] = useState<RunPhase>('idle')

  // The simulated run's reveal timer — a client-side animation, NOT a fetch (a
  // permitted useEffect, FW-4). Cleans up on unmount / re-run so nothing leaks.
  useEffect(() => {
    if (phase !== 'analyzing') return
    const timer = setTimeout(() => setPhase('revealed'), SIMULATED_ANALYSIS_MS)
    return () => clearTimeout(timer)
  }, [phase])

  // Reduced motion → skip the animated analysing phase entirely (instant reveal).
  const run = () => setPhase(reducedMotion ? 'revealed' : 'analyzing')

  return (
    <section
      data-testid="dashboard-first-ai-grade-card"
      className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <header className="flex items-center gap-3">
        <h2 className="font-[var(--cl-font-display)] text-2xl italic text-[var(--cl-ink)]">
          {t('dashboard.aiSample.title')}
        </h2>
        {/* TODO(FU-2-4-C): promote to canonical <AiMark> chip. */}
        <span
          className="ai-mark inline-flex items-center rounded-full bg-gradient-to-r from-fuchsia-500 to-indigo-500 px-2 py-0.5 text-xs font-medium text-white"
          aria-label={t('dashboard.aiSample.aiMarkLabel')}
        >
          {t('dashboard.aiSample.aiMarkLabel')}
        </span>
      </header>

      <blockquote className="mt-5 line-clamp-3 border-l-4 border-slate-200 pl-4 text-sm italic text-slate-700">
        {t('dashboard.aiSample.essayExcerpt')}
      </blockquote>

      {phase === 'idle' ? (
        <div className="mt-6">
          <Button type="button" data-testid="ai-sample-run" onClick={run}>
            {t('dashboard.aiSample.tryCta')}
          </Button>
        </div>
      ) : null}

      {phase === 'analyzing' ? <AnalyzingProgress /> : null}

      {phase === 'revealed' ? <GradeReveal onRunAgain={() => setPhase('idle')} /> : null}
    </section>
  )
}

/** The simulated "AI is analysing…" progress state (animated bar respects reduced motion). */
function AnalyzingProgress() {
  const { t } = useTranslation()
  return (
    <div className="mt-6 flex flex-col gap-3" data-testid="ai-sample-analyzing">
      <p role="status" aria-live="polite" className="text-sm font-medium text-slate-700">
        {t('dashboard.aiSample.analyzing')}
      </p>
      <div
        role="progressbar"
        aria-label={t('dashboard.aiSample.progressLabel')}
        className="h-2 w-full overflow-hidden rounded-full bg-slate-100"
      >
        {/* Indeterminate animated fill — motion-safe so reduced-motion users get a
            static bar (the reveal is instant for them anyway). */}
        <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-fuchsia-500 to-indigo-500 motion-safe:animate-pulse" />
      </div>
    </div>
  )
}

/** The revealed fixture grade — the band ring + per-criterion breakdown + feedback. */
function GradeReveal({ onRunAgain }: { onRunAgain: () => void }) {
  const { t } = useTranslation()
  // Overall band → circumferential offset so the ring visually reflects the fixture.
  const bandFraction = clampPercent((sampleAIGrade.overallBand / BAND_SCORE_MAX) * 100) / 100
  const bandDashOffset = BAND_RING_CIRCUMFERENCE * (1 - bandFraction)

  return (
    <div data-testid="ai-sample-revealed" className="motion-safe:animate-in motion-safe:fade-in">
      <div className="mt-6 flex flex-wrap items-center gap-6">
        <div className="flex flex-col items-center">
          <svg
            role="img"
            aria-labelledby="ai-band-title ai-band-value"
            className="h-24 w-24"
            viewBox="0 0 100 100"
          >
            <circle cx="50" cy="50" r="42" fill="none" stroke="var(--cl-line-soft)" strokeWidth="8" />
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke="var(--cl-ink)"
              strokeWidth="8"
              strokeDasharray={BAND_RING_CIRCUMFERENCE}
              strokeDashoffset={bandDashOffset}
              transform="rotate(-90 50 50)"
            />
            <text
              id="ai-band-value"
              x="50"
              y="55"
              textAnchor="middle"
              className="fill-slate-900 text-xl font-semibold"
            >
              {sampleAIGrade.overallBand.toFixed(1)}
            </text>
          </svg>
          <p
            id="ai-band-title"
            className="mt-2 text-xs font-medium uppercase tracking-wide text-slate-500"
          >
            {t('dashboard.aiSample.bandLabel')}
          </p>
        </div>

        <ul className="flex-1 space-y-2">
          {sampleAIGrade.criteria.map((c) => (
            <li key={c.key} className="flex items-center gap-3">
              <span className="w-32 shrink-0 text-xs font-medium text-slate-600">{c.label}</span>
              <div
                className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={BAND_SCORE_MAX}
                aria-valuenow={c.band}
                aria-label={t('dashboard.aiSample.criterionAriaLabel', {
                  label: c.label,
                  band: c.band.toFixed(1),
                })}
              >
                <div
                  className="h-full bg-slate-900"
                  style={{ width: `${clampPercent((c.band / BAND_SCORE_MAX) * 100)}%` }}
                />
              </div>
              <span className="w-10 text-right text-sm font-semibold text-slate-900">
                {c.band.toFixed(1)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-6 border-l-4 border-emerald-200 pl-4 text-sm text-slate-700">
        {t('dashboard.aiSample.feedbackQuote')}
      </p>

      <footer className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4">
        <p className="text-xs text-slate-500">{t('dashboard.aiSample.disclaimer')}</p>
        <Button type="button" size="sm" variant="ghost" data-testid="ai-sample-run-again" onClick={onRunAgain}>
          {t('dashboard.aiSample.runAgain')}
        </Button>
      </footer>
    </div>
  )
}
