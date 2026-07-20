// Story 3.1 (TEST-FE-5) — axe accessibility audit of the /classes index.
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { axe } from 'vitest-axe'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import { ClassesPage } from '../ClassesPage'
import {
  DEFAULT_CENTER_ID,
  TEACHER_A_ID,
  classTeacherA,
  classesHandlers,
} from '../api/__tests__/handlers'

function seedOwner(): void {
  queryClient.setQueryData<Session>(authKeys.session(), {
    user: {
      id: TEACHER_A_ID,
      email: 'owner@example.com',
      fullName: 'Owner',
      emailVerified: true,
    },
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

beforeEach(() => {
  queryClient.removeQueries({ queryKey: authKeys.session() })
})
afterEach(() => {
  queryClient.removeQueries({ queryKey: authKeys.session() })
  server.resetHandlers()
})

test('classes index has no axe violations (owner scope)', async () => {
  seedOwner()
  server.use(...classesHandlers)
  const client = createTestQueryClient()
  const { container } = render(
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
  await screen.findByText(classTeacherA.name)
  expect(await axe(container)).toHaveNoViolations()
})
