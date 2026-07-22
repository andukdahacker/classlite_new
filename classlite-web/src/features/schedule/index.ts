/**
 * Schedule feature barrel (TS-7). Cross-feature consumers (e.g. the class-detail
 * Sessions tab) import from here, never reach into internal paths. The route
 * chunks deep-import SchedulePage / MySchedulePage directly for Rolldown chunk
 * isolation — those are NOT re-exported here to avoid dragging the heavy
 * calendar into a barrel consumer's chunk.
 */
export { useClassSessions, useSessions, useSession } from './api/useSessions'
export type { SessionWire, SessionDetailWire, SessionRange } from './api/useSessions'
export { sessionsKeys } from './api/sessionsKeys'
export { formatSessionTime, formatSessionDateTime, formatSessionTimeRange } from './lib/formatSessionTime'
