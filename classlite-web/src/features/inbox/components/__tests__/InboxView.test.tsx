/**
 * InboxView — Story 10-1b AC2 (three-state trilogy), AC8c (faithful renderer),
 * AC10 (axe + aria). MSW at the HTTP boundary (TEST-FE-1); real QueryClient +
 * i18n + router. Negative assertions pair the positives (test meta-rule): the
 * admin lens must NOT surface a Billing chip, the owner lens MUST.
 */
import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, useLocation } from 'react-router'
import { axe } from 'vitest-axe'
import 'vitest-axe/extend-expect'
import { afterEach, describe, expect, test } from 'vitest'

import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import type { components } from '@/lib/api/client'

import { InboxView } from '../InboxView'
import type { InboxEmptyLens } from '../InboxStates'

type Notification = components['schemas']['Notification']
type NotificationType = components['schemas']['NotificationType']

const SERVER_TIME = '2026-10-07T12:00:00Z'

function notif(id: string, type: NotificationType, over: Partial<Notification> = {}): Notification {
  return {
    id,
    type,
    title: `EN ${type}`,
    body: `EN body ${type}`,
    link: '/somewhere',
    metadata: { schemaVersion: 1, studentName: 'Linh', assignmentTitle: 'Essay 2', className: 'B2' },
    readAt: null,
    archivedAt: null,
    createdAt: SERVER_TIME,
    ...over,
  }
}

function listEnvelope(items: Notification[]) {
  return {
    data: items,
    meta: {
      serverTime: SERVER_TIME,
      pagination: { page: 1, pageSize: 20, total: items.length, totalPages: 1 },
    },
  }
}

function useListHandler(items: Notification[]) {
  server.use(
    http.get('/api/inbox', () => HttpResponse.json(listEnvelope(items))),
    // read-on-view may fire; keep it handled so nothing escapes the boundary.
    http.post('/api/inbox/:id/read', () => HttpResponse.json({ data: { id: 'x', status: 'read' } })),
  )
}

function renderView(role: Parameters<typeof InboxView>[0]['role'], emptyLens: InboxEmptyLens, enableTeacherReply = false) {
  const client = createTestQueryClient()
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/inbox']}>
          <InboxView role={role} emptyLens={emptyLens} enableTeacherReply={enableTeacherReply} />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

afterEach(() => server.resetHandlers())

describe('InboxView — three-state trilogy (AC2)', () => {
  test('loading renders list-shaped skeleton (aria-busy, no spinner)', () => {
    server.use(http.get('/api/inbox', async () => {
      await new Promise((r) => setTimeout(r, 50))
      return HttpResponse.json(listEnvelope([]))
    }))
    renderView('student', 'student')
    expect(screen.getByTestId('inbox-skeleton')).toHaveAttribute('aria-busy', 'true')
  })

  test('success renders rows + the "N unread · M total" header', async () => {
    useListHandler([notif('n1', 'grade_released'), notif('n2', 'assignment_created')])
    renderView('student', 'student')
    expect(await screen.findByTestId('inbox-row-n1')).toBeInTheDocument()
    expect(screen.getByTestId('inbox-header-count')).toBeInTheDocument()
    expect(screen.getByTestId('inbox-mark-all-read')).toBeInTheDocument()
  })

  test('network failure renders an inline role="alert" with a retry (no full-page)', async () => {
    server.use(http.get('/api/inbox', () => HttpResponse.json({ error: { code: 'X', message: 'x', requestId: 'r' } }, { status: 500 })))
    renderView('student', 'student')
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: i18n.t('inbox.error.retry') })).toBeInTheDocument()
  })

  test('empty queue renders the role-toned empty (not generic) and SUPPRESSES the count header', async () => {
    useListHandler([])
    renderView('student', 'student')
    expect(await screen.findByTestId('inbox-empty')).toBeInTheDocument()
    // the §6.4 italic-accent brand word renders.
    expect(screen.getByText(i18n.t('inbox.empty.student.titleAccent'))).toBeInTheDocument()
    expect(screen.queryByTestId('inbox-header-count')).not.toBeInTheDocument()
  })
})

