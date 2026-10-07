/**
 * TeacherInbox — Story 10-1b. Teacher lens over the shared InboxView: question
 * rows only in v1 (10-1c adds the grading queue), with the inline reply composer
 * enabled (AC7). Teacher-toned empty. Its own Rolldown chunk — the only one that
 * pulls in the reply composer.
 */
import type { ReactElement } from 'react'

import { InboxView } from './components/InboxView'

export function TeacherInbox(): ReactElement {
  return <InboxView role="teacher" emptyLens="teacher" enableTeacherReply />
}

export default TeacherInbox
