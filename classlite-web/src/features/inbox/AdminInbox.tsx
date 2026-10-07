/**
 * AdminInbox — Story 10-1b. Admin lens over the shared InboxView: enrolment rows
 * only (NO billing / alerts chip — owner-only, AC8b), owner/admin-toned empty.
 * Its own Rolldown chunk. Admin ≠ Owner here (unlike the dashboard) because the
 * inbox lanes differ.
 */
import type { ReactElement } from 'react'

import { InboxView } from './components/InboxView'

export function AdminInbox(): ReactElement {
  return <InboxView role="admin" emptyLens="ownerAdmin" />
}

export default AdminInbox
