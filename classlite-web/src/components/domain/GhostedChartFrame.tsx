/**
 * GhostedChartFrame — the companion ghosted chart placeholder for the two
 * data-surface empty states (Story 10.3 AC2; s57 My Performance + s61 Analytics).
 * Today those two surfaces render DIFFERENTLY (s57 a one-line dashed banner, s61 a
 * 📊 emoji box); this is NET-NEW shared UI (NOT a DRY extraction — labelled
 * honestly) justified only because the two data surfaces SHOULD look alike.
 *
 * Consumers drop it into an `EmptyState` (`tone='guided'`) `children` slot. It is
 * presentation-pure: no data, no role, no `t()`. The decorative frame and its
 * em-dash (`—`) placeholders live inside an `aria-hidden` subtree, so the empty
 * region's accessible name comes ONLY from the surrounding `EmptyState` copy
 * (never "dash dash dash"). Static fill — no pulse — so there is nothing for
 * `motion-reduce` to disable.
 */
import type { ReactElement } from 'react'

/** Four ghosted bars of varying height — a minimal chart silhouette. */
const BAR_HEIGHTS = ['h-10', 'h-16', 'h-12', 'h-20'] as const

export interface GhostedChartFrameProps {
  'data-testid'?: string
}

/**
 * GhostedChartFrame renders a minimal, reduced-opacity chart-shaped frame for a
 * ghosted data surface. Purely decorative — see the module docstring; the
 * accessible name must come from the surrounding EmptyState.
 */
export function GhostedChartFrame({
  'data-testid': dataTestId,
}: GhostedChartFrameProps): ReactElement {
  return (
    <div
      aria-hidden="true"
      data-testid={dataTestId}
      className="flex w-full max-w-md flex-col gap-3 rounded-xl border border-dashed border-[color:var(--cl-line-soft)] bg-[color:var(--cl-surface)] p-5 opacity-60"
    >
      <div className="flex h-28 items-end justify-around gap-3">
        {BAR_HEIGHTS.map((height, index) => (
          <div
            key={index}
            className={`w-8 rounded-t bg-muted/60 ${height}`}
          />
        ))}
      </div>
      <div className="flex items-center justify-around text-sm text-[color:var(--cl-muted)]">
        <span>—</span>
        <span>—</span>
        <span>—</span>
        <span>—</span>
      </div>
    </div>
  )
}
