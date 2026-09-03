// ATDD RED-PHASE — Story 7-1b, Task 7 (s41 invite modal). AC16–19.
//
// RED signal: `@/features/people/components/InviteStaffModal` does not exist yet.
//
// Clone of ClassFormDialog: shadcn Dialog + RHF + zodResolver, always-mounted,
// parent-controlled via onClose (mirrors ClassFormDialogProps). centerId is
// read from the SESSION cache (D11/AC17), not passed as a prop.
//
// ── SEAMS the dev must expose ──────────────────────────────────────────────
//   • email textbox (required) with a "recipient sets own password" helper
//   • name textbox (optional); welcomeNote textbox (optional)
//   • RoleChipGroup with data-testid="role-chip-teacher" and "role-chip-admin"
//     ONLY — NO "role-chip-owner" anywhere in the DOM for any sender (D12/AC19)
//   • data-testid="invite-field-classId" present ONLY when role=teacher (AC17)
//   • footer copy via people.invite.footer.expiry ("expires in 7 days")
//   • submit button named people.invite.submit
//   • POST /api/centers/{centerId}/invites with classId sent ONLY when teacher
//   • 409 INVITE_EMAIL_TAKEN → people.invite.error.emailTaken on the email field
//   • 403 ROLE_ASSIGNMENT_FORBIDDEN → people.invite.error.roleAssignmentForbidden
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { axe } from 'vitest-axe'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import {
  authKeys,
  type Role,
  type Session,
  type UserSummary,
} from '@/features/auth/api/authKeys'
// RED: this module does not exist yet.
import { InviteStaffModal } from '@/features/people/components/InviteStaffModal'
import {
  DEFAULT_CENTER_ID,
  inviteHandlers,
  invite409EmailTakenHandlers,
  invite403RoleForbiddenHandlers,
  assignPickerClassesHandlers,
} from '@/features/people/api/__tests__/handlers'

const STUB_USER: UserSummary = {
  id: 'user-owner',
  email: 'owner@example.com',
  fullName: 'Center Owner',
  emailVerified: true,
}

function seedSession(role: Role): void {
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
    role,
  })
}

function clearSession(): void {
  queryClient.removeQueries({ queryKey: authKeys.session() })
}

function renderModal(role: Role = 'owner', onClose = vi.fn()) {
  seedSession(role)
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <InviteStaffModal onClose={onClose} />
      </QueryClientProvider>
    </I18nextProvider>,
  )
  return { onClose }
}

const emailLabel = () => i18n.t('people.invite.fields.email')
const submitName = () => i18n.t('people.invite.submit')

beforeEach(() => clearSession())
afterEach(() => {
  clearSession()
  server.resetHandlers()
})

