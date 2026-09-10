// ATDD RED-PHASE — Story 7-3b, Task 3 (EnrolmentComposer). AC3–7.
//
// RED signal: `@/features/people/components/EnrolmentComposer` does not exist
// yet (TS2307). Every other symbol is real. No `test.skip()` — repo convention
// is compile-fail red ([[reference_atdd_red_convention]]). MSW is the ONE mock
// seam (TEST-FE-1 — never mock useQuery/useMutation).
//
// The composer self-fetches: student options via GET /api/students
// (useStudentRoster) and target-class options via GET /api/classes (useClasses).
// Source-class resolution reads off the SELECTED student's roster item
// (StudentListItem.enrolledClasses / activeEnrollmentCount — D8), no extra fetch.
//
// ── SEAMS the green EnrolmentComposer must expose ──────────────────────────
//   • data-testid="enrolment-student-combobox"  → opens a list of role="option",
//        each named by the student's name (cmdk Command; fallback listbox is fine)
//   • data-testid="enrolment-action-add" | "-transfer" | "-withdraw"  (ToggleGroup)
//   • data-testid="enrolment-target-class-picker"  role="listbox" of role="option"
//        named by class name (Add/Transfer only; reuses the AssignClassPanel idiom)
//   • data-testid="enrolment-source-class"          (read-only, when exactly 1 active)
//   • data-testid="enrolment-source-class-picker"   (role="listbox", when >1 active)
//   • data-testid="enrolment-effective-date"        (<input type="date">, default today, max today)
//   • data-testid="enrolment-note"                  (<textarea>)
//   • data-testid="enrolment-submit"                (disabled until the action's schema validates / while pending)
//   • data-testid="enrolment-transfer-withdraw-disabled-hint" (shown when selected student is unassigned)
//   • all copy via i18n keys under people.enrolment.* (TEST-FE-4); error copy under people.enrolment.error.*
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import {
  authKeys,
  type Session,
  type UserSummary,
} from '@/features/auth/api/authKeys'
import {
  centerRosterHandlers,
  rosterCenter,
  studentNormal,
  studentGood,
  studentUnassigned,
} from '@/features/people/api/__tests__/studentHandlers'
import {
  actionAddHandlers,
  actionClassNotEnrollable422,
  actionInsufficientRole403,
  enrolmentClassesHandlers,
  CLASS_A_ID,
} from '@/features/people/api/__tests__/enrolmentHandlers'
// RED: this module does not exist yet — the whole file fails to import.
import { EnrolmentComposer } from '@/features/people/components/EnrolmentComposer'

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

