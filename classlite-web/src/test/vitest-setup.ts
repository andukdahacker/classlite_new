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
// Side-effect import: registers @testing-library/jest-dom matchers
// (toBeInTheDocument, toBeDisabled, toHaveFocus, toHaveAttribute, etc.) into
// Vitest's `expect` and augments the `Assertion<T>` interface. Onboarding
// component tests (Story 2-3a) rely on these matchers per TEST-FE-5 role-query
// discipline; earlier suites got away with plain assertions.
import '@testing-library/jest-dom/vitest'
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

// Web Storage polyfill — Node 22.4+/26 ships a global `localStorage` /
// `sessionStorage` (WebStorage) that returns `undefined` and warns
// "localStorage is not available because --localstorage-file was not provided"
// unless launched with that flag. Because vitest's jsdom environment makes
// `window === globalThis`, that broken Node global SHADOWS jsdom's own
// localStorage, so `window.localStorage` is `undefined` — every test that does
// `window.localStorage.clear()` (attempt/grading drafts, lockout, resultSeen,
// dashboard welcome, auth-refresh-locks, …) throws `Cannot read properties of
// undefined`.
//
// The PRIMARY fix is the `--no-experimental-webstorage` node flag passed to the
// test workers (see vitest.config.ts `poolOptions.*.execArgv`), which disables
// Node's WebStorage global so jsdom's NATIVE localStorage takes over — a
// brand-valid `Storage` that also satisfies `new StorageEvent({ storageArea })`.
// This block is a FALLBACK for any invocation where that flag didn't apply: if
// `localStorage` is still missing, we install spec-compliant methods ON the
// jsdom `Storage.prototype` (backed per-instance via a WeakMap) and mint the
// globals with `Object.create`. Going through the real prototype is load-bearing
// — `resultSeen.test.ts` does `vi.spyOn(Storage.prototype, 'getItem')` to
// simulate a throwing/quota store, which a stub off the prototype chain would
// ignore. When the flag worked and real localStorage is present, the whole
// block is skipped (jsdom's native store + `StorageEvent` are used as-is).
const storageProto = (globalThis as { Storage?: { prototype: object } }).Storage
  ?.prototype
const storageBacking = new WeakMap<object, Map<string, string>>()
function storageDataFor(self: object): Map<string, string> {
  let data = storageBacking.get(self)
  if (!data) {
    data = new Map()
    storageBacking.set(self, data)
  }
  return data
}

if (
  (globalThis as Record<string, unknown>).localStorage == null &&
  storageProto
) {
  const proto = storageProto as Record<string, unknown>
  proto.getItem = function (this: object, key: string): string | null {
    const data = storageDataFor(this)
    return data.has(key) ? (data.get(key) as string) : null
  }
  proto.setItem = function (this: object, key: string, value: string): void {
    storageDataFor(this).set(key, String(value))
  }
  proto.removeItem = function (this: object, key: string): void {
    storageDataFor(this).delete(key)
  }
  proto.clear = function (this: object): void {
    storageDataFor(this).clear()
  }
  proto.key = function (this: object, index: number): string | null {
    return Array.from(storageDataFor(this).keys())[index] ?? null
  }
  Object.defineProperty(storageProto, 'length', {
    configurable: true,
    get(this: object): number {
      return storageDataFor(this).size
    },
  })

  for (const name of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: Object.create(storageProto) as Storage,
    })
  }
}

// jsdom polyfills for layout-observing components (Story 5.2b: the
// `react-resizable-panels` split-pane constructs a `ResizeObserver` and reads
// `matchMedia` for coarse-pointer detection — neither exists in jsdom, and the
// missing `ResizeObserver` constructor crashes the split-pane on mount).
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver =
    ResizeObserverStub as unknown as typeof ResizeObserver
}
// `Element.getAnimations` is unimplemented in jsdom; base-ui's ScrollArea viewport
// calls it on a post-mount timer (surfaces as an uncaught exception after a test
// that renders a ScrollArea, e.g. the WritingGradingSurface rail). Stub it to [].
if (typeof Element !== 'undefined' && typeof Element.prototype.getAnimations !== 'function') {
  Element.prototype.getAnimations = () => []
}
// `Element.scrollIntoView` is unimplemented in jsdom; cmdk (the command palette
// primitive behind Story 8-4b's SearchPalette) calls it in a layout effect to
// keep the active item in view. Stub it to a no-op so cmdk consumers mount.
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {}
}
if (typeof globalThis.matchMedia === 'undefined') {
  // Default the attempt UI to its DESKTOP tree in jsdom: `min-width` queries
  // match, coarse-pointer / other queries don't. A test that needs the mobile
  // tree overrides `globalThis.matchMedia` locally (see the mobile-tree specs).
  globalThis.matchMedia = ((query: string) => ({
    matches: query.includes('min-width'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof globalThis.matchMedia
}

// Story 5.4 — jsdom ships no media-capture APIs. These are minimal, always-on
// SAFETY-NET stubs so a bare render of the speaking attempt (e.g. an axe pass on
// the pre-record state) doesn't crash on a missing global. The recorder's precise
// behavior (codec variants, interruption, blob assembly) is driven by the
// controllable `installMediaMocks()` helper, which saves/restores these — the real
// pipeline is verified on the A5 real-device gate, NOT in jsdom.
if (typeof URL.createObjectURL === 'undefined') {
  URL.createObjectURL = () => 'blob:vitest/stub'
  URL.revokeObjectURL = () => {}
}
if (typeof globalThis.MediaRecorder === 'undefined') {
  class MediaRecorderStub {
    static isTypeSupported = (mimeType: string): boolean => mimeType.includes('webm')
    state: 'inactive' | 'recording' = 'inactive'
    mimeType = ''
    ondataavailable: ((event: { data: Blob }) => void) | null = null
    onstop: (() => void) | null = null
    onerror: ((event: unknown) => void) | null = null
    start(): void {
      this.state = 'recording'
    }
    stop(): void {
      this.state = 'inactive'
      this.ondataavailable?.({ data: new Blob(['x']) })
      this.onstop?.()
    }
  }
  globalThis.MediaRecorder = MediaRecorderStub as unknown as typeof MediaRecorder
}
if (typeof globalThis.MediaStream === 'undefined') {
  class MediaStreamStub {
    getTracks(): unknown[] {
      return []
    }
    getAudioTracks(): unknown[] {
      return []
    }
  }
  globalThis.MediaStream = MediaStreamStub as unknown as typeof MediaStream
}
if (navigator.mediaDevices === undefined) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: async () => new globalThis.MediaStream() as MediaStream,
    },
  })
}

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

// Story 1-8 — global QueryClient cache-clear safety net (Murat #1 mandate).
// The new `useAuth` + auth mutations write to the singleton `queryClient`
// from `@/lib/query-client`. Without this hook, test N "logs in" by writing
// the session cache and test N+1 starts authenticated — a silent cross-test
// state leak. Per-test files should still use `createTestQueryClient()` +
// their own `<QueryClientProvider>` (the belt); this is the suspenders.
//
// The dynamic import is intentional — eager-importing `query-client` at
// the top of this setup file would pre-resolve its module graph (which
// includes `auth-refresh.ts` and `@sentry/react`) before any individual
// test file's `vi.mock('@sentry/react', ...)` hoist can apply. That broke
// `sentry-breadcrumb.test.ts`. The dynamic import resolves at first-hook
// fire — after the test file's mocks are in place.
afterEach(async () => {
  const { queryClient } = await import('@/lib/query-client')
  queryClient.clear()
})
