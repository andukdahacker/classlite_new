/* eslint-disable react-refresh/only-export-components -- test-only harness; it
   deliberately exports render helpers alongside fixtures, and Fast Refresh does
   not apply to test files. */
/**
 * Shared render harness for Knowledge Hub component tests (Story 4.4b). Mirrors
 * the exercises test harness: real QueryClient + real i18n + MemoryRouter, MSW
 * at the HTTP boundary (never mock Query — TEST-FE-1). The session (role +
 * center) is seeded into the module-singleton `queryClient` that `useRole` and
 * the page's session snapshot read from.
 */
import { type ReactElement } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import i18n from '@/lib/i18n'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import {
  authKeys,
  type Role,
  type Session,
  type UserSummary,
} from '@/features/auth/api/authKeys'
import type { components } from '@/lib/api/client'

export const CENTER_ID = 'c-kh-1'
export const OWNER_ID = 'user-kh-owner'
const FIXED_TIME = '2026-07-30T00:00:00Z'

type FileWire = components['schemas']['File']
type FolderWire = components['schemas']['Folder']

const STUB_USER: UserSummary = {
  id: OWNER_ID,
  email: 'owner@example.com',
  fullName: 'Owner',
  emailVerified: true,
}

export function seedSession(role: Role): void {
  queryClient.setQueryData<Session>(authKeys.session(), {
    user: STUB_USER,
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

export function clearSession(): void {
  queryClient.removeQueries({ queryKey: authKeys.session() })
}

export function folder(overrides: Partial<FolderWire> = {}): FolderWire {
  return {
    id: 'f-' + Math.random().toString(36).slice(2, 8),
    centerId: CENTER_ID,
    parentFolderId: null,
    name: 'Folder',
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    ...overrides,
  }
}

export function file(overrides: Partial<FileWire> = {}): FileWire {
  return {
    id: 'file-' + Math.random().toString(36).slice(2, 8),
    centerId: CENTER_ID,
    folderId: null,
    name: 'doc.pdf',
    slug: 'doc-' + Math.random().toString(36).slice(2, 8),
    objectKey: `${CENTER_ID}/knowledge/${Math.random().toString(36).slice(2, 8)}.pdf`,
    contentType: 'application/pdf',
    sizeBytes: 1024,
    uploadedBy: OWNER_ID,
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    ...overrides,
  }
}

/** Render a component at a route with the standard providers + a seeded role. */
export function renderAt(
  role: Role,
  path: string,
  routes: ReactElement,
): ReturnType<typeof render> {
  seedSession(role)
  const client = createTestQueryClient()
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>{routes}</MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

/** Render a non-routed component directly with the standard providers + role. */
export function renderComponent(role: Role, ui: ReactElement): ReturnType<typeof render> {
  seedSession(role)
  const client = createTestQueryClient()
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter>{ui}</MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

export { Route, Routes }
