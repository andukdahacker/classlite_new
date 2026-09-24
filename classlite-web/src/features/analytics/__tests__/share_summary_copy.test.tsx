// Story 8-3b · code-review P3 (AC14a). The share "Copy" control must NOT report
// success when the clipboard write never happened. The prior implementation did
// `void navigator.clipboard?.writeText(); toast.success()` — so a rejected write
// (permission denied) OR a missing Clipboard API (insecure context → optional-chain
// no-op) still fired the "copied" toast and leaked an unhandled rejection. These
// tests would have PASSED against the buggy code's happy path but FAIL its two
// failure paths — the falsifiable proof of the fix.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, test, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { ShareSummaryButton } from '@/features/analytics/components/ShareSummaryButton'
import { myPerformance } from '@/features/analytics/api/__tests__/handlers'

const success = vi.fn()
const error = vi.fn()
vi.mock('sonner', () => ({ toast: { success: (m: string) => success(m), error: (m: string) => error(m) } }))

function renderButton() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ShareSummaryButton perf={myPerformance()} />
    </I18nextProvider>,
  )
}

afterEach(() => {
  success.mockClear()
  error.mockClear()
})

describe('ShareSummaryButton copy — failure paths do NOT report success (P3)', () => {
  test('a rejected clipboard write shows the blame-free error toast, never success', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    })
    renderButton()
    fireEvent.click(screen.getByTestId('share-summary-copy'))
    await waitFor(() => expect(error).toHaveBeenCalledWith(i18n.t('analytics.share.error')))
    expect(success).not.toHaveBeenCalled()
  })

  test('a missing Clipboard API shows the error toast, never a false "copied"', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    renderButton()
    fireEvent.click(screen.getByTestId('share-summary-copy'))
    await waitFor(() => expect(error).toHaveBeenCalledWith(i18n.t('analytics.share.error')))
    expect(success).not.toHaveBeenCalled()
  })

  test('a successful write reports success exactly once', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })
    renderButton()
    fireEvent.click(screen.getByTestId('share-summary-copy'))
    await waitFor(() => expect(success).toHaveBeenCalledWith(i18n.t('analytics.share.copied')))
    expect(error).not.toHaveBeenCalled()
  })
})
