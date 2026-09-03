// ATDD RED-PHASE — Story 7-1b, Task 6 (Owner-action wiring). AC11–15.
//
// RED signal: `@/features/people/components/OwnerActionsCard` does not exist yet.
//
// The card is already gated by the parent (StaffDetailPage renders it ONLY for
// an owner — see StaffDetailPage.test.tsx TEST-FE-6). This suite exercises the
// four action flows in isolation: assign-class · archive · reset-password ·
// force-logout, each confirm→mutate→toast, with the AC15 in-flight guard.
//
// Toast is asserted via a sonner module mock + toastSpy — the SHIPPED repo
// convention (ProfileTab.test.tsx). Mocking the notification library is NOT a
// violation of the one-HTTP-seam rule; MSW still owns every network call.
//
// ── SEAMS the dev must expose ──────────────────────────────────────────────
//   • action buttons named via people.staff.actions.{assignClass,resetPassword,
//     archive,forceLogout}
//   • each opens a confirm surface whose primary control has
//     data-testid="owner-action-confirm"
//   • archive confirm shows people.staff.archive.ghostWarning (count) when
//     assignedClasses.length > 0
//   • assign-class opens a class picker sourced from GET /api/classes; picking
//     a class + confirming POSTs /api/staff/{id}/assign-class { classId }
//   • toasts: success/error via sonner; copy via people.staff.* i18n keys
//   • the triggering control is disabled while its mutation isPending (AC15)
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import {
  authKeys,
  type Session,
  type UserSummary,
} from '@/features/auth/api/authKeys'
// RED: this module does not exist yet.
import { OwnerActionsCard } from '@/features/people/components/OwnerActionsCard'
import {
  DEFAULT_CENTER_ID,
  detailWithClasses,
  detailNoClasses,
  assignPickerClassesHandlers,
  assignClassHandlers,
  assignClass404Handlers,
  archiveHandlers,
  archiveSelfConflictHandlers,
  archiveAlreadyConflictHandlers,
  resetPasswordHandlers,
  forceLogoutHandlers,
} from '@/features/people/api/__tests__/handlers'

const toastSpy = vi.fn()
vi.mock('sonner', () => ({
  toast: Object.assign((...args: unknown[]) => toastSpy('generic', ...args), {
    success: (...args: unknown[]) => toastSpy('success', ...args),
    error: (...args: unknown[]) => toastSpy('error', ...args),
  }),
  Toaster: () => null,
}))

const STUB_USER: UserSummary = {
  id: 'user-owner',
  email: 'owner@example.com',
  fullName: 'Center Owner',
  emailVerified: true,
}

