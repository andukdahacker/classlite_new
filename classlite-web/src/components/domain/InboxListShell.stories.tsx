/**
 * InboxListShell + InboxRow — Story 1d-4 AC6 visual identity stories.
 *
 * Per UX-3, role variants ship as three separate stories (`TeacherView`
 * / `StudentView` / `AdminOwnerView`). The component receives `role` as
 * data; the row taxonomy differs at the fixture layer. Each row uses i18n
 * keys + interpolation vars — real notification objects in Epic 10 will
 * map server-side types to these keys before render.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'

import { EmptyStatePlaceholder } from '@/test/fixtures/empty-state-placeholder'
import { ErrorStatePlaceholder } from '@/test/fixtures/error-state-placeholder'

import { InboxListShell, type InboxFilterChip } from './InboxListShell'
import type { InboxRowData } from './InboxRow'

const TEACHER_FILTERS: ReadonlyArray<InboxFilterChip> = [
  { key: 'inboxList.filter.all', count: 12 },
  { key: 'inboxList.filter.questions', count: 5 },
  { key: 'inboxList.filter.submissions', count: 4 },
  { key: 'inboxList.filter.mentions', count: 3 },
]

const STUDENT_FILTERS: ReadonlyArray<InboxFilterChip> = [
  { key: 'inboxList.filter.all', count: 9 },
  { key: 'inboxList.filter.replies', count: 3 },
  { key: 'inboxList.filter.grades', count: 2 },
  { key: 'inboxList.filter.assignments', count: 4 },
]

const ADMIN_FILTERS: ReadonlyArray<InboxFilterChip> = [
  { key: 'inboxList.filter.all', count: 8 },
  { key: 'inboxList.filter.enrolments', count: 3 },
  { key: 'inboxList.filter.staff', count: 2 },
  { key: 'inboxList.filter.billing', count: 2 },
  { key: 'inboxList.filter.integrations', count: 1 },
]

const TEACHER_ROWS: ReadonlyArray<InboxRowData> = [
  {
    id: 't-1',
    type: 'question',
    mainTextKey: 'inboxRow.teacher.question.main',
    mainTextVars: { student: 'Lan Pham', exercise: 'Reading 2' },
    metaKey: 'inboxRow.meta.classTime',
    metaVars: { class: 'IELTS 6.5 — Sec A', time: '2h ago' },
    occurredAt: '2026-06-22T08:11:00Z',
    unread: true,
  },
  {
    id: 't-2',
    type: 'submission',
    mainTextKey: 'inboxRow.teacher.submission.main',
    mainTextVars: { student: 'Minh Tran', exercise: 'Writing Task 2' },
    metaKey: 'inboxRow.meta.classTime',
    metaVars: { class: 'IELTS 6.5 — Sec A', time: '3h ago' },
    occurredAt: '2026-06-22T07:11:00Z',
    unread: true,
  },
  {
    id: 't-3',
    type: 'mention',
    mainTextKey: 'inboxRow.teacher.mention.main',
    mainTextVars: { student: 'Khanh Le' },
    metaKey: 'inboxRow.meta.classTime',
    metaVars: { class: 'IELTS 7.0 — Sec B', time: '5h ago' },
    occurredAt: '2026-06-22T05:11:00Z',
  },
  {
    id: 't-4',
    type: 'submission',
    mainTextKey: 'inboxRow.teacher.submission.main',
    mainTextVars: { student: 'Trang Bui', exercise: 'Speaking Part 2' },
    metaKey: 'inboxRow.meta.classTime',
    metaVars: { class: 'IELTS 6.0 — Sec C', time: '7h ago' },
    occurredAt: '2026-06-22T03:11:00Z',
  },
  {
    id: 't-5',
    type: 'question',
    mainTextKey: 'inboxRow.teacher.question.main',
    mainTextVars: { student: 'Vy Nguyen', exercise: 'Listening 4' },
    metaKey: 'inboxRow.meta.classTime',
    metaVars: { class: 'IELTS 6.0 — Sec C', time: '8h ago' },
    occurredAt: '2026-06-22T02:11:00Z',
  },
  {
    id: 't-6',
    type: 'mention',
    mainTextKey: 'inboxRow.teacher.mention.main',
    mainTextVars: { student: 'An Vo' },
    metaKey: 'inboxRow.meta.classTime',
    metaVars: { class: 'IELTS 6.5 — Sec A', time: 'yesterday' },
    occurredAt: '2026-06-21T08:11:00Z',
  },
  {
    id: 't-7',
    type: 'question',
    mainTextKey: 'inboxRow.teacher.question.main',
    mainTextVars: { student: 'Quynh Do', exercise: 'Reading 3' },
    metaKey: 'inboxRow.meta.classTime',
    metaVars: { class: 'IELTS 7.0 — Sec B', time: 'yesterday' },
    occurredAt: '2026-06-21T07:11:00Z',
  },
  {
    id: 't-8',
    type: 'submission',
    mainTextKey: 'inboxRow.teacher.submission.main',
    mainTextVars: { student: 'Phuong Mai', exercise: 'Writing Task 1' },
    metaKey: 'inboxRow.meta.classTime',
    metaVars: { class: 'IELTS 6.5 — Sec A', time: 'yesterday' },
    occurredAt: '2026-06-21T06:11:00Z',
  },
]

const STUDENT_ROWS: ReadonlyArray<InboxRowData> = [
  {
    id: 's-1',
    type: 'reply',
    mainTextKey: 'inboxRow.student.reply.main',
    mainTextVars: { teacher: 'Mr. Hoang' },
    metaKey: 'inboxRow.meta.classTime',
    metaVars: { class: 'IELTS 6.5', time: '1h ago' },
    occurredAt: '2026-06-22T09:11:00Z',
    unread: true,
  },
  {
    id: 's-2',
    type: 'grade',
    mainTextKey: 'inboxRow.student.grade.main',
    mainTextVars: { exercise: 'Writing Task 2', band: '6.5' },
    metaKey: 'inboxRow.meta.classTime',
    metaVars: { class: 'IELTS 6.5', time: '2h ago' },
    occurredAt: '2026-06-22T08:11:00Z',
    unread: true,
  },
  {
    id: 's-3',
    type: 'assignment',
    mainTextKey: 'inboxRow.student.assignment.main',
    mainTextVars: { title: 'Speaking Part 3 — opinion essay' },
    metaKey: 'inboxRow.meta.classTime',
    metaVars: { class: 'IELTS 6.5', time: '4h ago' },
    occurredAt: '2026-06-22T06:11:00Z',
  },
  {
    id: 's-4',
    type: 'reply',
    mainTextKey: 'inboxRow.student.reply.main',
    mainTextVars: { teacher: 'Ms. Linh' },
    metaKey: 'inboxRow.meta.classTime',
    metaVars: { class: 'IELTS 6.5', time: '6h ago' },
    occurredAt: '2026-06-22T04:11:00Z',
  },
  {
    id: 's-5',
    type: 'schedule',
    mainTextKey: 'inboxRow.student.schedule.main',
    mainTextVars: { class: 'IELTS 6.5' },
    metaKey: 'inboxRow.meta.time',
    metaVars: { time: '8h ago' },
    occurredAt: '2026-06-22T02:11:00Z',
  },
  {
    id: 's-6',
    type: 'mention',
    mainTextKey: 'inboxRow.student.mention.main',
    mainTextVars: { teacher: 'Mr. Hoang' },
    metaKey: 'inboxRow.meta.classTime',
    metaVars: { class: 'IELTS 6.5', time: 'yesterday' },
    occurredAt: '2026-06-21T08:11:00Z',
  },
  {
    id: 's-7',
    type: 'assignment',
    mainTextKey: 'inboxRow.student.assignment.main',
    mainTextVars: { title: 'Reading Section 4' },
    metaKey: 'inboxRow.meta.classTime',
    metaVars: { class: 'IELTS 6.5', time: 'yesterday' },
    occurredAt: '2026-06-21T07:11:00Z',
  },
  {
    id: 's-8',
    type: 'grade',
    mainTextKey: 'inboxRow.student.grade.main',
    mainTextVars: { exercise: 'Listening Section 2', band: '7.0' },
    metaKey: 'inboxRow.meta.classTime',
    metaVars: { class: 'IELTS 6.5', time: 'yesterday' },
    occurredAt: '2026-06-21T06:11:00Z',
  },
]

const ADMIN_ROWS: ReadonlyArray<InboxRowData> = [
  {
    id: 'a-1',
    type: 'enrolment',
    mainTextKey: 'inboxRow.admin.enrolment.main',
    mainTextVars: { student: 'Lan Pham', class: 'IELTS 6.5 — Sec A' },
    metaKey: 'inboxRow.meta.time',
    metaVars: { time: '15m ago' },
    occurredAt: '2026-06-22T09:56:00Z',
    unread: true,
  },
  {
    id: 'a-2',
    type: 'staff',
    mainTextKey: 'inboxRow.admin.staff.main',
    mainTextVars: { user: 'Ms. Linh' },
    metaKey: 'inboxRow.meta.time',
    metaVars: { time: '1h ago' },
    occurredAt: '2026-06-22T09:11:00Z',
    unread: true,
  },
  {
    id: 'a-3',
    type: 'billing',
    mainTextKey: 'inboxRow.admin.billing.main',
    mainTextVars: { status: 'succeeded', plan: 'Pro annual' },
    metaKey: 'inboxRow.meta.time',
    metaVars: { time: '3h ago' },
    occurredAt: '2026-06-22T07:11:00Z',
  },
  {
    id: 'a-4',
    type: 'enrolment',
    mainTextKey: 'inboxRow.admin.enrolment.main',
    mainTextVars: { student: 'Khanh Le', class: 'IELTS 7.0 — Sec B' },
    metaKey: 'inboxRow.meta.time',
    metaVars: { time: '5h ago' },
    occurredAt: '2026-06-22T05:11:00Z',
  },
  {
    id: 'a-5',
    type: 'integration',
    mainTextKey: 'inboxRow.admin.integration.main',
    mainTextVars: { integration: 'Google Meet', action: 'connected' },
    metaKey: 'inboxRow.meta.time',
    metaVars: { time: '6h ago' },
    occurredAt: '2026-06-22T04:11:00Z',
  },
  {
    id: 'a-6',
    type: 'billing',
    mainTextKey: 'inboxRow.admin.billing.main',
    mainTextVars: { status: 'failed', plan: 'Pro monthly' },
    metaKey: 'inboxRow.meta.time',
    metaVars: { time: '8h ago' },
    occurredAt: '2026-06-22T02:11:00Z',
  },
]

const meta = {
  title: 'domain/InboxListShell',
  component: InboxListShell,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof InboxListShell>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    rows: TEACHER_ROWS,
    role: 'teacher',
    filters: TEACHER_FILTERS,
    activeFilters: ['inboxList.filter.all'],
  },
}

export const TeacherView: Story = {
  globals: { role: 'teacher' },
  args: {
    rows: TEACHER_ROWS,
    role: 'teacher',
    filters: TEACHER_FILTERS,
    activeFilters: ['inboxList.filter.all'],
  },
}

export const StudentView: Story = {
  globals: { role: 'student' },
  args: {
    rows: STUDENT_ROWS,
    role: 'student',
    filters: STUDENT_FILTERS,
    activeFilters: ['inboxList.filter.all'],
  },
}

export const AdminOwnerView: Story = {
  globals: { role: 'owner' },
  args: {
    rows: ADMIN_ROWS,
    role: 'owner',
    filters: ADMIN_FILTERS,
    activeFilters: ['inboxList.filter.all'],
  },
}

export const FiltersActive: Story = {
  args: {
    rows: TEACHER_ROWS.slice(0, 4),
    role: 'teacher',
    filters: TEACHER_FILTERS,
    activeFilters: ['inboxList.filter.questions', 'inboxList.filter.mentions'],
  },
}

export const Loading: Story = {
  args: {
    rows: [],
    role: 'teacher',
    filters: TEACHER_FILTERS,
    activeFilters: [],
  },
  render: () => (
    <div
      role="status"
      aria-label="Loading inbox"
      className="space-y-2 rounded-2xl border border-dashed border-border bg-muted/30 p-4"
    >
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="flex items-center gap-3">
          <div className="size-8 animate-pulse rounded-full bg-muted" />
          <div className="flex-1 space-y-1">
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted/80" />
            <div className="h-2 w-1/3 animate-pulse rounded bg-muted/60" />
          </div>
        </div>
      ))}
    </div>
  ),
}

export const Empty: Story = {
  args: {
    rows: [],
    role: 'teacher',
    filters: TEACHER_FILTERS,
    activeFilters: ['inboxList.filter.all'],
  },
  render: () => (
    <EmptyStatePlaceholder
      headline="Inbox zero"
      body="You're all caught up. New messages appear here as students engage."
    />
  ),
}

export const Error: Story = {
  args: {
    rows: [],
    role: 'teacher',
    filters: TEACHER_FILTERS,
    activeFilters: [],
  },
  render: () => (
    <ErrorStatePlaceholder
      message="We couldn't load your inbox. Try again."
      retryLabel="Reload inbox"
      onRetry={() => {}}
    />
  ),
}

export const LocaleEn: Story = {
  globals: { locale: 'en' },
  args: {
    rows: TEACHER_ROWS,
    role: 'teacher',
    filters: TEACHER_FILTERS,
    activeFilters: ['inboxList.filter.all'],
  },
}

export const LocaleVi: Story = {
  globals: { locale: 'vi' },
  args: {
    rows: TEACHER_ROWS.map((row) => ({
      ...row,
      metaVars: {
        ...row.metaVars,
        time:
          row.metaVars.time === 'yesterday'
            ? 'hôm qua'
            : row.metaVars.time
                .replace('h ago', ' giờ trước')
                .replace('m ago', ' phút trước'),
      },
    })),
    role: 'teacher',
    filters: TEACHER_FILTERS,
    activeFilters: ['inboxList.filter.all'],
  },
}
