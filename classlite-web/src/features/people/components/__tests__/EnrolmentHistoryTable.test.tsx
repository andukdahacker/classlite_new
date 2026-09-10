// ATDD RED-PHASE — Story 7-3b, Task 5 (EnrolmentHistoryTable). AC11–13.
//
// RED signal: `@/features/people/components/EnrolmentHistoryTable` does not
// exist yet (TS2307). No `test.skip()` — compile-fail red ([[reference_atdd_red_convention]]).
// MSW is the ONE mock seam (TEST-FE-1). The component self-fetches via
// useEnrolmentHistory → apiFetchWithMeta<EnrollmentHistoryEntry[], EnvelopeMetaPagination>
// GET /api/enrollments/history (pagination in TOP-LEVEL meta, D3/D12), newest-first.
//
// ── SEAMS the green EnrolmentHistoryTable must expose ──────────────────────
//   • data-testid="enrolment-history-table"          (raw <table>, slate idiom)
//   • data-testid="history-row-{id}"                  per row
//   • data-testid="history-action-{add|transfer|withdraw}" (Badge pill in the row)
//   • data-testid="history-cell-from-{id}" / "history-cell-to-{id}"  ("—" when null)
//   • the "By" cell renders people.enrolment.history.systemPerformer when performerName is null
//   • data-testid="history-pager"                     (when meta.pagination.total > pageSize)
//   • data-testid="history-filter-class" / "history-filter-student" (server-side ?class_id / ?student_id)
//   • data-testid="history-skeleton" (loading) / "history-empty" (empty)
//   • role="alert" inline error + retry on 500
//   • all copy via i18n keys under people.enrolment.history.* (TEST-FE-4); dates via the i18n formatter (TS-6)
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Session, type UserSummary } from '@/features/auth/api/authKeys'
import { classesHandlers } from '@/features/classes/api/__tests__/handlers'
import { centerRosterHandlers } from '@/features/people/api/__tests__/studentHandlers'
import {
  historyHandlers,
  historyEmptyHandlers,
  historyPagedHandlers,
  history500Handlers,
  HISTORY_ADD_ID,
  HISTORY_TRANSFER_ID,
  HISTORY_WITHDRAW_ID,
  HISTORY_GENESIS_ID,
} from '@/features/people/api/__tests__/enrolmentHandlers'
// RED: this module does not exist yet — the whole file fails to import.
import { EnrolmentHistoryTable } from '@/features/people/components/EnrolmentHistoryTable'

const STUB_USER: UserSummary = {
  id: 'user-owner',
  email: 'owner@example.com',
  fullName: 'Center Owner',
  emailVerified: true,
}

function seedSession(): void {
  queryClient.setQueryData<Session>(authKeys.session(), {
    user: STUB_USER,
    accessToken: 'a.b.c',
    center: {
      id: 'c-1',
      name: 'Saigon English Center',
      shortCode: 'saigon-english',
      brandColor: null,
      logoUrl: null,
      timezone: 'Asia/Ho_Chi_Minh',
    },
    role: 'owner',
  })
}

function clearSession(): void {
  queryClient.removeQueries({ queryKey: authKeys.session() })
}

function renderTable(): void {
  seedSession()
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <EnrolmentHistoryTable />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

beforeEach(() => {
  clearSession()
  // The class/student filters lazily fetch options; satisfy them.
  server.use(...classesHandlers, ...centerRosterHandlers())
})
afterEach(() => {
  clearSession()
  server.resetHandlers()
})

describe('EnrolmentHistoryTable — rows + action pills (AC11)', () => {
  test('P0 renders a row per history entry with a toned action pill', async () => {
    server.use(...historyHandlers())
    renderTable()
    expect(await screen.findByTestId('enrolment-history-table')).toBeInTheDocument()
    const addRow = screen.getByTestId(`history-row-${HISTORY_ADD_ID}`)
    expect(within(addRow).getByTestId('history-action-add')).toBeInTheDocument()
    expect(within(screen.getByTestId(`history-row-${HISTORY_TRANSFER_ID}`)).getByTestId('history-action-transfer')).toBeInTheDocument()
    expect(within(screen.getByTestId(`history-row-${HISTORY_WITHDRAW_ID}`)).getByTestId('history-action-withdraw')).toBeInTheDocument()
  })

  test('P0 a null performer renders the "System" label (genesis backfill row)', async () => {
    server.use(...historyHandlers())
    renderTable()
    const genesis = await screen.findByTestId(`history-row-${HISTORY_GENESIS_ID}`)
    expect(within(genesis).getByText(i18n.t('people.enrolment.history.systemPerformer'))).toBeInTheDocument()
  })

  test('P1 null from/to class names render an em-dash, not blank or "null"', async () => {
    server.use(...historyHandlers())
    renderTable()
    await screen.findByTestId('enrolment-history-table')
    // Add: fromClassName null → "—"; Withdraw: toClassName null → "—".
    expect(screen.getByTestId(`history-cell-from-${HISTORY_ADD_ID}`)).toHaveTextContent('—')
    expect(screen.getByTestId(`history-cell-to-${HISTORY_WITHDRAW_ID}`)).toHaveTextContent('—')
    // A populated class name is shown verbatim.
    expect(screen.getByTestId(`history-cell-from-${HISTORY_TRANSFER_ID}`)).toHaveTextContent('IELTS Writing 6.5')
  })
})

describe('EnrolmentHistoryTable — pagination + filters (AC12)', () => {
  test('P0 renders a pager when meta.pagination.total exceeds the page size', async () => {
    server.use(...historyPagedHandlers)
    renderTable()
    expect(await screen.findByTestId('history-pager')).toBeInTheDocument()
  })

  test('P0 selecting a class filter issues a SERVER-side read carrying ?class_id', async () => {
    const user = userEvent.setup()
    const seenUrls: string[] = []
    server.use(
      http.get('/api/enrollments/history', ({ request }) => {
        seenUrls.push(request.url)
        return HttpResponse.json({
          data: [],
          meta: { serverTime: '2026-09-09T00:00:00Z', pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } },
        })
      }),
    )
    renderTable()
    await screen.findByTestId('history-empty')
    // Open the class filter and pick a class → the next fetch must carry class_id.
    const filter = screen.getByTestId('history-filter-class')
    await user.click(within(filter).getAllByRole('option')[0] ?? filter)
    await new Promise((r) => setTimeout(r, 0))
    expect(seenUrls.some((u) => u.includes('class_id='))).toBe(true)
  })
})

describe('EnrolmentHistoryTable — trilogy (UX-1, TEST-FE-2)', () => {
  test('P0 renders row-shaped skeletons while loading', () => {
    server.use(...historyHandlers())
    renderTable()
    expect(screen.getByTestId('history-skeleton')).toBeInTheDocument()
  })

  test('P1 renders an empty state when there are no actions yet', async () => {
    server.use(...historyEmptyHandlers)
    renderTable()
    expect(await screen.findByTestId('history-empty')).toBeInTheDocument()
  })

  test('P0 renders an inline error alert on 500', async () => {
    server.use(...history500Handlers)
    renderTable()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
