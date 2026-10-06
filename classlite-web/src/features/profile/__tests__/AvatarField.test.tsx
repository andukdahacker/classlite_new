// Story 9.4 — AvatarField tests (AC5). MSW mocks BOTH the presign endpoint AND
// the R2 PUT host (else the XHR transfer flakes). Covers the instant client-side
// rejects (size/type), the happy presign→transfer→onUploaded chain, and a
// transfer failure surfacing an in-language error (no onUploaded fired).
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse, delay } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { AvatarField } from '@/features/profile/components/AvatarField'

const R2_URL = 'https://mock-r2.example.com/c-1/avatars/new.png'
const R2_KEY = 'c-1/avatars/new.png'

function smallPng(): File {
  return new File([new Uint8Array(1024)], 'face.png', { type: 'image/png' })
}

function renderField(onUploaded = vi.fn()) {
  render(
    <I18nextProvider i18n={i18n}>
      <AvatarField
        currentAvatarUrl={null}
        pendingPreviewUrl={null}
        name="Ada Lovelace"
        onUploaded={onUploaded}
      />
    </I18nextProvider>,
  )
  return onUploaded
}

beforeEach(() => {
  // jsdom has no object-URL impl; the component creates a preview URL on success.
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AvatarField — client pre-check (AC5)', () => {
  test('rejects an over-5MB file in-language, no upload', async () => {
    const onUploaded = renderField()
    const user = userEvent.setup()
    const big = new File([new Uint8Array(6 * 1024 * 1024)], 'big.png', {
      type: 'image/png',
    })
    await user.upload(screen.getByTestId('profile-avatar-input'), big)
    expect(
      await screen.findByText(i18n.t('profile.avatar.errors.tooLarge')),
    ).toBeInTheDocument()
    expect(onUploaded).not.toHaveBeenCalled()
  })

  test('rejects a non-image type in-language, no upload', async () => {
    const onUploaded = renderField()
    const svg = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })
    // fireEvent.change bypasses the input's `accept` filter (which userEvent
    // honors) so the component's OWN pre-check — the assertion under test — runs.
    fireEvent.change(screen.getByTestId('profile-avatar-input'), {
      target: { files: [svg] },
    })
    expect(
      await screen.findByText(i18n.t('profile.avatar.errors.wrongType')),
    ).toBeInTheDocument()
    expect(onUploaded).not.toHaveBeenCalled()
  })
})

describe('AvatarField — upload chain (AC5)', () => {
  test('presign → transfer → onUploaded(key) on success', async () => {
    server.use(
      http.post('*/api/uploads/presign', () =>
        HttpResponse.json({ data: { url: R2_URL, key: R2_KEY } }),
      ),
      http.put(R2_URL, () => new HttpResponse(null, { status: 200 })),
    )
    const onUploaded = renderField()
    const user = userEvent.setup()
    await user.upload(screen.getByTestId('profile-avatar-input'), smallPng())
    await waitFor(() =>
      expect(onUploaded).toHaveBeenCalledWith(R2_KEY, 'blob:preview'),
    )
  })

  test('a failed R2 transfer surfaces an error and does NOT call onUploaded', async () => {
    server.use(
      http.post('*/api/uploads/presign', () =>
        HttpResponse.json({ data: { url: R2_URL, key: R2_KEY } }),
      ),
      http.put(R2_URL, () => new HttpResponse(null, { status: 500 })),
    )
    const onUploaded = renderField()
    const user = userEvent.setup()
    await user.upload(screen.getByTestId('profile-avatar-input'), smallPng())
    expect(
      await screen.findByText(i18n.t('profile.avatar.errors.transfer')),
    ).toBeInTheDocument()
    expect(onUploaded).not.toHaveBeenCalled()
  })
})

describe('AvatarField — abort + cleanup (AC5 / review patch P6)', () => {
  test('cancel aborts the in-flight upload, no onUploaded', async () => {
    server.use(
      http.post('*/api/uploads/presign', () =>
        HttpResponse.json({ data: { url: R2_URL, key: R2_KEY } }),
      ),
      http.put(R2_URL, async () => {
        await delay('infinite') // hang the transfer so it stays in-flight
        return new HttpResponse(null, { status: 200 })
      }),
    )
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort')
    const onUploaded = renderField()
    const user = userEvent.setup()
    await user.upload(screen.getByTestId('profile-avatar-input'), smallPng())

    // In-flight → the cancel control is shown; clicking it aborts the transfer
    // via the AbortController wired into uploadAvatarFile's signal (AC5).
    await user.click(await screen.findByTestId('profile-avatar-cancel'))

    expect(abortSpy).toHaveBeenCalled()
    expect(onUploaded).not.toHaveBeenCalled()
  })

  test('revokes the created object URL on unmount (no blob leak)', async () => {
    const revokeSpy = vi.fn()
    globalThis.URL.revokeObjectURL = revokeSpy
    server.use(
      http.post('*/api/uploads/presign', () =>
        HttpResponse.json({ data: { url: R2_URL, key: R2_KEY } }),
      ),
      http.put(R2_URL, () => new HttpResponse(null, { status: 200 })),
    )
    const onUploaded = vi.fn()
    const { unmount } = render(
      <I18nextProvider i18n={i18n}>
        <AvatarField
          currentAvatarUrl={null}
          pendingPreviewUrl={null}
          name="Ada Lovelace"
          onUploaded={onUploaded}
        />
      </I18nextProvider>,
    )
    const user = userEvent.setup()
    await user.upload(screen.getByTestId('profile-avatar-input'), smallPng())
    await waitFor(() => expect(onUploaded).toHaveBeenCalled())

    unmount()
    expect(revokeSpy).toHaveBeenCalledWith('blob:preview')
  })
})
