// Story 3.1 (AC2/AC8) — ClassFormDialog: template picker, per-field toggles,
// and the AC2 create-omit wire contract (an excluded template field is OMITTED
// from CreateClassRequest so the column takes NULL/DB-default server-side).
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, test, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import { ClassFormDialog } from '../ClassFormDialog'
import { classWire } from '../../api/__tests__/handlers'

const TEMPLATE = {
  id: '11111111-2222-3333-4444-555555555501',
  name: 'IELTS Writing 6.5',
  targetBand: 6.5,
  primarySkill: 'writing',
  sessionCount: 12,
  color: 'var(--cl-accent)',
  scope: 'system',
}

function tplEnvelope() {
  return {
    data: { templates: [TEMPLATE] },
    meta: { serverTime: '2026-07-19T00:00:00Z' },
  }
}

function renderDialog() {
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <ClassFormDialog centerId="c-1" initial={null} onClose={vi.fn()} />
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

describe('ClassFormDialog', () => {
  test('renders create form with name field + template picker', async () => {
    server.use(http.get('/api/templates', () => HttpResponse.json(tplEnvelope())))
    renderDialog()
    expect(await screen.findByTestId('class-field-name')).toBeInTheDocument()
    // The picker now resolves through a loading state (CR-3-1-9) — await it.
    expect(await screen.findByTestId('class-template-picker')).toBeInTheDocument()
  })

  test('selecting a template reveals per-field toggles + session preview', async () => {
    const user = userEvent.setup()
    server.use(http.get('/api/templates', () => HttpResponse.json(tplEnvelope())))
    renderDialog()
    const picker = await screen.findByTestId('class-template-picker')
    await screen.findByRole('option', { name: TEMPLATE.name })
    await user.selectOptions(picker, TEMPLATE.id)
    expect(await screen.findByTestId('class-template-toggles')).toBeInTheDocument()
    expect(screen.getByTestId('class-session-preview')).toBeInTheDocument()
    expect(
      screen.getByTestId('class-prefill-toggle-targetBand'),
    ).toBeInTheDocument()
  })

  test('AC2: excluding a template field OMITS it from the create payload', async () => {
    const user = userEvent.setup()
    let captured: Record<string, unknown> | null = null
    server.use(
      http.get('/api/templates', () => HttpResponse.json(tplEnvelope())),
      http.post('/api/classes', async ({ request }) => {
        captured = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(
          {
            data: classWire({ id: 'cls-new', status: 'upcoming' }),
            meta: { serverTime: '2026-07-19T00:00:00Z' },
          },
          { status: 201 },
        )
      }),
    )
    renderDialog()
    const picker = await screen.findByTestId('class-template-picker')
    await screen.findByRole('option', { name: TEMPLATE.name })
    await user.selectOptions(picker, TEMPLATE.id)
    // Exclude targetBand (Switch defaults on/included → click turns it off).
    await user.click(await screen.findByTestId('class-prefill-toggle-targetBand'))
    await user.click(
      screen.getByRole('button', { name: i18n.t('classes.form.create') }),
    )

    await waitFor(() => expect(captured).not.toBeNull())
    // Excluded → key absent (column takes NULL/DB-default, AC2 wire contract).
    expect(captured).not.toHaveProperty('targetBand')
    // Included fields still present; name prefilled from the template.
    expect(captured).toMatchObject({
      name: TEMPLATE.name,
      primarySkill: 'writing',
      sessionCount: 12,
    })
  })

  test('AC2: re-enabling a toggled-off field RESTORES the template value (CR-3-1 P1)', async () => {
    const user = userEvent.setup()
    let captured: Record<string, unknown> | null = null
    server.use(
      http.get('/api/templates', () => HttpResponse.json(tplEnvelope())),
      http.post('/api/classes', async ({ request }) => {
        captured = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(
          {
            data: classWire({ id: 'cls-new', status: 'upcoming' }),
            meta: { serverTime: '2026-07-19T00:00:00Z' },
          },
          { status: 201 },
        )
      }),
    )
    renderDialog()
    const picker = await screen.findByTestId('class-template-picker')
    await screen.findByRole('option', { name: TEMPLATE.name })
    await user.selectOptions(picker, TEMPLATE.id)
    const toggle = await screen.findByTestId('class-prefill-toggle-targetBand')
    // Off then on — the Switch reads "included" again, so the payload MUST
    // carry the restored template value (not silently drop it).
    await user.click(toggle)
    await user.click(toggle)
    await user.click(
      screen.getByRole('button', { name: i18n.t('classes.form.create') }),
    )

    await waitFor(() => expect(captured).not.toBeNull())
    expect(captured).toHaveProperty('targetBand', TEMPLATE.targetBand)
  })

  // --- Story 3.3 CR-3-1-9 picker debt ---------------------------------------

  test('picker shows an error + retry when the template list fails to load', async () => {
    server.use(
      http.get('/api/templates', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: 'boom', requestId: 'r', details: null } },
          { status: 500 },
        ),
      ),
    )
    renderDialog()
    // useListTemplates retries once on 5xx, so the error surfaces after a backoff.
    expect(
      await screen.findByTestId('class-template-picker-error', undefined, {
        timeout: 3000,
      }),
    ).toBeInTheDocument()
    // The bare select must NOT silently render as if there were no templates.
    expect(screen.queryByTestId('class-template-picker')).not.toBeInTheDocument()
  })

  test('selecting a template does NOT clobber a user-typed name (CR-3-1-9b)', async () => {
    const user = userEvent.setup()
    server.use(http.get('/api/templates', () => HttpResponse.json(tplEnvelope())))
    renderDialog()

    const nameField = await screen.findByTestId('class-field-name')
    await user.type(nameField, 'My Own Class Name')

    const picker = await screen.findByTestId('class-template-picker')
    await screen.findByRole('option', { name: TEMPLATE.name })
    await user.selectOptions(picker, TEMPLATE.id)

    // Name preserved — template scalars prefill but the typed name wins.
    expect(nameField).toHaveValue('My Own Class Name')
    expect(await screen.findByTestId('class-template-toggles')).toBeInTheDocument()
  })
})
