# Epic 10: Inbox, Notifications, Archive & Polish

**FRs:** FR-56 through FR-60, FR-69, FR-70

---

## Story 10.1: Role-Scoped Inbox & Notifications

| Field        | Value                      |
| ------------ | -------------------------- |
| Size         | L                          |
| Audience     | Full-stack                 |
| Dependencies | 1.2f (event bus)           |

**As a** teacher/admin/owner/student, **I want** a role-scoped inbox, **so that** I receive only the notifications relevant to my role and can act on them directly.

### Acceptance Criteria

**Given** a Teacher navigating to `/inbox` (s50)
**When** the teacher inbox renders
**Then** a central queue shows: unanswered questions (with exercise anchor and time elapsed), ungraded submissions (with student name, assignment, and overdue flag), late submissions, and @mentions
**And** per-row actions are available: Grade (navigates to grading view), Reply (navigates to Q&A), Archive (removes from queue)

**Given** a Student navigating to `/inbox` (s51)
**When** the student inbox renders
**Then** items include: teacher replies to questions, posted grades (with band score preview), comments on submissions, new assignments, and schedule changes
**And** each item links directly to the relevant submission, question thread, or schedule

**Given** an Admin or Owner navigating to `/inbox` (s52)
**When** the admin/owner inbox renders
**Then** operational signals are shown: enrollment requests, new staff joined, integration health alerts, and billing events
**And** billing events are visible only to Owner (not Admin)

**Given** the inbox on mobile (s75 for student, s84 for teacher)
**When** rendered at 390px
**Then** items display as flat chronological rows with two-line previews
**And** horizontal-scroll filter chips allow category filtering
**And** swipe gestures support archive/dismiss actions

**Given** the notification badge (FR-59)
**When** new items arrive in a user's inbox
**Then** the "Inbox" sidebar navigation item shows an unread badge with the count
**And** the badge count updates via polling (TanStack Query refetch interval 30-60s)
**And** the polling interval is configurable, not hardcoded

**Given** the notification API
**When** GET `/api/inbox` is called
**Then** the response returns paginated inbox items scoped to the user's role
**And** each item includes: type, title, body preview, link, read status, created_at
**And** POST `/api/inbox/{id}/read` marks an item as read
**And** POST `/api/inbox/{id}/archive` removes it from the active queue
**And** GET `/api/inbox/count` returns the unread count (lightweight endpoint for polling)

**Given** the database
**When** migrations run
**Then** a `notifications` table exists: id, center_id, user_id, type (enum), title, body, link, metadata (JSONB), read_at (nullable), archived_at (nullable), created_at
**And** an index on (user_id, read_at, created_at) supports efficient unread queries
**And** RLS policies are applied
**And** notification creation is triggered by domain events: grade released, question asked, enrollment changed, assignment created, schedule changed, payment failed, storage threshold crossed

**Given** the storage threshold notification (per A9 locked decision: 95% triggers escalation),
**When** a tenant's cumulative used storage crosses 95% of plan total
**Then** a notification is delivered to the **OWNER** (NOT the uploader if different) via BOTH the in-app inbox AND email (via Resend, Vietnamese-localized). The inbox row links to Settings → Storage with one-click "Upgrade to Studio" CTA in the body. Test: seed storage usage to 94% → upload to push past 95% → assert exactly ONE notification row created for the owner.

---

## Story 10.2: Archive

| Field        | Value              |
| ------------ | ------------------ |
| Size         | M                  |
| Audience     | Full-stack         |
| Dependencies | 3.1, 4.1          |

**As a** teacher/admin/owner, **I want** an archive of past classes, sessions, and exercises, **so that** I can review historical data and duplicate items when needed.

### Acceptance Criteria

**Given** a Teacher navigating to `/archive` (s28)
**When** the archive page renders
**Then** past items are displayed organized by type: Classes (ended + 30 days), Sessions (past), Exercises (archived)
**And** each item shows its original metadata and dates

**Given** any archived item
**When** the user views it
**Then** the item is completely read-only — no editing actions available

**Given** an archived item
**When** the user clicks "Duplicate"
**Then** a new editable copy is created in the active workspace
**And** the copy has a new ID and "(Copy)" appended to the title

**Given** an archived item
**When** the user clicks "Edit a copy"
**Then** a new copy is created AND opened in edit mode immediately

**Given** the archive scope
**When** a Teacher views the archive
**Then** they see only their own archived items (classes they taught, exercises they created)
**And** Admin/Owner sees center-wide archived items

**Given** the archive API
**When** GET `/api/archive` is called with optional `type` filter
**Then** the response returns paginated archived items scoped by role
**And** POST `/api/archive/{type}/{id}/duplicate` creates an active copy

---

