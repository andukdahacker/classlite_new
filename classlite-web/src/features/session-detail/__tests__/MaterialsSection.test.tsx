// Story 3.5 — MaterialsSection: the link-only rendering path is NOT shared
// factory code, and the href scheme guard (Round-1 Chunk-2 review) is
// security-sensitive, so it gets dedicated coverage here (TEST-FE-1/2: real
// QueryClient, MSW at the HTTP boundary).
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import { MaterialsSection } from '@/features/session-detail/components/MaterialsSection'

const SESSION_ID = '11111111-1111-1111-1111-111111111111'
const CENTER_ID = '00000000-0000-0000-0000-000000000001'

function materialRow(id: string, title: string, url: string) {
  const iso = new Date().toISOString()
  return { id, centerId: CENTER_ID, sessionId: SESSION_ID, title, url, kind: 'link', createdAt: iso, updatedAt: iso }
}

function renderMaterials() {
  const client = createTestQueryClient()
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MaterialsSection sessionId={SESSION_ID} />
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

afterEach(() => server.resetHandlers())

describe('MaterialsSection — link rendering', () => {
  test('renders an http(s) material as a real anchor with a safe href', async () => {
    server.use(
      http.get('*/api/sessions/:id/materials', () =>
        HttpResponse.json({
          data: [materialRow('m1', 'Grammar sheet', 'https://example.com/g.pdf')],
          meta: { serverTime: new Date().toISOString() },
        }),
      ),
    )
    renderMaterials()
    const link = await screen.findByRole('link', { name: 'Grammar sheet' })
    expect(link).toHaveAttribute('href', 'https://example.com/g.pdf')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  test('does NOT render a non-http(s) url as a live href (javascript: XSS guard)', async () => {
    server.use(
      http.get('*/api/sessions/:id/materials', () =>
        HttpResponse.json({
          data: [materialRow('m2', 'Sneaky', 'javascript:alert(document.cookie)')],
          meta: { serverTime: new Date().toISOString() },
        }),
      ),
    )
    renderMaterials()
    // Title still shown...
    expect(await screen.findByText('Sneaky')).toBeInTheDocument()
    // ...but never as an anchor — no javascript: href is emitted.
    expect(screen.queryByRole('link', { name: 'Sneaky' })).not.toBeInTheDocument()
  })
})
