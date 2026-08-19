// Story 5.5b Task 2 (Murat/Winston W3) — CommentCard `readOnly` regression pins.
// The shared card is consumed by the LIVE teacher grading surface (6.1) AND the new
// read-only student result view (5.5b). These pins lock the teacher path BEFORE the
// additive prop lands, then verify the read-only path suppresses EVERY interactive
// affordance — not merely disables it (a disabled button still leaks intent and can be
// re-enabled). MSW-free: CommentCard is a pure presentational leaf.
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, test } from 'vitest'
import { axe } from 'vitest-axe'
import i18n from '@/lib/i18n'
import { CommentCard } from '../CommentCard'

function renderCard(props: Partial<React.ComponentProps<typeof CommentCard>> = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <CommentCard
        type="error"
        criterionKey="criterion.lexicalResource"
        body="Watch the collocation here."
        testIdSlug="0"
        {...props}
      />
    </I18nextProvider>,
  )
}

describe('CommentCard — teacher (default) path is unchanged (regression pin)', () => {
  test('without readOnly the Resolve + Edit controls are PRESENT and ENABLED', () => {
    renderCard()
    const resolve = screen.getByTestId('comment-card-0-resolve')
    const edit = screen.getByTestId('comment-card-0-edit')
    expect(resolve).toBeInTheDocument()
    expect(edit).toBeInTheDocument()
    // Guards a `!readOnly`/defaulting typo silently disarming the teacher UI.
    expect(resolve).toBeEnabled()
    expect(edit).toBeEnabled()
  })

  test('readOnly defaults false → an explicit readOnly={false} is byte-identical to omitting it', () => {
    renderCard({ readOnly: false })
    expect(screen.getByTestId('comment-card-0-resolve')).toBeEnabled()
    expect(screen.getByTestId('comment-card-0-edit')).toBeEnabled()
  })
})

describe('CommentCard — readOnly suppresses ALL interactive affordances (W3)', () => {
  test('with readOnly there is NO interactive control — the buttons are absent (null), not disabled', () => {
    renderCard({ readOnly: true })
    // Absent from the DOM entirely — a disabled button still leaks intent (Winston W3).
    expect(screen.queryByTestId('comment-card-0-resolve')).not.toBeInTheDocument()
    expect(screen.queryByTestId('comment-card-0-edit')).not.toBeInTheDocument()
    // No focusable control anywhere in the card.
    const card = screen.getByTestId('comment-card-0')
    expect(card.querySelectorAll('button, a, input, select, textarea, [tabindex]')).toHaveLength(0)
  })

  test('readOnly still renders the tone chip, criterion label, and body (content is intact)', () => {
    renderCard({ readOnly: true })
    const card = screen.getByTestId('comment-card-0')
    expect(card).toHaveAttribute('data-comment-type', 'error')
    expect(card).toHaveTextContent(i18n.t('criterion.lexicalResource'))
    expect(card).toHaveTextContent('Watch the collocation here.')
  })

  test('readOnly renders the body as an escaped React text node (no HTML injection)', () => {
    const { container } = renderCard({
      readOnly: true,
      body: '"><img src=x onerror=alert(1)>',
    })
    expect(container.querySelector('img[onerror]')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByTestId('comment-card-0')).toHaveTextContent(
      '"><img src=x onerror=alert(1)>',
    )
  })

  test('readOnly card is axe-clean', async () => {
    const { container } = renderCard({ readOnly: true })
    expect(await axe(container)).toHaveNoViolations()
  })
})
