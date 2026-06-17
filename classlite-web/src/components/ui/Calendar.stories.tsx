/**
 * Calendar — Story 1d-2 AC5.
 *
 * Calendar-library decision for `SessionScheduleCalendar` is Epic 3
 * Story 3-4 — this primitive is the shadcn day-picker only.
 *
 * Reference date is the ISO string `2026-06-15T00:00:00Z` exposed via
 * `parameters.now` and parsed inside each render. NO `new Date()` in
 * render paths (TS-6 + 1D-P0-013).
 *
 * Vietnamese `LocaleVi` consumes `{ vi } from 'date-fns/locale/vi'`
 * (deep import — bundle hygiene per the 1d-1 code review pattern; per
 * 1D-P0-014). Default weekday format is `T2`, `T3`, …, `CN` — the long
 * form (`Thứ Hai`) breaks the 7-column grid.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { vi } from 'date-fns/locale/vi'
import { enUS } from 'date-fns/locale/en-US'
import { useTranslation } from 'react-i18next'
import { Calendar } from './calendar'
import { Badge } from './badge'

const STORYBOOK_NOW = '2026-06-15T00:00:00Z' as const
// Module-scope constants — TS-6 forbids `new Date()` in render paths.
// Hoisted out of the previous `useMemo(() => new Date(...))` wrapper so
// the literal Date constructor runs once at module load, not on every
// story render.
const STORYBOOK_NOW_DATE = new Date(STORYBOOK_NOW)
const STORYBOOK_RANGE_END_DATE = new Date('2026-06-22T00:00:00Z')

const meta = {
  title: 'ui/Calendar',
  component: Calendar,
  parameters: { layout: 'centered', now: STORYBOOK_NOW },
} satisfies Meta<typeof Calendar>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => <Calendar mode="single" month={STORYBOOK_NOW_DATE} />,
}

export const WithSelected: Story = {
  render: () => (
    <Calendar
      mode="single"
      month={STORYBOOK_NOW_DATE}
      selected={STORYBOOK_NOW_DATE}
    />
  ),
}

export const Range: Story = {
  render: () => (
    <Calendar
      mode="range"
      month={STORYBOOK_NOW_DATE}
      selected={{ from: STORYBOOK_NOW_DATE, to: STORYBOOK_RANGE_END_DATE }}
    />
  ),
}

export const WithDisabledDates: Story = {
  render: () => {
    // Use UTC day index — `getDay()` returns the LOCAL-time day, which
    // shifts by one in timezones west of UTC on Sun/Mon boundary days.
    // Dates here are UTC-parsed, so `getUTCDay()` keeps the weekend mask
    // stable across all runner timezones.
    const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6
    return (
      <Calendar mode="single" month={STORYBOOK_NOW_DATE} disabled={isWeekend} />
    )
  },
}

export const LocaleEn: Story = {
  render: () => (
    <Calendar mode="single" month={STORYBOOK_NOW_DATE} locale={enUS} />
  ),
}

export const LocaleVi: Story = {
  // Vietnamese weekday longform breaks the 7-column grid — keep locale
  // default shorts (T2 / T3 / T4 / T5 / T6 / T7 / CN).
  render: () => (
    <Calendar mode="single" month={STORYBOOK_NOW_DATE} locale={vi} />
  ),
}

export const LocaleViWithEvents: Story = {
  render: () => <LocaleViWithEventsDemo />,
}

function LocaleViWithEventsDemo() {
  const { t } = useTranslation()
  return (
    <div className="grid gap-3 font-sans">
      <Calendar
        mode="single"
        month={STORYBOOK_NOW_DATE}
        locale={vi}
        selected={STORYBOOK_NOW_DATE}
      />
      <div className="flex items-center gap-2 text-sm">
        <Badge className="font-mono">3</Badge>
        <span>{t('storybook.calendar.eventToday')}</span>
      </div>
    </div>
  )
}