## Story 10.3: Empty States

| Field        | Value              |
| ------------ | ------------------ |
| Size         | M                  |
| Audience     | Frontend           |
| Dependencies | All prior epics    |

**As a** user, **I want** helpful empty states throughout the application, **so that** I understand what a feature does and how to get started when there is no data yet.

### Acceptance Criteria

**Given** a Teacher's first visit to the dashboard with no data (s53)
**When** the empty state renders
**Then** a guided three-step start is shown: 1) Create your first class, 2) Build an exercise, 3) Assign and grade
**And** each step has a direct CTA linking to the relevant action

**Given** a Teacher viewing empty classes list (s54)
**When** the empty state renders
**Then** three paths to create are offered: from template, from scratch, from archive

**Given** a Teacher viewing an empty class roster (s55)
**When** the empty state renders
**Then** three invite paths are shown: share link, email invite, add from unassigned students

**Given** empty inbox screens for all roles (s56)
**When** each role's inbox is empty
**Then** role-specific empty states are shown:
**And** Teacher: "No items — you're all caught up"
**And** Student: "No notifications yet — check back after your teacher grades your work"
**And** Admin/Owner: "No operational alerts — your center is running smoothly"

**Given** a Student viewing empty "My Performance" (s57)
**When** the empty state renders
**Then** ghosted/placeholder chart frames are shown with a message: "Complete your first assignment to see your progress"

**Given** a Teacher viewing empty Questions (s58)
**When** the empty state renders
**Then** an explanation of Q&A vs Inbox is shown with guidance on how students ask questions

**Given** a Teacher viewing empty Knowledge Hub (s59)
**When** the empty state renders
**Then** three add paths are shown: upload files, create folder, link from exercise

**Given** a Teacher viewing empty Archive (s60)
**When** the empty state renders
**Then** a message explains: "Completed classes and archived exercises will appear here"

**Given** a Teacher viewing Analytics with no data (s61)
**When** the empty state renders
**Then** ghosted chart frames are shown with: "Analytics will populate as students complete assignments"

**Given** a Student's first login dashboard (s62)
**When** the empty state renders
**Then** a guided welcome is shown with contextual actions: view class, check schedule, explore assignments

**Given** all empty states
**When** rendered
**Then** each offers at least one actionable path forward
**And** empty states are role-specific — teacher, student, and admin/owner see different content
**And** all text uses i18n translation keys

---

## Story 10.4: Error States

| Field        | Value              |
| ------------ | ------------------ |
| Size         | M                  |
| Audience     | Frontend           |
| Dependencies | All prior epics    |

**As a** user, **I want** clear, actionable error states, **so that** I understand what went wrong, why, and what I can do about it.

### Acceptance Criteria

**Given** a Student viewing a late-with-penalty graded submission (s63)
**When** the error state renders
**Then** the penalty math is shown clearly: "Original: 6.0 − Late penalty: 0.5 = Final: 5.5"
**And** the breakdown explains why the penalty was applied (submission after deadline)

**Given** a Student attempting to submit past the hard deadline (s64)
**When** the locked state renders
**Then** the submission is locked and read-only
**And** a message explains: "The deadline has passed — this submission is locked"
**And** the only suggested path is: "Contact your teacher to request an extension"

**Given** a Teacher encountering form validation errors (s65)
**When** validation fails on class creation
**Then** all errors are shown simultaneously (not one at a time): name conflict, invalid dates, capacity exceeds plan limit
**And** each field with an error shows inline red text with the specific issue
**And** plan limit errors include an "Upgrade" link

**Given** a Teacher opening a locked finalized assignment (s66)
**When** the locked state renders
**Then** the exercise is displayed as read-only with a "Locked" indicator
**And** two unlock paths are offered: "Clone" (creates editable copy) and "Unfinalize" (makes original editable with warning)

**Given** a Teacher deep-linking to center settings without Owner role (s67)
**When** the permission denied screen renders
**Then** it clearly shows which role is required: "This page requires the Owner role"
**And** the user's current role is shown for context
**And** a "Go to Dashboard" link provides a navigation escape

**Given** all error states
**When** rendered
**Then** each follows the three-part pattern: (1) what happened, (2) why, (3) what to do next as a clear action
**And** no generic error pages are used — every error names the specific issue
**And** all error text uses i18n translation keys

**Given** a user attempts an upload and storage is at 100% of plan total (per A9 locked decision),
**When** the upload control renders
**Then** an inline error displays: "Storage full. Delete files or upgrade to Studio." with a "View storage" CTA linking to Settings → Storage. The existing files remain accessible — only NEW uploads are blocked. Follows the three-part pattern: (1) what happened: storage full; (2) why: at plan limit; (3) what to do next: delete or upgrade.