describe('InboxView — faithful renderer + role lanes (AC8)', () => {
  test('admin lens renders a hostile payment_failed row faithfully (OD6 total mapper)', async () => {
    useListHandler([notif('nb', 'payment_failed')])
    renderView('admin', 'ownerAdmin')
    const row = await screen.findByTestId('inbox-row-nb')
    expect(row).toHaveAttribute('data-row-type', 'billing')
  })

  test('admin lens has NO Billing chip; owner lens DOES (AC8b derivation, rendered)', async () => {
    useListHandler([notif('n1', 'enrollment_changed')])
    const { unmount } = renderView('admin', 'ownerAdmin')
    await screen.findByTestId('inbox-list-shell')
    expect(screen.queryByTestId('inbox-list-shell-filter-inboxList.filter.billing')).not.toBeInTheDocument()
    unmount()

    useListHandler([notif('n1', 'enrollment_changed')])
    renderView('owner', 'ownerAdmin')
    await screen.findByTestId('inbox-list-shell')
    expect(screen.getByTestId('inbox-list-shell-filter-inboxList.filter.billing')).toBeInTheDocument()
  })

  test('only the teacher view mounts the reply action path (no composer on student)', async () => {
    useListHandler([notif('q1', 'question_asked', { metadata: { schemaVersion: 1, studentName: 'Linh', questionId: 'qid-1' } })])
    renderView('student', 'student')
    await screen.findByTestId('inbox-row-q1')
    // student never opens a composer even if a question row somehow arrives.
    expect(screen.queryByTestId('inbox-reply-composer-qid-1')).not.toBeInTheDocument()
  })
})

describe('InboxView — a11y (AC10)', () => {
  test('the loaded inbox passes axe', async () => {
    useListHandler([notif('n1', 'grade_released'), notif('n2', 'schedule_changed')])
    const { container } = renderView('student', 'student')
    await screen.findByTestId('inbox-row-n1')
    expect(await axe(container)).toHaveNoViolations()
  })
})

// ── Story 10-1c — the teacher merged work-queue feed ─────────────────────────────

type TeacherQueueItem = components['schemas']['TeacherQueueItem']

function queueItem(id: string, over: Partial<TeacherQueueItem> = {}): TeacherQueueItem {
  return {
    submissionId: id,
    studentName: 'Mai',
    assignmentTitle: 'IELTS Task 2',
    className: 'IELTS Evening',
    isLate: false,
    overdue: false,
    submittedAt: '2026-10-05T09:00:00Z',
    classId: 'class-1',
    assignmentId: 'asg-1',
    link: `/classes/class-1/grading/asg-1/${id}`,
    ...over,
  }
}

/** Register the teacher's TWO sources + capture the teacher-queue request URLs. */
function useTeacherHandlers(notifs: Notification[], queue: TeacherQueueItem[]) {
  const queueUrls: string[] = []
  server.use(
    http.get('/api/inbox', () => HttpResponse.json(listEnvelope(notifs))),
    http.post('/api/inbox/:id/read', () => HttpResponse.json({ data: { id: 'x', status: 'read' } })),
    http.get('/api/inbox/teacher-queue', ({ request }) => {
      const url = new URL(request.url)
      queueUrls.push(url.search)
      const lateOnly = url.searchParams.get('late_only') === 'true'
      const rows = lateOnly ? queue.filter((q) => q.isLate) : queue
      return HttpResponse.json({
        data: rows,
        meta: { serverTime: SERVER_TIME, pagination: { page: 1, pageSize: 100, total: rows.length, totalPages: 1 } },
      })
    }),
  )
  return queueUrls
}

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location-probe">{location.pathname}</div>
}

