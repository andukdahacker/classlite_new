/**
 * Vitest global setup — MSW lifecycle + jsdom polyfills.
 *
 * Per project-context TEST-FE-1 the MSW server is the single HTTP mock seam
 * for the frontend. Wiring lifecycle here (instead of per test file)
 * guarantees every suite runs against the same handler registry and avoids
 * the dropped-resetHandlers flake mode where a leaked handler from suite A
 * silently makes suite B green.
 *
 * `onUnhandledRequest: 'error'` is intentional: an unmocked HTTP call is
 * almost always a test smell (forgot to register a handler, wrong URL,
 * etc.) and should fail loudly instead of hitting the real network.
 */
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './msw-server'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