describe('InviteStaffModal — AC16 fields', () => {
  test('P1 renders email (required) + name + welcomeNote + expiry footer', async () => {
    renderModal('owner')
    expect(await screen.findByRole('textbox', { name: emailLabel() })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: i18n.t('people.invite.fields.name') })).toBeInTheDocument()
    expect(
      screen.getByRole('textbox', { name: i18n.t('people.invite.fields.welcomeNote') }),
    ).toBeInTheDocument()
    expect(screen.getByText(i18n.t('people.invite.footer.expiry'))).toBeInTheDocument()
  })

  test('P0 axe: the modal has no accessibility violations (TEST-FE-5)', async () => {
    renderModal('owner')
    await screen.findByRole('textbox', { name: emailLabel() })
    const { container } = { container: document.body }
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('InviteStaffModal — AC19/D12 role chips (Teacher/Admin ONLY)', () => {
  test.each(['owner', 'admin'] as const)(
    'P0 %s sender sees exactly Teacher + Admin chips and NO owner chip',
    async (role) => {
      renderModal(role)
      await screen.findByRole('textbox', { name: emailLabel() })
      expect(screen.getByTestId('role-chip-teacher')).toBeInTheDocument()
      expect(screen.getByTestId('role-chip-admin')).toBeInTheDocument()
      // Negative: no Owner chip is rendered for ANY sender (Owner-invite deferred).
      expect(screen.queryByTestId('role-chip-owner')).not.toBeInTheDocument()
    },
  )
})

describe('InviteStaffModal — AC17 classId is teacher-only', () => {
  test('P0 classId field is present for role=teacher and absent for role=admin', async () => {
    const user = userEvent.setup()
    renderModal('owner')
    await screen.findByRole('textbox', { name: emailLabel() })

    // Teacher selected → classId affordance appears.
    await user.click(screen.getByTestId('role-chip-teacher'))
    expect(await screen.findByTestId('invite-field-classId')).toBeInTheDocument()

    // Switch to Admin → classId affordance is removed from the DOM.
    await user.click(screen.getByTestId('role-chip-admin'))
    await waitFor(() => {
      expect(screen.queryByTestId('invite-field-classId')).not.toBeInTheDocument()
    })
  })

  test('P0 submit omits classId when role=admin (payload contract)', async () => {
    let body: Record<string, unknown> | null = null
    let capturedCenterId: string | null = null
    server.use(
      http.post('/api/centers/:centerId/invites', async ({ request, params }) => {
        body = (await request.json()) as Record<string, unknown>
        capturedCenterId = params.centerId as string
        return HttpResponse.json({ data: { id: 'inv-1', email: 'a@b.co', role: 'admin', expiresAt: '2026-09-06T00:00:00Z' } }, { status: 201 })
      }),
    )
    const user = userEvent.setup()
    const { onClose } = renderModal('owner')
    await user.type(await screen.findByRole('textbox', { name: emailLabel() }), 'a@b.co')
    await user.click(screen.getByTestId('role-chip-admin'))
    await user.click(screen.getByRole('button', { name: submitName() }))

    await waitFor(() => expect(body).not.toBeNull())
    // centerId comes from the session cache, not user input (AC17).
    expect(capturedCenterId).toBe(DEFAULT_CENTER_ID)
    expect(body).toMatchObject({ email: 'a@b.co', role: 'admin' })
    expect(body).not.toHaveProperty('classId')
    // On 201 the modal closes (AC17).
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})

describe('InviteStaffModal — validation + error mapping (AC17/AC18)', () => {
  test('P1 empty email blocks submit with a required error (RHF + zodResolver)', async () => {
    server.use(...inviteHandlers())
    const user = userEvent.setup()
    const { onClose } = renderModal('owner')
    await screen.findByRole('textbox', { name: emailLabel() })
    await user.click(screen.getByRole('button', { name: submitName() }))
    // A validation message surfaces and the mutation never fires (modal stays open).
    expect(await screen.findByText(i18n.t('people.invite.error.emailRequired'))).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  test('P1 409 INVITE_EMAIL_TAKEN maps to the email-field error copy', async () => {
    server.use(...invite409EmailTakenHandlers)
    const user = userEvent.setup()
    renderModal('owner')
    await user.type(await screen.findByRole('textbox', { name: emailLabel() }), 'taken@example.com')
    await user.click(screen.getByTestId('role-chip-teacher'))
    await user.click(screen.getByRole('button', { name: submitName() }))
    expect(
      await screen.findByText(i18n.t('people.invite.error.emailTaken')),
    ).toBeInTheDocument()
  })

  test('P1 403 ROLE_ASSIGNMENT_FORBIDDEN maps to its i18n copy', async () => {
    server.use(...invite403RoleForbiddenHandlers)
    const user = userEvent.setup()
    renderModal('admin')
    await user.type(await screen.findByRole('textbox', { name: emailLabel() }), 'x@example.com')
    await user.click(screen.getByTestId('role-chip-admin'))
    await user.click(screen.getByRole('button', { name: submitName() }))
    expect(
      await screen.findByText(i18n.t('people.invite.error.roleAssignmentForbidden')),
    ).toBeInTheDocument()
  })
})

describe('InviteStaffModal — AC17 teacher payload includes classId', () => {
  test('P1 submit with role=teacher + a picked class sends classId', async () => {
    let body: Record<string, unknown> | null = null
    server.use(
      ...assignPickerClassesHandlers,
      http.post('/api/centers/:centerId/invites', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ data: { id: 'inv-2', email: 't@b.co', role: 'teacher', expiresAt: '2026-09-06T00:00:00Z' } }, { status: 201 })
      }),
    )
    const user = userEvent.setup()
    renderModal('owner')
    await user.type(await screen.findByRole('textbox', { name: emailLabel() }), 't@b.co')
    await user.click(screen.getByTestId('role-chip-teacher'))
    // Pick a class in the teacher-only classId affordance.
    const classField = await screen.findByTestId('invite-field-classId')
    await user.click(classField)
    await user.click(screen.getByRole('button', { name: submitName() }))
    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toMatchObject({ email: 't@b.co', role: 'teacher' })
    expect(body).toHaveProperty('classId')
  })
})