function renderComposer(): void {
  seedSession()
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <EnrolmentComposer />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

/** Open the student combobox and pick a student by name. */
async function pickStudent(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
  await user.click(screen.getByTestId('enrolment-student-combobox'))
  const option = await screen.findByRole('option', { name: new RegExp(name, 'i') })
  await user.click(option)
}

async function pickTargetClass(
  user: ReturnType<typeof userEvent.setup>,
  className: string,
): Promise<void> {
  const picker = await screen.findByTestId('enrolment-target-class-picker')
  await user.click(within(picker).getByRole('option', { name: new RegExp(className, 'i') }))
}

beforeEach(() => {
  clearSession()
  server.use(...centerRosterHandlers(rosterCenter), ...enrolmentClassesHandlers)
})
afterEach(() => {
  clearSession()
  server.resetHandlers()
})

describe('EnrolmentComposer — fields + action toggle (AC3, AC4)', () => {
  test('P0 renders the student combobox, action toggle, effective-date and note', async () => {
    renderComposer()
    expect(await screen.findByTestId('enrolment-student-combobox')).toBeInTheDocument()
    expect(screen.getByTestId('enrolment-action-add')).toBeInTheDocument()
    expect(screen.getByTestId('enrolment-action-transfer')).toBeInTheDocument()
    expect(screen.getByTestId('enrolment-action-withdraw')).toBeInTheDocument()
    expect(screen.getByTestId('enrolment-effective-date')).toBeInTheDocument()
    expect(screen.getByTestId('enrolment-note')).toBeInTheDocument()
  })

  test('P1 the effective-date input caps at today (no future dates, D10)', async () => {
    renderComposer()
    const date = await screen.findByTestId('enrolment-effective-date')
    // Backend 422s effectiveDate > server-today; the client mirror is a max attr.
    expect(date).toHaveAttribute('type', 'date')
    expect(date).toHaveAttribute('max')
  })

  test('P0 Add shows a target-class picker and NO source-class field', async () => {
    const user = userEvent.setup()
    renderComposer()
    await pickStudent(user, studentNormal.name)
    // default action = Add
    expect(await screen.findByTestId('enrolment-target-class-picker')).toBeInTheDocument()
    expect(screen.queryByTestId('enrolment-source-class')).not.toBeInTheDocument()
    expect(screen.queryByTestId('enrolment-source-class-picker')).not.toBeInTheDocument()
  })
})

describe('EnrolmentComposer — source-class resolution (AC5, D8)', () => {
  test('P0 an unassigned student disables Transfer and Withdraw (only Add applies)', async () => {
    const user = userEvent.setup()
    renderComposer()
    await pickStudent(user, studentUnassigned.name) // activeEnrollmentCount === 0
    expect(screen.getByTestId('enrolment-action-transfer')).toBeDisabled()
    expect(screen.getByTestId('enrolment-action-withdraw')).toBeDisabled()
    expect(
      await screen.findByTestId('enrolment-transfer-withdraw-disabled-hint'),
    ).toBeInTheDocument()
  })

  test('P1 a single-class student auto-selects the source (read-only) for Transfer', async () => {
    const user = userEvent.setup()
    renderComposer()
    await pickStudent(user, studentNormal.name) // exactly 1 active class (cls-1)
    await user.click(screen.getByTestId('enrolment-action-transfer'))
    const source = await screen.findByTestId('enrolment-source-class')
    expect(source).toHaveTextContent(/IELTS Writing 6\.5/i)
    expect(screen.queryByTestId('enrolment-source-class-picker')).not.toBeInTheDocument()
  })

  test('P1 a multi-class student shows a source-class picker for Transfer', async () => {
    const user = userEvent.setup()
    renderComposer()
    await pickStudent(user, studentGood.name) // 2 active classes (cls-1, cls-2)
    await user.click(screen.getByTestId('enrolment-action-transfer'))
    const picker = await screen.findByTestId('enrolment-source-class-picker')
    expect(within(picker).getAllByRole('option').length).toBeGreaterThanOrEqual(2)
  })
})

describe('EnrolmentComposer — submit gating + wire shape (AC3, AC6)', () => {
  test('P0 Submit is disabled until a valid Add (student + target class)', async () => {
    const user = userEvent.setup()
    renderComposer()
    expect(await screen.findByTestId('enrolment-submit')).toBeDisabled()
    await pickStudent(user, studentNormal.name)
    expect(screen.getByTestId('enrolment-submit')).toBeDisabled() // no target class yet
    await pickTargetClass(user, 'IELTS Writing 6.5')
    await waitFor(() => expect(screen.getByTestId('enrolment-submit')).toBeEnabled())
  })

  test('P0 a valid Add POSTs an explicit action + toClassId (never the legacy classId alias)', async () => {
    const user = userEvent.setup()
    const onBody = vi.fn()
    server.use(...actionAddHandlers(onBody))
    renderComposer()
    await pickStudent(user, studentNormal.name)
    await pickTargetClass(user, 'IELTS Writing 6.5')
    await user.click(screen.getByTestId('enrolment-submit'))
    await waitFor(() => expect(onBody).toHaveBeenCalledTimes(1))
    const body = onBody.mock.calls[0][0]
    expect(body.action).toBe('add')
    expect(body.studentId).toBe(studentNormal.studentId)
    expect(body.toClassId).toBe(CLASS_A_ID)
    expect(body.classId ?? null).toBeNull() // legacy alias must NOT be sent
  })

  test('P0 on success the composer resets (student cleared)', async () => {
    const user = userEvent.setup()
    server.use(...actionAddHandlers())
    renderComposer()
    await pickStudent(user, studentNormal.name)
    await pickTargetClass(user, 'IELTS Writing 6.5')
    await user.click(screen.getByTestId('enrolment-submit'))
    // After a 201 the target picker collapses (no student selected) and Submit re-disables.
    await waitFor(() => expect(screen.getByTestId('enrolment-submit')).toBeDisabled())
  })
})

describe('EnrolmentComposer — error mapping + guards (AC7)', () => {
  test('P0 every 7-3a error code has i18n copy in en + vi', () => {
    const codes = [
      'classNotEnrollable',
      'notEnrolledInSource',
      'notAStudentMember',
      'validationError',
      'alreadyEnrolled',
      'classNotFound',
      'insufficientRole',
    ]
    for (const lng of ['en', 'vi'] as const) {
      for (const code of codes) {
        expect(i18n.exists(`people.enrolment.error.${code}`, { lng })).toBe(true)
      }
    }
  })

  test('P0 a CLASS_NOT_ENROLLABLE rejection does NOT reset the form (student stays selected, submit re-enabled)', async () => {
    const user = userEvent.setup()
    server.use(...actionClassNotEnrollable422)
    renderComposer()
    await pickStudent(user, studentNormal.name)
    await pickTargetClass(user, 'IELTS Writing 6.5')
    await user.click(screen.getByTestId('enrolment-submit'))
    // The failed action keeps context so the admin can correct it — not a reset.
    await waitFor(() => expect(screen.getByTestId('enrolment-submit')).toBeEnabled())
    expect(screen.getByTestId('enrolment-target-class-picker')).toBeInTheDocument()
  })

  test('P1 a 403 INSUFFICIENT_ROLE surfaces the mapped error, not a raw code', async () => {
    const user = userEvent.setup()
    server.use(...actionInsufficientRole403)
    renderComposer()
    await pickStudent(user, studentNormal.name)
    await pickTargetClass(user, 'IELTS Writing 6.5')
    await user.click(screen.getByTestId('enrolment-submit'))
    // The literal HTTP code / envelope code must never reach the DOM (CQ-5/UX-1).
    await waitFor(() => expect(screen.getByTestId('enrolment-submit')).toBeEnabled())
    expect(screen.queryByText(/INSUFFICIENT_ROLE/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\b403\b/)).not.toBeInTheDocument()
  })

  test('P1 self-transfer (source === target) is blocked client-side, no POST fires', async () => {
    const user = userEvent.setup()
    const onBody = vi.fn()
    server.use(...actionAddHandlers(onBody)) // would answer 201 IF a POST leaked through
    renderComposer()
    await pickStudent(user, studentNormal.name) // 1 active class = cls-1
    await user.click(screen.getByTestId('enrolment-action-transfer'))
    // source auto-resolves to cls-1; choosing cls-1 as target must be rejected pre-submit.
    await pickTargetClass(user, 'IELTS Writing 6.5')
    await waitFor(() => expect(screen.getByTestId('enrolment-submit')).toBeDisabled())
    expect(onBody).not.toHaveBeenCalled()
  })
})

describe('EnrolmentComposer — accessibility (AC15, TEST-FE-5)', () => {
  test('P0 the compose form has no axe violations', async () => {
    const { container } = (() => {
      seedSession()
      const client = createTestQueryClient()
      return render(
        <I18nextProvider i18n={i18n}>
          <QueryClientProvider client={client}>
            <MemoryRouter>
              <EnrolmentComposer />
            </MemoryRouter>
          </QueryClientProvider>
        </I18nextProvider>,
      )
    })()
    await screen.findByTestId('enrolment-student-combobox')
    expect(await axe(container)).toHaveNoViolations()
  })
})
