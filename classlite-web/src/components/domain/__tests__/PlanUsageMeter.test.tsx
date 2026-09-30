// ATDD RED-PHASE — Story 9-1b, Task 3 (AC21 — the reserved-name meter). Matrix C9 +
// AC8/H defensive guard. Unit-level: the meter renders the server contract verbatim
// (mirrors LoadMeter's server-owned flag; never re-derives thresholds — D22).
//
// RED signal (compile-fail via tsc -b):
//   1. `@/components/domain/PlanUsageMeter` does not exist yet (TS2307).
//
// GREEN-PHASE SEAMS:
//   - components/domain/PlanUsageMeter.tsx is ONE polymorphic component with props
//     { value, max|null, unit, warn, resetAt? }. It HAND-ROLLS the count/bytes bar
//     (a <span role="progressbar">), NOT a wrap of ui/progress.tsx — the unlimited/
//     credits variants + server-driven .warn need presentation the primitive does
//     not express (AC21 deviation recorded in the story, Review-Findings P9).
//   - max===null → count-only render ("Unlimited"), no bar, no aria-valuemax, .warn
//     suppressed regardless of `warn`.
//   - unit:'bytes' formats via lib/formatDataSize (decimal GB/MB — formatBytes emits
//     IEC GiB; TS-7 forbids importing knowledge-hub's formatter into a domain tier).
//   - unit:'credits' → a distinct "N remaining" read-out + resetAt, NO bar (credits
//     report a remaining balance, not consumption — Review-Findings P8).
//   - data-testid="plan-usage-meter-{key}" (set by the consumer via a `testKey` prop or
//     wrapper) and data-warn reflect the server `approaching` boolean.
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
// RED: this module does not exist yet.
import { PlanUsageMeter } from '@/components/domain/PlanUsageMeter'

function renderMeter(ui: React.ReactElement): void {
  render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>)
}

describe('PlanUsageMeter — variant contract (AC21)', () => {
  test('count unit renders "N of M" and a progressbar with the correct aria values', () => {
    renderMeter(<PlanUsageMeter unit="count" value={9} max={10} warn={true} />)
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '9')
    expect(bar).toHaveAttribute('aria-valuemax', '10')
    expect(screen.getByText('9 / 10')).toBeInTheDocument()
  })

  test('warn=true sets the amber state; warn=false clears it', () => {
    const { rerender } = render(
      <I18nextProvider i18n={i18n}><PlanUsageMeter unit="count" value={9} max={10} warn={true} /></I18nextProvider>,
    )
    expect(screen.getByRole('progressbar')).toHaveAttribute('data-warn', 'true')
    rerender(<I18nextProvider i18n={i18n}><PlanUsageMeter unit="count" value={3} max={10} warn={false} /></I18nextProvider>)
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('data-warn', 'true')
  })

  test('max===null → "Unlimited", no bar, no aria-valuemax, .warn SUPPRESSED even if warn=true', () => {
    renderMeter(<PlanUsageMeter unit="count" value={42} max={null} warn={true} />)
    expect(screen.getByText(i18n.t('billing.meter.unlimited'))).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    // defensive: an unlimited meter can never be "approaching".
    const region = screen.getByTestId('plan-usage-meter')
    expect(region).not.toHaveAttribute('data-warn', 'true')
  })

  test('bytes unit formats the value human-readable (not raw bytes)', () => {
    renderMeter(<PlanUsageMeter unit="bytes" value={48000000000} max={53687091200} warn={true} />)
    // ~44.7 GB used of 50 GB — assert a GB-scale string, never the raw integer.
    expect(screen.queryByText('48000000000')).not.toBeInTheDocument()
    expect(screen.getByText(/GB/i)).toBeInTheDocument()
  })

  test('credits unit surfaces a "N remaining" read-out + resetAt, and renders NO bar (P8)', () => {
    renderMeter(
      <PlanUsageMeter unit="credits" value={100} max={2000} warn={false} resetAt="2026-10-01T00:00:00+07:00" />,
    )
    expect(screen.getByText(i18n.t('billing.meter.creditsRemaining', { value: 100 }))).toBeInTheDocument()
    expect(screen.getByText(i18n.t('billing.meter.resetAt', { val: '2026-10-01T00:00:00+07:00' }))).toBeInTheDocument()
    // Negative: credits report a remaining balance, never a fill-toward-max bar
    // (the readout must not render the misleading "100 / 2000" consumption ratio).
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByText('100 / 2000')).not.toBeInTheDocument()
  })

  test('count unit clamps aria-valuenow into [0, max] for an over-limit value (P5)', () => {
    renderMeter(<PlanUsageMeter unit="count" value={25} max={20} warn={true} />)
    const bar = screen.getByRole('progressbar')
    // aria-valuenow must never exceed aria-valuemax (valid ARIA), even over-limit.
    expect(bar).toHaveAttribute('aria-valuenow', '20')
    expect(bar).toHaveAttribute('aria-valuemax', '20')
  })
})
