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
import { afterAll, afterEach, beforeAll, expect } from 'vitest'
import { cleanup } from '@testing-library/react'
// Deep import: vitest-axe 0.1.0's package-root `matchers.d.ts` re-exports
// via `export type *` which collapses runtime values into type-only under
// `verbatimModuleSyntax`. The `dist/matchers.d.ts` declaration re-exports
// the runtime value correctly, so go through that path. Switch back to the
// package root entry when vitest-axe ships a fixed shim.
import { toHaveNoViolations } from 'vitest-axe/dist/matchers.js'
import { server } from './msw-server'

// Story 1-7c AC7 — vitest-axe matcher runtime registration.
//
// vitest-axe 0.1.0 ships an empty `dist/extend-expect.js`; the side-effect
// import documented in its README is a no-op against this version. We
// register the matchers manually with an explicit named import so a future
// non-matcher export from `vitest-axe/matchers` (helper, type, default)
// can't accidentally land inside `expect.extend(...)`. The TypeScript
// augmentation lives in `src/test/vitest-axe.d.ts` so
// `expect(...).toHaveNoViolations()` type-checks against Vitest 4's
// `Assertion<T>` interface.
expect.extend({ toHaveNoViolations })

// @testing-library/react auto-cleanup. With Vitest's `globals: false`
// (vitest.config.ts), RTL's auto-registration of `afterEach(cleanup)` via
// the global afterEach hook does not fire. Registering manually here
// avoids "multiple elements" false-positives when tests call `render()`
// successively in the same file.
afterEach(() => {
  cleanup()
})

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
