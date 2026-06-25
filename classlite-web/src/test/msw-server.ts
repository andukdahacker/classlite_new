/**
 * Project-wide MSW server for Vitest network mocking.
 *
 * Per project-context TEST-FE-1: MSW at the HTTP boundary is the ONLY mock
 * seam permitted on the frontend. Tests import this server and call
 * `server.use(...)` to install per-test handlers; lifecycle (`listen` /
 * `close` / `resetHandlers`) is driven from src/test/vitest-setup.ts so
 * every test file shares the same instance.
 *
 * Default handlers come from `./mocks/handlers.ts` per the
 * `_bmad-output/test-artifacts/msw-handler-catalog-auth.md` catalog —
 * happy-path stubs for the 6 auth endpoints Story 1-8 (and downstream
 * 1.9a/1.9b/1.9c/1.9d) consume. Tests that need error / loading variants
 * register via `server.use(...)` — never mutate the default array.
 */
import { setupServer } from 'msw/node'
import { handlers } from './mocks/handlers'

export const server = setupServer(...handlers)
