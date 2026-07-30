// Story 4.4b (AC3/AC4/AC7, TEST-FE-1) — the upload phase machine. MSW at the
// HTTP boundary for presign + the R2 PUT + confirm, including the party-mode
// hardened cases: the client pre-check and a server reject share ONE copy
// (AC4b), a transfer failure is retryable without re-selecting (AC4c), the
// confirm-failure (502) surfaces its own message, and the 100% storage block is
// role-split (AC7).
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { server } from '@/test/msw-server'
import i18n from '@/lib/i18n'
import { UploadDialog } from '@/features/knowledge-hub/components/UploadDialog'
import { clearSession, file as makeFile, renderComponent } from './harness'

const PRESIGN_URL = 'https://r2.test/put'
const OBJECT_KEY = 'c-kh-1/knowledge/x.pdf'

function makeUploadFile(name: string, type: string, size: number): File {
  const f = new File(['x'], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

function presignOk() {
  return http.post('/api/uploads/presign', () =>
    HttpResponse.json({ data: { url: PRESIGN_URL, key: OBJECT_KEY } }),
  )
}
function putOk() {
  return http.put(PRESIGN_URL, () => new HttpResponse(null, { status: 200 }))
}
function putFail() {
  return http.put(PRESIGN_URL, () => new HttpResponse(null, { status: 500 }))
}

function renderDialog(
  role: 'owner' | 'teacher',
  opts: { storageFull?: boolean; onUploaded?: (f: unknown) => void } = {},
) {
  return renderComponent(
    role,
    <UploadDialog
      folderId={null}
      storageFull={opts.storageFull ?? false}
      open
      onOpenChange={() => {}}
      onUploaded={opts.onUploaded ?? (() => {})}
    />,
  )
}

function pick(file: File): void {
  const input = screen.getByTestId('kh-upload-input')
  fireEvent.change(input, { target: { files: [file] } })
}

beforeEach(() => clearSession())
afterEach(() => {
  clearSession()
  server.resetHandlers()
})

describe('UploadDialog', () => {
  test('client pre-check rejects an over-cap file with the cap in the copy (AC3/AC4b)', async () => {
    renderDialog('owner')
    // 60 MB PDF — over the 50 MB PDF cap. No network touched.
    pick(makeUploadFile('big.pdf', 'application/pdf', 60 * 1024 * 1024))
    const message = await screen.findByTestId('kh-upload-error-message')
    expect(message).toHaveTextContent('50')
    expect(message).toHaveTextContent(i18n.t('knowledgeHub.upload.error.tooLarge', { capMb: 50 }))
  })

  test('a server 413 on confirm shows the SAME copy as the client pre-check (AC4b)', async () => {
    server.use(
      presignOk(),
      putOk(),
      http.post('/api/uploads/confirm', () =>
        HttpResponse.json({ error: { code: 'FILE_TOO_LARGE', message: 'too large' } }, { status: 413 }),
      ),
    )
    renderDialog('owner')
    pick(makeUploadFile('ok.pdf', 'application/pdf', 1024))
    const message = await screen.findByTestId('kh-upload-error-message')
    // Identical to the client copy — the user can't tell client-catch from server-catch.
    expect(message).toHaveTextContent(i18n.t('knowledgeHub.upload.error.tooLarge', { capMb: 50 }))
  })

  test('a successful upload calls onUploaded (success = the tile, not a "done" state) (AC4a)', async () => {
    const created = makeFile({ id: 'file-new', name: 'ok.pdf' })
    server.use(
      presignOk(),
      putOk(),
      http.post('/api/uploads/confirm', () => HttpResponse.json({ data: created }, { status: 201 })),
    )
    const onUploaded = vi.fn()
    renderDialog('owner', { onUploaded })
    pick(makeUploadFile('ok.pdf', 'application/pdf', 1024))
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1))
    // No lingering "success" panel — the dialog never shows a 100%-as-success state.
    expect(screen.queryByTestId('kh-upload-progress')).not.toBeInTheDocument()
  })

  test('a transfer failure is retryable WITHOUT re-selecting the file (AC4c)', async () => {
    server.use(presignOk(), putFail())
    renderDialog('owner')
    pick(makeUploadFile('ok.pdf', 'application/pdf', 1024))
    expect(await screen.findByTestId('kh-upload-retry')).toBeInTheDocument()
    expect(screen.getByTestId('kh-upload-error-message')).toHaveTextContent(
      i18n.t('knowledgeHub.upload.error.transfer'),
    )
  })

  test('a confirm-verification failure (502) surfaces its own retryable message', async () => {
    server.use(
      presignOk(),
      putOk(),
      http.post('/api/uploads/confirm', () =>
        HttpResponse.json({ error: { code: 'UPLOAD_VERIFICATION_FAILED', message: 'x' } }, { status: 502 }),
      ),
    )
    renderDialog('owner')
    pick(makeUploadFile('ok.pdf', 'application/pdf', 1024))
    expect(await screen.findByTestId('kh-upload-retry')).toBeInTheDocument()
    expect(screen.getByTestId('kh-upload-error-message')).toHaveTextContent(
      i18n.t('knowledgeHub.upload.error.verify'),
    )
  })

  test('at 100% storage the dialog blocks the picker with role-split copy (AC7)', () => {
    renderDialog('owner', { storageFull: true })
    expect(screen.getByTestId('kh-upload-storage-full')).toBeInTheDocument()
    expect(screen.getByTestId('kh-upload-storage-full')).toHaveTextContent(
      i18n.t('knowledgeHub.storage.full.ownerBody'),
    )
    // No file can be picked while full.
    expect(screen.queryByTestId('kh-upload-pick')).not.toBeInTheDocument()
  })

  test('a teacher at 100% sees the ask-owner copy, NOT the owner upgrade CTA (TEST-FE-6)', () => {
    renderDialog('teacher', { storageFull: true })
    const block = screen.getByTestId('kh-upload-storage-full')
    expect(block).toHaveTextContent(i18n.t('knowledgeHub.storage.full.memberBody'))
    expect(block).not.toHaveTextContent(i18n.t('knowledgeHub.storage.full.ownerBody'))
  })
})