function renderTeacher() {
  const client = createTestQueryClient()
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/inbox']}>
          <InboxView role="teacher" emptyLens="teacher" enableTeacherReply />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

describe('InboxView — teacher merged work-queue feed (10-1c AC6/AC7/AC9/AC10)', () => {
  test('AC6: one feed interleaves question + submission rows newest-first', async () => {
    // question is newer (SERVER_TIME 2026-10-07) than the submission (2026-10-05).
    useTeacherHandlers(
      [notif('q1', 'question_asked', { metadata: { schemaVersion: 1, studentName: 'Linh', questionId: 'qid-1' } })],
      [queueItem('s1')],
    )
    renderTeacher()
    const questionRow = await screen.findByTestId('inbox-row-q1')
    const submissionRow = await screen.findByTestId('inbox-row-s1')
    // both kinds in the SINGLE list; the submission uses the grading lane.
    expect(submissionRow).toHaveAttribute('data-row-type', 'submission')
    expect(questionRow).toHaveAttribute('data-row-type', 'question')
    // newest-first: the newer question precedes the older submission.
    expect(questionRow.compareDocumentPosition(submissionRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('AC6: Grade navigates to the exact grading deep-link; submission row has NO archive', async () => {
    useTeacherHandlers([], [queueItem('s1')])
    renderTeacher()
    const submissionRow = await screen.findByTestId('inbox-row-s1')
    // submission rows suppress the archive affordance (DD3).
    expect(within(submissionRow).queryByTestId('inbox-row-s1-archive')).not.toBeInTheDocument()
    // Grade → the exact grading surface.
    fireEvent.click(within(submissionRow).getByTestId('inbox-row-s1-primary'))
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/classes/class-1/grading/asg-1/s1')
  })

  test('AC6: question rows KEEP the archive affordance', async () => {
    useTeacherHandlers(
      [notif('q1', 'question_asked', { metadata: { schemaVersion: 1, studentName: 'Linh', questionId: 'qid-1' } })],
      [],
    )
    renderTeacher()
    const questionRow = await screen.findByTestId('inbox-row-q1')
    expect(within(questionRow).getByTestId('inbox-row-q1-archive')).toBeInTheDocument()
  })

  test('AC7: Late chip refetches the queue with late_only=true (server-side filter)', async () => {
    const urls = useTeacherHandlers([], [queueItem('s1', { isLate: false }), queueItem('s2', { isLate: true })])
    renderTeacher()
    await screen.findByTestId('inbox-row-s1')
    // activate the Late chip (net-new 10-1c label key).
    fireEvent.click(screen.getByTestId('inbox-list-shell-filter-inboxList.filters.late'))
    // only the late row survives the server filter (keepPreviousData lingers during
    // the refetch, so wait for the on-time row to drop out).
    expect(await screen.findByTestId('inbox-row-s2')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('inbox-row-s1')).not.toBeInTheDocument())
    expect(urls.some((s) => s.includes('late_only=true'))).toBe(true)
  })

  test('AC9: the ungraded count surfaces IN-FEED (not the nav badge)', async () => {
    useTeacherHandlers([], [queueItem('s1'), queueItem('s2')])
    renderTeacher()
    await screen.findByTestId('inbox-row-s1')
    // the in-feed "N to grade" affordance carries the queue total (Q2 — NOT the badge).
    expect(screen.getByTestId('inbox-to-grade')).toHaveTextContent('2')
  })

  test('AC10: the teacher merged feed passes axe', async () => {
    useTeacherHandlers(
      [notif('q1', 'question_asked', { metadata: { schemaVersion: 1, studentName: 'Linh', questionId: 'qid-1' } })],
      [queueItem('s1', { overdue: true })],
    )
    const { container } = renderTeacher()
    await screen.findByTestId('inbox-row-s1')
    expect(await axe(container)).toHaveNoViolations()
  })
})
