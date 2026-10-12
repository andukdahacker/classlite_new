/**
 * Story 11-0a · AC7 — session replay is OFF, and LOCKED.
 *
 * Ruling (epic-11.md:929): Sentry session replay stays OFF in every environment
 * until PII masking is verified — education product, minors plausible, VN
 * jurisdiction/consent. The frontend already configures no replay integration;
 * this test is the REGRESSION LOCK, not a red specimen. Its value is catching a
 * FUTURE change (a dependency bump or a copy-pasted config) that silently enables
 * replay. Because the behavior is already correct, this test is GREEN from the
 * first run — a characterization lock, deliberately so (R-11-6's replay facet).
 *
 * Mocking: ESM namespace objects from `import * as Sentry` are frozen by Vitest's
 * transform, so vi.mock with hoisted mocks is the supported pattern (mirrors
 * sentry-breadcrumb.test.ts). We also mock `replayIntegration` so that IF sentry.ts
 * ever starts calling it, this test sees it and fails.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  browserTracingIntegration: vi.fn(() => ({ name: 'browserTracing' })),
  replayIntegration: vi.fn(() => ({ name: 'replay' })),
}))

vi.mock('@sentry/react', () => ({
  init: mocks.init,
  browserTracingIntegration: mocks.browserTracingIntegration,
  replayIntegration: mocks.replayIntegration,
}))

beforeEach(() => {
  mocks.init.mockClear()
  mocks.replayIntegration.mockClear()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('initSentry — session replay is OFF (AC7 regression lock)', () => {
  test('does not configure any replay integration, with a DSN set', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@example.test/1')
    const { initSentry } = await import('@/lib/sentry')

    initSentry()

    expect(mocks.init).toHaveBeenCalledTimes(1)
    const options = mocks.init.mock.calls[0]![0] as {
      integrations?: Array<{ name?: string }>
      replaysSessionSampleRate?: number
      replaysOnErrorSampleRate?: number
    }

    // No replay integration constructed...
    expect(mocks.replayIntegration).not.toHaveBeenCalled()
    // ...and none present in the integrations array.
    const names = (options.integrations ?? []).map((i) => i?.name)
    expect(names).not.toContain('replay')
    // ...and no replay sample-rate options leaked in.
    expect(options.replaysSessionSampleRate).toBeUndefined()
    expect(options.replaysOnErrorSampleRate).toBeUndefined()
  })

  test('no-ops entirely when the DSN is unset (does not even init)', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', '')
    const { initSentry } = await import('@/lib/sentry')

    initSentry()

    expect(mocks.init).not.toHaveBeenCalled()
  })
})
