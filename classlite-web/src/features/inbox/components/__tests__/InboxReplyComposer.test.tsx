/**
 * InboxReplyComposer — Story 10-1b AC7. Teacher reply reusing the EXISTING
 * `POST /api/questions/{id}/replies` (the cross-feature MSW handler is registered
 * here — easy to omit). Pins: non-empty validation (RHF+zod), the load-bearing
 * visibility toggle (shared↔private — Sally), and onReplied firing on success.
 * Labels resolve via i18n (TEST-FE-4/5), asserted in both locales.
 */
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, test, vi } from 'vitest'

import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'

import { InboxReplyComposer } from '../InboxReplyComposer'

function renderComposer(onReplied = vi.fn()) {
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <InboxReplyComposer questionId="q-1" onReplied={onReplied} />
      </QueryClientProvider>
    </I18nextProvider>,
  )
  return { onReplied }
}

afterEach(() => server.resetHandlers())

describe('InboxReplyComposer (AC7)', () => {
  test('blocks an empty reply with an i18n validation error', async () => {
    const user = userEvent.setup()
    const { onReplied } = renderComposer()
    await user.click(screen.getByRole('button', { name: i18n.t('inbox.reply.send') }))
    expect(await screen.findByText(i18n.t('inbox.reply.error.required'))).toBeInTheDocument()
    expect(onReplied).not.toHaveBeenCalled()
  })

  test('exposes the visibility toggle (shared + private) — not hardcoded', () => {
    renderComposer()
    expect(screen.getByTestId('inbox-reply-visibility-shared')).toBeInTheDocument()
    expect(screen.getByTestId('inbox-reply-visibility-personal')).toBeInTheDocument()
  })

  test('posts the reply with the chosen visibility and fires onReplied', async () => {
    const user = userEvent.setup()
    let body: unknown
    server.use(
      http.post('/api/questions/:id/replies', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ data: { id: 'r-1', questionId: 'q-1' } }, { status: 201 })
      }),
    )
    const { onReplied } = renderComposer()

    await user.type(screen.getByRole('textbox'), 'Great question — see page 42.')
    await user.click(screen.getByTestId('inbox-reply-visibility-personal'))
    await user.click(screen.getByRole('button', { name: i18n.t('inbox.reply.send') }))

    await waitFor(() => expect(onReplied).toHaveBeenCalledTimes(1))
    expect(body).toMatchObject({ content: 'Great question — see page 42.', visibility: 'personal', resolve: false })
  })

  test('visibility labels resolve in both locales (TEST-FE-4)', () => {
    for (const key of [
      'inbox.reply.visibility.shared',
      'inbox.reply.visibility.private',
      'inbox.reply.send',
      'inbox.reply.placeholder',
    ]) {
      expect(i18n.getFixedT('en')(key)).not.toBe(key)
      expect(i18n.getFixedT('vi')(key)).not.toBe(key)
    }
  })
})
