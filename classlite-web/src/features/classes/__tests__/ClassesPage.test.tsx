// ATDD RED-PHASE — Story 3.1, Tasks 0/6 (AC5 frontend, TEST-FE-6).
//
// RED signal: `@/features/classes/ClassesPage` does not exist yet (TS2307 /
// Vitest import failure). Everything else here is valid — the only missing
// symbol is the page under construction.
//
// AC5: the /classes index is role-scoped. A teacher's response contains ONLY
// their own classes; another teacher's class MUST be ABSENT from the DOM
// (TEST-FE-6 negative assertion). Owner/admin see all center classes. Server
// scoping is modeled by swapping the MSW payload per role (the FE calls the
// same GET /api/classes; the server branches on tc.Role).
//
// Role is seeded on the MODULE-SINGLETON queryClient via
// setQueryData(authKeys.session(), ...) — NOT RoleProvider — because
// useRole/useCurrentCenter read the singleton, and RoleProvider bypasses the
// load-bearing session→useRole chain [Murat-INFO-2, per AppLayout.role-filtering.test].
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import {
  authKeys,
  type Role,
  type Session,
  type UserSummary,
} from '@/features/auth/api/authKeys'
import { ClassesPage } from '@/features/classes/ClassesPage'
import {
  DEFAULT_CENTER_ID,
  TEACHER_A_ID,
  classTeacherA,
  classTeacherB,
  classesHandlers,
  errorHandlers,
  teacherScopedClassesHandlers,
} from '@/features/classes/api/__tests__/handlers'

const STUB_USER: UserSummary = {
  id: TEACHER_A_ID,
  email: 'teacher-a@example.com',
  fullName: 'Teacher A',
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

function renderClassesPage(role: Role): void {
  seedSession(role)
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/classes']}>
          <Routes>
            <Route path="/classes" element={<ClassesPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

beforeEach(() => {
  clearSession()
})

afterEach(() => {
  clearSession()
  server.resetHandlers()
})

describe('ClassesPage — AC5 three-state trilogy', () => {
  test('renders skeleton rows while loading', () => {
    server.use(...classesHandlers)
    renderClassesPage('owner')
    const skeletons = screen.getAllByTestId(/^class-row-skeleton/)
    expect(skeletons.length).toBeGreaterThanOrEqual(1)
  })

  test('renders class rows on success (owner scope)', async () => {
    server.use(...classesHandlers)
    renderClassesPage('owner')
    expect(await screen.findByText(classTeacherA.name)).toBeInTheDocument()
    expect(await screen.findByText(classTeacherB.name)).toBeInTheDocument()
  })

  test('renders inline error alert when GET /api/classes fails', async () => {
    server.use(errorHandlers.listClasses500())
    renderClassesPage('owner')
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})

describe('ClassesPage — AC5 role-scoped visibility (TEST-FE-6)', () => {
  test('teacher sees only own class; another teacher class ABSENT from DOM', async () => {
    server.use(...teacherScopedClassesHandlers)
    renderClassesPage('teacher')

    // Own class present.
    expect(await screen.findByText(classTeacherA.name)).toBeInTheDocument()

    // Negative assertion: the other teacher's class is not merely hidden — it is
    // absent from the DOM entirely (the teacher-scoped payload never contains it).
    await waitFor(() => {
      expect(screen.queryByText(classTeacherB.name)).not.toBeInTheDocument()
    })
  })

  test('owner sees another teacher class (positive counterpart)', async () => {
    server.use(...classesHandlers)
    renderClassesPage('owner')
    expect(await screen.findByText(classTeacherB.name)).toBeInTheDocument()
  })
})
