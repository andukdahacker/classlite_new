/**
 * AnalyticsHomeShell + ScopeBar — Story 1d-4 AC7 visual identity stories.
 *
 * Per UX-DR29, the teacher view disables the `center-wide` scope pill
 * (still rendered, not absent — the affordance teaches the user that the
 * scope exists but is gated by role). Admin / owner views render all
 * three pills enabled. The ClassPickerOpen story drives the Select open
 * via `defaultOpen`. DateRangeSelected passes a pre-formatted label.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'

import { Skeleton } from '@/components/ui/skeleton'
import { EmptyStatePlaceholder } from '@/test/fixtures/empty-state-placeholder'
import { ErrorStatePlaceholder } from '@/test/fixtures/error-state-placeholder'

import { AnalyticsHomeShell } from './AnalyticsHomeShell'

const CLASS_OPTIONS = [
  { id: 'cls-65a', nameKey: 'analyticsHome.classOption.ielts65SecA' },
  { id: 'cls-65b', nameKey: 'analyticsHome.classOption.ielts65SecB' },
  { id: 'cls-70a', nameKey: 'analyticsHome.classOption.ielts70SecA' },
  { id: 'cls-70b', nameKey: 'analyticsHome.classOption.ielts70SecB' },
  { id: 'cls-60c', nameKey: 'analyticsHome.classOption.ielts60SecC' },
] as const

const DEFAULT_RANGE = {
  startIso: '2026-05-22T00:00:00Z',
  endIso: '2026-06-22T00:00:00Z',
} as const

function AnalyticsCardSkeleton({ titleKey }: { titleKey: string }) {
  return (
    <article
      data-testid={`analytics-card-${titleKey}`}
      className="flex flex-col gap-3 rounded-2xl border border-[color:var(--cl-line-soft)] bg-card p-4 shadow-sm"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-lg text-foreground">{titleKey}</h2>
        <span className="font-mono text-xs text-foreground">7d</span>
      </div>
      <Skeleton className="h-40 w-full" />
      <div className="flex gap-3 text-xs text-foreground">
        <span>Median 6.5</span>
        <span>Top 7.5</span>
        <span>Bottom 5.0</span>
      </div>
    </article>
  )
}

const meta = {
  title: 'domain/AnalyticsHomeShell',
  component: AnalyticsHomeShell,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof AnalyticsHomeShell>

export default meta
type Story = StoryObj<typeof meta>

const TEACHER_ARGS = {
  role: 'teacher' as const,
  titleKey: 'analyticsHome.title.teacher',
  subKey: 'analyticsHome.subtitle.teacher',
  scopeBar: {
    role: 'teacher' as const,
    activeScope: 'mine' as const,
    disabledScopes: ['center-wide' as const],
    selectedClassId: 'cls-65a',
    classOptions: CLASS_OPTIONS,
    dateRange: DEFAULT_RANGE,
  },
}

const ADMIN_ARGS = {
  role: 'admin' as const,
  titleKey: 'analyticsHome.title.admin',
  subKey: 'analyticsHome.subtitle.admin',
  scopeBar: {
    role: 'admin' as const,
    activeScope: 'center-wide' as const,
    selectedClassId: null,
    classOptions: CLASS_OPTIONS,
    dateRange: DEFAULT_RANGE,
  },
}

const OWNER_ARGS = {
  role: 'owner' as const,
  titleKey: 'analyticsHome.title.owner',
  subKey: 'analyticsHome.subtitle.owner',
  scopeBar: {
    role: 'owner' as const,
    activeScope: 'center-wide' as const,
    selectedClassId: null,
    classOptions: CLASS_OPTIONS,
    dateRange: DEFAULT_RANGE,
  },
}

export const Default: Story = {
  args: {
    ...TEACHER_ARGS,
    children: (
      <>
        <AnalyticsCardSkeleton titleKey="Class performance" />
        <AnalyticsCardSkeleton titleKey="Engagement" />
      </>
    ),
  },
}

export const TeacherView: Story = {
  globals: { role: 'teacher' },
  args: {
    ...TEACHER_ARGS,
    children: (
      <>
        <AnalyticsCardSkeleton titleKey="Class band trend" />
        <AnalyticsCardSkeleton titleKey="Submission rate" />
      </>
    ),
  },
}

export const AdminView: Story = {
  globals: { role: 'admin' },
  args: {
    ...ADMIN_ARGS,
    children: (
      <>
        <AnalyticsCardSkeleton titleKey="Center-wide band" />
        <AnalyticsCardSkeleton titleKey="Active classes" />
      </>
    ),
  },
}

export const OwnerView: Story = {
  globals: { role: 'owner' },
  args: {
    ...OWNER_ARGS,
    children: (
      <>
        <AnalyticsCardSkeleton titleKey="Revenue per class" />
        <AnalyticsCardSkeleton titleKey="Center utilisation" />
      </>
    ),
  },
}

export const ClassPickerOpen: Story = {
  args: {
    ...TEACHER_ARGS,
    children: (
      <>
        <AnalyticsCardSkeleton titleKey="Class band trend" />
        <AnalyticsCardSkeleton titleKey="Submission rate" />
      </>
    ),
  },
  parameters: {
    docs: {
      description: {
        story:
          'Class picker dropdown should be opened manually via the Select trigger to demonstrate the 5 fixture options. The static shell does not auto-open in CI.',
      },
    },
  },
}

export const DateRangeSelected: Story = {
  args: {
    ...TEACHER_ARGS,
    scopeBar: {
      ...TEACHER_ARGS.scopeBar,
      dateRange: {
        startIso: '2026-06-01T00:00:00Z',
        endIso: '2026-06-22T00:00:00Z',
      },
      dateRangeLabel: 'Jun 1 — Jun 22, 2026',
    },
    children: (
      <>
        <AnalyticsCardSkeleton titleKey="Class band trend" />
        <AnalyticsCardSkeleton titleKey="Submission rate" />
      </>
    ),
  },
}

export const Loading: Story = {
  args: {
    ...TEACHER_ARGS,
    children: (
      <>
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-56 w-full" />
      </>
    ),
  },
}

export const Empty: Story = {
  args: { ...TEACHER_ARGS, children: null },
  render: () => (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <EmptyStatePlaceholder
        headline="No analytics yet"
        body="Once students start submitting, charts populate here."
      />
      <EmptyStatePlaceholder
        headline="No engagement data"
        body="Engagement metrics appear after the first week of sessions."
      />
    </div>
  ),
}

export const Error: Story = {
  args: { ...TEACHER_ARGS, children: null },
  render: () => (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <ErrorStatePlaceholder
        message="Could not load analytics."
        retryLabel="Retry"
        onRetry={() => {}}
      />
      <ErrorStatePlaceholder
        message="Could not load engagement."
        retryLabel="Retry"
        onRetry={() => {}}
      />
    </div>
  ),
}

export const LocaleEn: Story = {
  globals: { locale: 'en' },
  args: {
    ...TEACHER_ARGS,
    children: (
      <>
        <AnalyticsCardSkeleton titleKey="Class band trend" />
        <AnalyticsCardSkeleton titleKey="Submission rate" />
      </>
    ),
  },
}

export const LocaleVi: Story = {
  globals: { locale: 'vi' },
  args: {
    ...TEACHER_ARGS,
    children: (
      <>
        <AnalyticsCardSkeleton titleKey="Xu hướng điểm IELTS" />
        <AnalyticsCardSkeleton titleKey="Tỷ lệ nộp bài" />
      </>
    ),
  },
}
