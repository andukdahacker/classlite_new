/**
 * FirstAIGradeCard — Story 2-4 AC7.
 *
 * Static "how a real AI grade will look" preview mounted for the Founder
 * and Solo Teacher personas below the FinishSetupCard. Renders a hardcoded
 * fixture (`sampleAIGrade`) — no wire dependency on Epic 6 (FU-2-4-F
 * picks up the live pipeline).
 *
 * Design notes:
 *   - Title copy uses "Grading looks like this." [S-STRONG-12 voice
 *     unification — the earlier "See ClassLite AI in action" read as
 *     brochure].
 *   - Inline `<span class="ai-mark">` marker per [A-BLOCKER-4 + S-INFO-17]
 *     — the canonical `<AiMark>` chip is FU-2-4-C.
 *   - NO "See how grading works" CTA [S-STRONG-7 — dishonest dead-link];
 *     the card delivers value inline. FU-2-4-F wires the live click-to-run
 *     once Epic 6 ships.
 *   - Band-ring SVG is `role="img"` with `aria-labelledby` pointing at
 *     both the "Sample band" prefix and the value node (AC16 fold).
 *   - Motion: v1 renders static; when FU-2-4-F wires the live pipeline it
 *     MUST respect `prefers-reduced-motion: reduce` [S-INFO-16].
 */
import { useTranslation } from 'react-i18next'
import { sampleAIGrade } from '@/features/dashboard/lib/sampleAIGrade'

// Band-ring geometry — radius 42, circumference = 2π·r ≈ 263.9. Rounded
// to 264 so the SVG dasharray/offset math stays integer-friendly.
const BAND_RING_CIRCUMFERENCE = 264
const BAND_SCORE_MAX = 9

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

export default function FirstAIGradeCard() {
  const { t } = useTranslation()
  // Overall band → circumferential offset so the ring visually reflects
  // the fixture score. Previously hardcoded to 97 (≈63%) — decoupled from
  // the data, so a fixture update to 7.5 would show 63% fill with a "7.5"
  // label mismatch.
  const bandFraction = clampPercent((sampleAIGrade.overallBand / BAND_SCORE_MAX) * 100) / 100
  const bandDashOffset = BAND_RING_CIRCUMFERENCE * (1 - bandFraction)

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

      <div className="mt-6 flex flex-wrap items-center gap-6">
        <div className="flex flex-col items-center">
          <svg
            role="img"
            aria-labelledby="ai-band-title ai-band-value"
            className="h-24 w-24"
            viewBox="0 0 100 100"
          >
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke="var(--cl-line-soft)"
              strokeWidth="8"
            />
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
              <span className="w-32 shrink-0 text-xs font-medium text-slate-600">
                {c.label}
              </span>
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
                  style={{
                    width: `${clampPercent((c.band / BAND_SCORE_MAX) * 100)}%`,
                  }}
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

      <footer className="mt-6 border-t border-slate-100 pt-4">
        <p className="text-xs text-slate-500">
          {t('dashboard.aiSample.disclaimer')}
        </p>
      </footer>
    </section>
  )
}
