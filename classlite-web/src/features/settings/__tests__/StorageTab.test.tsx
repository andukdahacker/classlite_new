// Story 4.4b (AC7, TEST-FE-2/5/6) — Settings → Storage read-only meter + the
// role-split 100% state. Owner sees the upgrade CTA; a teacher sees ask-owner
// and NOT the owner copy (role-negative). Trilogy + axe.
import { screen } from '@testing-library/react'
import { HttpResponse, http, delay } from 'msw'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { axe } from 'vitest-axe'
import { server } from '@/test/msw-server'
import i18n from '@/lib/i18n'
import { StorageTab } from '@/features/settings/StorageTab'
import { clearSession, renderComponent } from '@/features/knowledge-hub/__tests__/harness'

function usage(usedBytes: number, limitBytes: number, opts: { delay?: boolean; error?: boolean } = {}) {
  return http.get('/api/storage/usage', async () => {
    if (opts.delay) await delay(40)
    if (opts.error) return HttpResponse.error()
    return HttpResponse.json({ data: { usedBytes, limitBytes } })
  })
}

const LIMIT = 500 * 1024 * 1024

beforeEach(() => clearSession())
afterEach(() => {
  clearSession()
  server.resetHandlers()
})

describe('StorageTab', () => {
  test('renders the skeleton while loading', () => {
    server.use(usage(0, LIMIT, { delay: true }))
    renderComponent('owner', <StorageTab centerId="c-kh-1" />)
    expect(screen.getByTestId('storage-tab-skeleton')).toBeInTheDocument()
  })

  test('renders the usage meter and no full-state below 100%', async () => {
    server.use(usage(LIMIT / 2, LIMIT))
    renderComponent('owner', <StorageTab centerId="c-kh-1" />)
    expect(await screen.findByTestId('storage-meter')).toHaveAttribute('aria-valuenow', '50')
    expect(screen.queryByTestId('storage-full-state')).not.toBeInTheDocument()
  })

  test('an owner at 100% sees the upgrade CTA copy', async () => {
    server.use(usage(LIMIT, LIMIT))
    renderComponent('owner', <StorageTab centerId="c-kh-1" />)
    const full = await screen.findByTestId('storage-full-state')
    expect(full).toHaveTextContent(i18n.t('knowledgeHub.storage.full.ownerBody'))
  })

  test('a teacher at 100% sees ask-owner, NOT the owner CTA (TEST-FE-6)', async () => {
    server.use(usage(LIMIT, LIMIT))
    renderComponent('teacher', <StorageTab centerId="c-kh-1" />)
    const full = await screen.findByTestId('storage-full-state')
    expect(full).toHaveTextContent(i18n.t('knowledgeHub.storage.full.memberBody'))
    expect(full).not.toHaveTextContent(i18n.t('knowledgeHub.storage.full.ownerBody'))
  })

  test('renders the error state on failure', async () => {
    server.use(usage(0, LIMIT, { error: true }))
    renderComponent('owner', <StorageTab centerId="c-kh-1" />)
    expect(await screen.findByTestId('storage-tab-error')).toBeInTheDocument()
  })

  test('has no accessibility violations', async () => {
    server.use(usage(LIMIT / 4, LIMIT))
    const { container } = renderComponent('owner', <StorageTab centerId="c-kh-1" />)
    await screen.findByTestId('storage-meter')
    expect(await axe(container)).toHaveNoViolations()
  })
})