function seedOwner(): void {
  queryClient.setQueryData<Session>(authKeys.session(), {
    user: STUB_USER,
    accessToken: 'a.b.c',
    center: {
      id: DEFAULT_CENTER_ID,
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

function renderCard(detail = detailWithClasses) {
  seedOwner()
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <OwnerActionsCard detail={detail} />
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

const btn = (key: string) =>
  screen.getByRole('button', { name: i18n.t(`people.staff.actions.${key}`) })

beforeEach(() => {
  clearSession()
  toastSpy.mockClear()
})
afterEach(() => {
  clearSession()
  server.resetHandlers()
})

describe('OwnerActionsCard — AC13 reset password', () => {
  test('P1 confirm → 204 → success toast', async () => {
    server.use(...resetPasswordHandlers)
    const user = userEvent.setup()
    renderCard()
    await user.click(btn('resetPassword'))
    await user.click(await screen.findByTestId('owner-action-confirm'))
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith('success', i18n.t('people.staff.resetPassword.success')),
    )
  })
})

describe('OwnerActionsCard — AC14 force-logout', () => {
  test('P1 confirm → 200 → "N sessions revoked" toast (reuses shipped endpoint)', async () => {
    server.use(...forceLogoutHandlers())
    const user = userEvent.setup()
    renderCard()
    await user.click(btn('forceLogout'))
    await user.click(await screen.findByTestId('owner-action-confirm'))
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        'success',
        i18n.t('people.staff.forceLogout.success', { count: 3 }),
      ),
    )
  })
})

describe('OwnerActionsCard — AC12 archive', () => {
  test('P0 confirm shows the ghost warning with the assigned-class count', async () => {
    server.use(...archiveHandlers())
    const user = userEvent.setup()
    renderCard(detailWithClasses) // 2 assigned classes
    await user.click(btn('archive'))
    expect(
      await screen.findByText(
        i18n.t('people.staff.archive.ghostWarning', {
          count: detailWithClasses.assignedClasses.length,
        }),
      ),
    ).toBeInTheDocument()
  })

  test('P1 no ghost warning when the member owns zero classes', async () => {
    server.use(...archiveHandlers())
    const user = userEvent.setup()
    renderCard(detailNoClasses) // 0 assigned classes
    await user.click(btn('archive'))
    await screen.findByTestId('owner-action-confirm')
    expect(
      screen.queryByText(/still owns/i),
    ).not.toBeInTheDocument()
  })

  test('P0 confirm → success invalidates + toasts', async () => {
    server.use(...archiveHandlers())
    const user = userEvent.setup()
    renderCard()
    await user.click(btn('archive'))
    await user.click(await screen.findByTestId('owner-action-confirm'))
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith('success', expect.stringContaining(i18n.t('people.staff.archive.success'))),
    )
  })

  test.each([
    ['CANNOT_ARCHIVE_SELF', archiveSelfConflictHandlers, 'people.staff.archive.error.cannotArchiveSelf'],
    ['STAFF_ALREADY_ARCHIVED', archiveAlreadyConflictHandlers, 'people.staff.archive.error.alreadyArchived'],
  ] as const)('P1 409 %s maps to distinct toast copy', async (_code, handlers, key) => {
    server.use(...handlers)
    const user = userEvent.setup()
    renderCard()
    await user.click(btn('archive'))
    await user.click(await screen.findByTestId('owner-action-confirm'))
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith('error', i18n.t(key)),
    )
  })
})

describe('OwnerActionsCard — AC11 assign to class', () => {
  test('P0 pick a class + confirm → POST → success toast', async () => {
    server.use(...assignPickerClassesHandlers, ...assignClassHandlers())
    const user = userEvent.setup()
    renderCard()
    await user.click(btn('assignClass'))
    // Picker is sourced from GET /api/classes (D13).
    const picker = await screen.findByTestId('assign-class-picker')
    await user.click(within(picker).getByText('Assignable Class'))
    await user.click(await screen.findByTestId('owner-action-confirm'))
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith('success', expect.stringContaining(i18n.t('people.staff.assignClass.success'))),
    )
  })

  test('P1 404 CLASS_NOT_FOUND surfaces an error toast', async () => {
    server.use(...assignPickerClassesHandlers, ...assignClass404Handlers)
    const user = userEvent.setup()
    renderCard()
    await user.click(btn('assignClass'))
    const picker = await screen.findByTestId('assign-class-picker')
    await user.click(within(picker).getByText('Assignable Class'))
    await user.click(await screen.findByTestId('owner-action-confirm'))
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith('error', i18n.t('people.staff.assignClass.error.classNotFound')),
    )
  })
})

describe('OwnerActionsCard — AC15 in-flight guard', () => {
  test('P1 the confirm control is disabled while the mutation is pending (no double-submit)', async () => {
    // A hung POST holds the mutation in the pending state so the guard is observable.
    server.use(
      http.post('/api/admin/users/:userId/force-logout', async () => {
        await delay('infinite')
        return HttpResponse.json({ data: { forcedLogout: true, sessionsRevoked: 0 } })
      }),
    )
    const user = userEvent.setup()
    renderCard()
    await user.click(btn('forceLogout'))
    const confirm = await screen.findByTestId('owner-action-confirm')
    await user.click(confirm)
    // After the first click the control must disable to prevent a second submit.
    await waitFor(() => expect(confirm).toBeDisabled())
  })
})
