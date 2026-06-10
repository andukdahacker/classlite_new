/**
 * Project-wide MSW server for Vitest network mocking.
 *
 * Per project-context TEST-FE-1: MSW at the HTTP boundary is the ONLY mock
 * seam permitted on the frontend. Tests import this server and call
 * `server.use(...)` to install per-test handlers; lifecycle (`listen` /
 * `close` / `resetHandlers`) is driven from src/test/vitest-setup.ts so
 * every test file shares the same instance.
 */
import { setupServer } from 'msw/node'

export const server = setupServer()
