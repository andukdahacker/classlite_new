// Story 4.4b (AC5, TEST-FE-1/2/5) — file detail + preview fallbacks. The
// mandatory SVG-sandbox case proves an uploaded SVG is rendered through an
// <img> (never inline <svg> / <object>), so a script payload can't execute.
// Also: WebM "Download to play" fallback, the universal "Preview unavailable"
// error leg, linked locations, metadata, trilogy, axe.
import { screen, waitFor } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { axe } from 'vitest-axe'
import { server } from '@/test/msw-server'
import { KnowledgeFileDetailPage } from '@/features/knowledge-hub/KnowledgeFileDetailPage'
import { clearSession, file as makeFile, renderAt, Route, Routes } from './harness'

const DOWNLOAD_URL = 'https://r2.test/get/object'

function detailHandler(overrides: Parameters<typeof makeFile>[0], links: unknown[] = []) {
  const f = makeFile(overrides)
  return http.get('/api/knowledge-hub/files/:slug', () =>
    HttpResponse.json({ data: { ...f, linkedLocations: links } }),
  )
}
function downloadOk() {
  return http.get('/api/knowledge-hub/files/:slug/download', () =>
    HttpResponse.json({ data: { url: DOWNLOAD_URL } }),
  )
}

function routes() {
  return (
    <Routes>
      <Route path="/knowledge-hub" element={<div>hub</div>} />
      <Route path="/knowledge-hub/files/:slug" element={<KnowledgeFileDetailPage />} />
    </Routes>
  )
}

beforeEach(() => clearSession())
afterEach(() => {
  clearSession()
  server.resetHandlers()
})

describe('KnowledgeFileDetailPage', () => {
  test('renders metadata + linked locations on success', async () => {
    server.use(
      detailHandler({ name: 'unit-1.pdf', contentType: 'application/pdf', sizeBytes: 2048 }, [
        { type: 'exercise', id: 'ex-1', label: 'Reading EX-R001' },
      ]),
      downloadOk(),
    )
    renderAt('owner', '/knowledge-hub/files/unit-1', routes())
    expect(await screen.findByTestId('kh-detail-name')).toHaveTextContent('unit-1.pdf')
    expect(screen.getByTestId('kh-detail-links')).toHaveTextContent('Reading EX-R001')
  })

  test('an SVG is rendered through <img>, never inline <svg>/<object> (AC5a sandbox)', async () => {
    server.use(
      detailHandler({ name: 'diagram.svg', contentType: 'image/svg+xml' }),
      downloadOk(),
    )
    const { container } = renderAt('owner', '/knowledge-hub/files/diagram', routes())
    const img = await screen.findByTestId('kh-preview-image')
    // The stored-XSS guard: the SVG rides an actual <img> element (not an inline
    // <svg>/<object>/<embed> host), so a script payload can't execute.
    expect(img.tagName).toBe('IMG')
    expect(img).toHaveAttribute('src', DOWNLOAD_URL)
    expect(container.querySelector('object')).toBeNull()
    expect(container.querySelector('embed[type="image/svg+xml"]')).toBeNull()
  })

  test('WebM audio the browser can\'t decode shows the download fallback (AC5b)', async () => {
    server.use(
      detailHandler({ name: 'clip.webm', contentType: 'audio/webm' }),
      downloadOk(),
    )
    renderAt('owner', '/knowledge-hub/files/clip', routes())
    expect(await screen.findByTestId('kh-preview-webm-fallback')).toBeInTheDocument()
    expect(screen.queryByTestId('kh-preview-audio')).not.toBeInTheDocument()
  })

  test('a failed download URL falls back to "Preview unavailable" (AC5d)', async () => {
    server.use(
      detailHandler({ name: 'unit.pdf', contentType: 'application/pdf' }),
      http.get('/api/knowledge-hub/files/:slug/download', () => HttpResponse.error()),
    )
    renderAt('owner', '/knowledge-hub/files/unit', routes())
    // Metadata still renders even when the preview can't.
    expect(await screen.findByTestId('kh-detail-meta')).toBeInTheDocument()
    expect(await screen.findByTestId('kh-preview-unavailable')).toBeInTheDocument()
  })

  test('a 404 renders the not-found state', async () => {
    server.use(
      http.get('/api/knowledge-hub/files/:slug', () =>
        HttpResponse.json({ error: { code: 'FILE_NOT_FOUND', message: 'x' } }, { status: 404 }),
      ),
    )
    renderAt('owner', '/knowledge-hub/files/missing', routes())
    expect(await screen.findByTestId('kh-detail-error')).toBeInTheDocument()
  })

  test('has no accessibility violations (loaded)', async () => {
    server.use(
      detailHandler({ name: 'a.pdf', contentType: 'application/pdf' }),
      downloadOk(),
    )
    const { container } = renderAt('owner', '/knowledge-hub/files/a', routes())
    await screen.findByTestId('kh-detail-meta')
    await waitFor(() => expect(screen.queryByTestId('kh-preview-skeleton')).not.toBeInTheDocument())
    expect(await axe(container)).toHaveNoViolations()
  })
})
