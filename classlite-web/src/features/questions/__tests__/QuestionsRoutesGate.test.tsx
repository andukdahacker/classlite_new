/**
 * QuestionsRoutesGate tests (Story 7.4b, AC12 · TEST-FE-6). The teacher console
 * is reachable only by teachers; for Student / Owner / Admin the RouteRoleGate
 * renders PermissionDenied and the console is ABSENT from the DOM (not merely
 * hidden) — asserted via the rail testid being null.
 */
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import RouteRoleGate from '@/components/shared/RouteRoleGate'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Role, type Session } from '@/features/auth/api/authKeys'
import { QuestionsConsolePage } from '../QuestionsConsolePage'
import { listEmptyHandlers } from '../api/__tests__/questionHandlers'

const CENTER_ID = '00000000-0000-0000-0000-0000000000c1'

function seedSession(role: Role): void {
  queryClient.setQueryData<Session>(authKeys.session(), {
    user: { id: 'u1', email: 'u1@example.com', fullName: 'User One', emailVerified: true },
    accessToken: 'a.b.c',
    center: {
      id: CENTER_ID,
      name: 'Saigon English Center',
      shortCode: 'saigon-english',
      brandColor: null,
      logoUrl: null,
      timezone: 'Asia/Ho_Chi_Minh',
    },
    role,
  })
}

function renderGatedConsole(role: Role): void {
  seedSession(role)
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/questions']}>
          <Routes>
            <Route
              element={
                <RouteRoleGate
                  allowedRoles={['teacher']}
                  requiredRolesForCopy={['teacher']}
                  sectionNameKey="questions"
                />
              }
            >
              <Route path="/questions" element={<QuestionsConsolePage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

beforeEach(() => {
  queryClient.removeQueries({ queryKey: authKeys.session() })
})
afterEach(() => {
  queryClient.removeQueries({ queryKey: authKeys.session() })
  server.resetHandlers()
})

describe('QuestionsRoutesGate', () => {
  test('teacher reaches the console', async () => {
    server.use(...listEmptyHandlers)
    renderGatedConsole('teacher')
    await screen.findByTestId('anchored-questions-rail')
  })

  test.each<Role>(['student', 'owner', 'admin'])(
    'console is absent from the DOM for %s (TEST-FE-6)',
    (role) => {
      renderGatedConsole(role)
      expect(screen.queryByTestId('anchored-questions-rail')).not.toBeInTheDocument()
      expect(screen.queryByTestId('questions-console-skeleton')).not.toBeInTheDocument()
    },
  )
})
