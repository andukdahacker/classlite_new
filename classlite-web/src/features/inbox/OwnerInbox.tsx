/**
 * OwnerInbox — Story 10-1b. Owner lens over the shared InboxView: enrolment +
 * billing + alerts lanes (AC8b), owner/admin-toned empty. Its own Rolldown chunk.
 */
import type { ReactElement } from 'react'

import { InboxView } from './components/InboxView'

export function OwnerInbox(): ReactElement {
  return <InboxView role="owner" emptyLens="ownerAdmin" />
}

export default OwnerInbox
