/**
 * features/inbox barrel (Story 10-1b). Cross-feature consumers import from here
 * (TS-7 — never a deep path). The route dispatcher is lazy-imported by name in
 * routes.tsx; AppLayout imports the badge poller hook.
 */
export { InboxRoute } from './InboxRoute'
export { useInboxCount, INBOX_POLL_INTERVAL_MS, type UnreadCount } from './api/useInboxCount'
export { inboxKeys } from './api/inboxKeys'
