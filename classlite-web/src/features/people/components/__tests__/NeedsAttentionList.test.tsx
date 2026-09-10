// ATDD RED-PHASE — Story 7-3b, Task 4 (NeedsAttentionList). AC8–10.
//
// RED signal: `@/features/people/components/NeedsAttentionList` does not exist
// yet (TS2307). No `test.skip()` — compile-fail red ([[reference_atdd_red_convention]]).
// MSW is the ONE mock seam (TEST-FE-1). The component self-fetches via
// useNeedsAttention → GET /api/enrollments/attention (each zone independently
// paginated — pagination nested INSIDE data per zone, D11).
//
// ── SEAMS the green NeedsAttentionList must expose ─────────────────────────
//   • data-testid="needs-attention-unassigned"      (amber zone container)
//   • data-testid="unassigned-row-{studentId}"       (name + email)
//   • an "Add" affordance per unassigned row → calls onAddStudent(studentId) (AC9)
//   • data-testid="unassigned-pager"                 (when the zone total > pageSize)
//   • data-testid="needs-attention-over-capacity"    (red zone container)
//   • data-testid="over-capacity-row-{classId}"      (className + "activeCount/capacity")
//   • data-testid="needs-attention-skeleton" (loading) / "-empty" (both zones empty)
//   • role="alert" inline error + retry on 500
//   • all copy via i18n keys under people.enrolment.attention.* (TEST-FE-4)
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Session, type UserSummary } from '@/features/auth/api/authKeys'
import {
  attentionHandlers,
  attentionEmptyHandlers,
  attentionUnassignedPagedHandlers,
  attention500Handlers,
  attentionStudent,
  overCapacityClass,
  needsAttention,
  CLASS_OVER_CAP_ID,
} from '@/features/people/api/__tests__/enrolmentHandlers'
// RED: this module does not exist yet — the whole file fails to import.
import { NeedsAttentionList } from '@/features/people/components/NeedsAttentionList'

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

function renderList(onAddStudent = vi.fn()): { onAddStudent: ReturnType<typeof vi.fn> } {
  seedSession()
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <NeedsAttentionList onAddStudent={onAddStudent} />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
  return { onAddStudent }
}

beforeEach(() => clearSession())
afterEach(() => {
  clearSession()
  server.resetHandlers()
})

describe('NeedsAttentionList — two zones (AC8)', () => {
  test('P0 renders the amber unassigned zone with name + email', async () => {
    server.use(...attentionHandlers())
    renderList()
    const zone = await screen.findByTestId('needs-attention-unassigned')
    const row = within(zone).getByTestId(`unassigned-row-${attentionStudent().studentId}`)
    expect(within(row).getByText('Unassigned Student')).toBeInTheDocument()
    expect(within(row).getByText('unassigned@example.com')).toBeInTheDocument()
  })

  test('P0 renders the red over-capacity zone with an "activeCount/capacity" ratio', async () => {
    server.use(...attentionHandlers())
    renderList()
    const zone = await screen.findByTestId('needs-attention-over-capacity')
    const row = within(zone).getByTestId(`over-capacity-row-${CLASS_OVER_CAP_ID}`)
    expect(within(row).getByText('IELTS Speaking Intensive')).toBeInTheDocument()
    expect(within(row).getByText('12/10')).toBeInTheDocument()
  })
})

describe('NeedsAttentionList — actions (AC9, AC10)', () => {
  test('P0 an unassigned row "Add" affordance calls onAddStudent with the studentId', async () => {
    const user = userEvent.setup()
    server.use(...attentionHandlers())
    const { onAddStudent } = renderList()
    const row = await screen.findByTestId(`unassigned-row-${attentionStudent().studentId}`)
    await user.click(within(row).getByRole('button', { name: new RegExp(i18n.t('people.enrolment.attention.addAction'), 'i') }))
    expect(onAddStudent).toHaveBeenCalledWith(attentionStudent().studentId)
  })

  test('P1 the over-capacity zone is informational — no enroll/block action button (AC10)', async () => {
    server.use(...attentionHandlers())
    renderList()
    const row = await screen.findByTestId(`over-capacity-row-${CLASS_OVER_CAP_ID}`)
    expect(within(row).queryByRole('button')).not.toBeInTheDocument()
  })

  test('P1 the unassigned zone renders its own pager when its total exceeds the page size (D11)', async () => {
    server.use(...attentionUnassignedPagedHandlers)
    renderList()
    expect(await screen.findByTestId('unassigned-pager')).toBeInTheDocument()
  })
})

describe('NeedsAttentionList — trilogy (UX-1, TEST-FE-2)', () => {
  test('P0 renders a skeleton while loading', () => {
    server.use(...attentionHandlers())
    renderList()
    expect(screen.getByTestId('needs-attention-skeleton')).toBeInTheDocument()
  })

  test('P1 renders an empty state when both zones are empty', async () => {
    server.use(...attentionEmptyHandlers)
    renderList()
    expect(await screen.findByTestId('needs-attention-empty')).toBeInTheDocument()
  })

  test('P0 renders an inline error alert on 500', async () => {
    server.use(...attention500Handlers)
    renderList()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  test('P1 an over-capacity-only response still renders (no unassigned rows)', async () => {
    server.use(
      ...attentionHandlers(needsAttention({ unassigned: [], overCapacity: [overCapacityClass()] })),
    )
    renderList()
    expect(await screen.findByTestId(`over-capacity-row-${CLASS_OVER_CAP_ID}`)).toBeInTheDocument()
    expect(screen.queryByTestId(/^unassigned-row-/)).not.toBeInTheDocument()
  })
})
