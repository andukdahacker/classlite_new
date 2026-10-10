/**
 * InboxRow — Story 10.4 AC10 (10.3 D4). The two row-action controls (primary +
 * archive) must meet the ≥44px touch-target floor (TEST-UX-4) while keeping the
 * compact ghost/xs visual. jsdom computes no layout, so the structural assertion
 * is on the min-h-11 / min-w-11 (44px) utilities that force the hit area.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { InboxRow, type InboxRowData } from '../InboxRow'

function row(overrides: Partial<InboxRowData> = {}): InboxRowData {
  return {
    id: 'n-1',
    type: 'submission',
    mainTextKey: 'inboxRow.unread.aria',
    mainTextVars: {},
    metaKey: 'inboxRow.unread.aria',
    metaVars: {},
    occurredAt: '2026-10-10T00:00:00Z',
    occurredAtLabel: '2h ago',
    ...overrides,
  }
}

function renderRow(data: InboxRowData) {
  return render(
    <ul>
      <InboxRow row={data} role="teacher" />
    </ul>,
  )
}

describe('InboxRow — AC10 touch targets', () => {
  test('the primary action control meets the ≥44px floor (min-h-11 min-w-11)', () => {
    renderRow(row())
    const primary = screen.getByTestId('inbox-row-n-1-primary')
    expect(primary).toHaveClass('min-h-11')
    expect(primary).toHaveClass('min-w-11')
  })

  test('the archive action control meets the ≥44px floor (min-h-11 min-w-11)', () => {
    renderRow(row())
    const archive = screen.getByTestId('inbox-row-n-1-archive')
    expect(archive).toHaveClass('min-h-11')
    expect(archive).toHaveClass('min-w-11')
  })

  test('a suppressed-archive row still renders a ≥44px primary control', () => {
    renderRow(row({ suppressArchive: true }))
    expect(screen.queryByTestId('inbox-row-n-1-archive')).not.toBeInTheDocument()
    expect(screen.getByTestId('inbox-row-n-1-primary')).toHaveClass('min-h-11', 'min-w-11')
  })
})
