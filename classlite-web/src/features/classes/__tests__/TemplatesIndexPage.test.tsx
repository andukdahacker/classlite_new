// ATDD RED-PHASE — Story 3.3, Task 0 (AC1 role gate, TEST-FE-6).
//
// RED signal: `@/features/classes/TemplatesIndexPage` does not exist yet (TS2307 /
// Vitest import failure). Everything else here is valid — the only missing symbol
// is the page under construction.
//
// AC1: the templates management surface (s19) is gated owner+admin via the
// shipped RouteRoleGate. This asserts BOTH sides of TEST-FE-6:
//   • owner sees the template rows (positive), and
//   • a teacher gets PermissionDenied with the template rows ABSENT from the DOM
//     (negative — not merely hidden).
//
// Role is seeded on the MODULE-SINGLETON queryClient via setQueryData(
// authKeys.session(), ...) — NOT RoleProvider — because useRole reads the
// singleton and RouteRoleGate branches on it (same pattern as ClassesPage.test).
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Role, type Session, type UserSummary } from '@/features/auth/api/authKeys'
import RouteRoleGate from '@/components/shared/RouteRoleGate'
// RED: this module lands in Story 3.3 Task 9.
import { TemplatesIndexPage } from '@/features/classes/TemplatesIndexPage'
import {
  DEFAULT_CENTER_ID,
  templateSeed,
  templateCustom,
  templatesHandlers,
} from '@/features/classes/api/__tests__/handlers'

const STUB_USER: UserSummary = {
  id: 'user-under-test',
  email: 'user@example.com',
  fullName: 'Test User',
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

/** Render the s19 index behind the SAME owner+admin gate wired in routes.tsx. */
function renderTemplatesIndex(role: Role): void {
  seedSession(role)
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/classes/templates']}>
          <Routes>
            <Route
              element={
                <RouteRoleGate
                  allowedRoles={['owner', 'admin']}
                  requiredRolesForCopy={['owner', 'admin']}
                  sectionNameKey="classes"
                />
              }
            >
              <Route path="/classes/templates" element={<TemplatesIndexPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

beforeEach(() => {
  clearSession()
  server.use(...templatesHandlers)
})

afterEach(() => {
  clearSession()
  server.resetHandlers()
})

describe('TemplatesIndexPage — AC1 role gate (TEST-FE-6)', () => {
  test('owner sees the template rows', async () => {
    renderTemplatesIndex('owner')
    expect(await screen.findByText(templateSeed.name)).toBeInTheDocument()
    expect(screen.getByText(templateCustom.name)).toBeInTheDocument()
  })

  test('admin sees the template rows', async () => {
    renderTemplatesIndex('admin')
    expect(await screen.findByText(templateCustom.name)).toBeInTheDocument()
  })

  test('teacher is denied — template rows ABSENT from the DOM (not hidden)', async () => {
    renderTemplatesIndex('teacher')
    // The gate resolves to PermissionDenied; the management rows must never mount.
    await waitFor(() => {
      expect(screen.queryByText(templateSeed.name)).not.toBeInTheDocument()
      expect(screen.queryByText(templateCustom.name)).not.toBeInTheDocument()
    })
  })
})
