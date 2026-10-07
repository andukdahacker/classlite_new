/**
 * StudentInbox — Story 10-1b. Student lens over the shared InboxView: grade /
 * assignment / schedule rows, student-toned empty. Its own Rolldown chunk.
 */
import type { ReactElement } from 'react'

import { InboxView } from './components/InboxView'

export function StudentInbox(): ReactElement {
  return <InboxView role="student" emptyLens="student" />
}

export default StudentInbox
