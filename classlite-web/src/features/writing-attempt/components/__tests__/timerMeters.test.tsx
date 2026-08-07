// Story 5.3 Task 5 (AC8/AC9) — the two ticking meters off the injected server
// clock: time-on-task counts up; the due-date countdown is calm, aria-live=off,
// and announces the deadline crossing exactly once.
import { act, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { assertI18nParity } from '@/lib/test/i18n-parity'
import { TimeOnTaskMeter } from '../TimeOnTaskMeter'
import { DueDateCountdown } from '../DueDateCountdown'

const START = '2026-08-04T00:00:00Z'
const BASE = Date.parse(START)

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function withI18n(node: React.ReactElement) {
  return render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>)
}

describe('TimeOnTaskMeter (AC8)', () => {
  test('counts up from startedAt off the injected server clock; numerals aria-live=off', () => {
    let now = BASE
    withI18n(
      <TimeOnTaskMeter startedAt={START} serverNow={() => now} tickMs={1000} />,
    )
    const value = screen.getByTestId('writing-time-on-task-value')
    expect(value).toHaveTextContent('0:00')
    expect(value).toHaveAttribute('aria-live', 'off')

    act(() => {
      now = BASE + 65_000
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByTestId('writing-time-on-task-value')).toHaveTextContent('1:05')
  })
})

describe('DueDateCountdown (AC9)', () => {
  test('shows a calm countdown before the deadline; numerals aria-live=off', () => {
    const deadline = new Date(BASE + 3_600_000).toISOString() // 1h out
    const now = BASE
    withI18n(
      <DueDateCountdown deadlineAt={deadline} serverNow={() => now} tickMs={1000} />,
    )
    expect(screen.getByTestId('writing-due-countdown')).toHaveAttribute(
      'data-overdue',
      'false',
    )
    expect(screen.getByTestId('writing-due-value')).toHaveAttribute('aria-live', 'off')
  })

  test('a multi-day due date reads in calm day/hour terms, not the exam H:MM:SS', () => {
    const deadline = new Date(BASE + 2 * 86_400_000 + 3 * 3_600_000).toISOString() // 2d 3h
    const now = BASE
    withI18n(
      <DueDateCountdown deadlineAt={deadline} serverNow={() => now} tickMs={1000} />,
    )
    const value = screen.getByTestId('writing-due-value')
    expect(value).toHaveTextContent(
      i18n.t('writing.due.countdown', {
        time: i18n.t('writing.due.remaining.days', { days: 2, hours: 3 }),
      }),
    )
    // The exam formatter would have rendered a bare "51:00:00" — assert it does not.
    expect(value).not.toHaveTextContent('51:00:00')
  })

  test('flips overdue and announces the crossing exactly once (Sally S5)', () => {
    const deadline = new Date(BASE + 5_000).toISOString() // 5s out
    let now = BASE
    withI18n(
      <DueDateCountdown deadlineAt={deadline} serverNow={() => now} tickMs={1000} />,
    )
    expect(screen.queryByTestId('writing-due-announce')).not.toBeInTheDocument()

    act(() => {
      now = BASE + 10_000 // past the deadline
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByTestId('writing-due-countdown')).toHaveAttribute(
      'data-overdue',
      'true',
    )
    expect(screen.getByTestId('writing-due-overdue')).toHaveTextContent(
      i18n.t('writing.due.overdue'),
    )
    const announce = screen.getByTestId('writing-due-announce')
    expect(announce).toHaveAttribute('aria-live', 'polite')
    expect(announce).toHaveTextContent(i18n.t('writing.due.overdueAnnounce'))
  })

  test('i18n keys exist in en + vi', () => {
    assertI18nParity([
      'writing.due.label',
      'writing.due.countdown',
      'writing.due.remaining.days',
      'writing.due.remaining.hours',
      'writing.due.remaining.minutes',
      'writing.due.overdue',
      'writing.due.overdueAnnounce',
      'writing.timeOnTask.label',
    ])
  })
})
