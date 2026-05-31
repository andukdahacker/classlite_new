## Epic 7: People Management, Enrollment & Anchored Q&A

Admins/Owners can manage staff and students center-wide, perform enrollment actions (add/transfer/withdraw), and view detailed student profiles. Students and teachers communicate via anchored Q&A on exercises.

**FRs:** FR-38, FR-39, FR-40, FR-41, FR-42, FR-43, FR-44, FR-45, FR-46

### Story 7.1: Staff Management & Invitation

**Size:** M | **Audience:** Full-stack | **Dependencies:** 2.6

As an Admin or Owner,
I want to view all staff, see their workload, and invite new teachers and admins,
So that I can manage my center's team effectively.

**Acceptance Criteria:**

**Given** an Admin or Owner navigating to `/people/staff` (s39)
**When** the staff list renders
**Then** all staff (teachers and admins) are displayed with columns: name, role, classes assigned, load (sessions/week), status (active/pending/archived), last active date
**And** the Owner themselves are not listed in the staff list

**Given** a staff row click
**When** the staff detail view renders (`/people/staff/{id}`, s40)
**Then** it shows: profile info, role, assigned classes, schedule glance, load bar (e.g., 7/10 sessions/week with "heavy load" warning threshold), and recent activity

**Given** the load bar visualization
**When** a teacher's load approaches or exceeds the threshold
**Then** a visual warning indicator appears (e.g., orange/red bar segment)

**Given** Owner-only actions on staff detail
**When** an Owner views a staff member
**Then** actions available are: assign to class, reset password (triggers password reset email), archive staff, and force-logout (FR-80, deletes all refresh tokens)

**Given** the invite staff modal (`/people/staff?invite=new`, s41)
**When** opened by an Admin or Owner
**Then** fields shown are: email (required), name (optional), role selector (Teacher/Admin), optional class assignment, optional welcome note
**And** when the sender is Admin, the "Owner" role chip is hidden (FR-11)

**Given** a staff invitation
**When** POST `/api/staff/invite` is called
**Then** an invite record is created with a 7-day expiry
**And** an invite email is sent via Resend with the center name, inviter name, and acceptance link
**And** the invited staff member appears in the list with "Pending" status

**Given** the database
**When** checking existing schema
**Then** the `invites` table (created in Epic 1) is reused for staff invitations
**And** staff queries join `center_members` + `users` with role filtering

### Story 7.2: Student Lists & Student Detail View

**Size:** L | **Audience:** Full-stack | **Dependencies:** 3.1, 5.1

As a Teacher or Admin/Owner,
I want to see all my students with performance data and drill into individual student profiles,
So that I can monitor student progress and identify those who need attention.

**Acceptance Criteria:**

**Given** an Admin or Owner navigating to `/people/students` (s42)
**When** the center-wide student list renders
**Then** all students across all classes are displayed with columns: name, classes, teacher(s), avg band, status (Good/Normal/At-risk), joined date
**And** the list is filterable by class and teacher
**And** tabs are available: All, At-risk, New, Unassigned, Archived

**Given** a Teacher navigating to `/students` (s10a)
**When** their student roster renders
**Then** only students from their own classes are shown (distinct from center-wide list)
**And** tabs are available: All, At-risk, New, By class
**And** clicking a student row opens the student detail scoped to the teacher's data

**Given** the At-risk tab
**When** displayed
**Then** students are flagged as at-risk when any threshold is met: attendance drops below 70%, two or more consecutive assignments missed, or band score drops by ≥1.0 over the last 4 graded submissions

**Given** a student row click navigating to `/classes/{id}/students/{sid}` (s10)
**When** the student detail view renders
**Then** it shows: overall band (avg of last N submissions), per-skill breakdown (Reading/Listening/Writing/Speaking), attendance rate (%), pending/missing submissions count, on-time submission rate
**And** trend indicators compare: current vs. first month, current vs. class target, projected to reach target

**Given** the teacher notes sidebar on student detail
**When** the teacher adds a note
**Then** notes are displayed as a chronological comment log with timestamps
**And** notes support flagging, attachments, and @mention

**Given** the student detail API
**When** GET `/api/students/{id}` is called
**Then** the response includes: profile, enrolled classes, performance summary (overall band, per-skill scores, attendance rate, submission stats, trend data), and teacher notes
**And** the data is scoped: teachers see only data from their classes, admins/owners see center-wide

**Given** the database
**When** migrations run
**Then** a `student_notes` table exists: id, student_id, center_id, author_id, content, flagged (boolean), attachments (JSONB), created_at
**And** at-risk detection queries are implemented as views or computed in the analytics service

### Story 7.3: Enrollment Management

**Size:** M | **Audience:** Full-stack | **Dependencies:** 7.2

As an Admin or Owner,
I want to add, transfer, and withdraw students between classes with an audit trail,
So that student placement is controlled and every change is traceable.

**Acceptance Criteria:**

**Given** an Admin or Owner navigating to `/people/enrolment` (s43)
**When** the enrollment page renders
**Then** a compose row at the top allows creating enrollment actions
**And** below, an enrollment history table shows all past actions

**Given** the enrollment compose form
**When** creating an enrollment action
**Then** the form requires: student (searchable dropdown), action type (Add/Transfer/Withdraw), target class (for Add and Transfer), effective date, and optional note (visible to teacher only)
**And** for Transfer, the source class is shown as the student's current class

**Given** an "Add" enrollment action
**When** submitted via POST `/api/enrollments`
**Then** the student is added to the target class as of the effective date
**And** the teacher of the target class is notified
**And** the student is notified of the enrollment

**Given** a "Transfer" enrollment action
**When** submitted
**Then** the student is removed from the source class and added to the target class as of the effective date
**And** both teachers are notified
**And** the student is notified

**Given** a "Withdraw" enrollment action
**When** submitted
**Then** the student is removed from the class as of the effective date and moves to "Unassigned" status
**And** the teacher is notified

**Given** any enrollment action
**When** completed
**Then** the action is logged in the enrollment history with: student, action type, source class, target class, effective date, note, performed by, timestamp
**And** the history is immutable — no editing or deleting past entries (NFR-6)

**Given** enrollment restrictions
**When** a Teacher attempts an enrollment action
**Then** the request is rejected with 403 — only Admin/Owner can perform enrollment actions (FR-46)

**Given** the database
**When** migrations run
**Then** an `enrollments` table exists: id, center_id, student_id, class_id, enrolled_at, withdrawn_at (nullable), status (active/withdrawn/transferred)
**And** an `enrollment_history` table exists: id, center_id, student_id, action (add/transfer/withdraw), source_class_id (nullable), target_class_id (nullable), effective_date, note, performed_by, created_at
**And** RLS policies are applied

### Story 7.4: Anchored Q&A System

**Size:** L | **Audience:** Full-stack | **Dependencies:** 4.2, 5.2

As a Student,
I want to highlight content in an exercise and ask questions that my teacher can answer in-thread,
So that I get help on specific parts of the material without leaving the exercise.

**Acceptance Criteria:**

**Given** a Student viewing an exercise during an active attempt (`/exercises/{id}/attempt?questions=open`, s36)
**When** they highlight a specific item (question, passage text, or option)
**Then** a Q&A sidebar opens with the option to type a question anchored to that item
**And** questions can also be anchored to the whole exercise (not item-specific)
**And** each question shows an anchor pin: orange for item-specific, blue for whole exercise

**Given** the Q&A sidebar during an attempt
**When** the student opens it
**Then** they can view existing questions and answers for this exercise without leaving the attempt interface
**And** the sidebar does not interfere with the attempt interaction

**Given** a Teacher viewing the Q&A sidebar (`/exercises/{id}?questions=open`, s18)
**When** the sidebar renders
**Then** all open questions across their exercises are visible with the anchored context shown
**And** a filter for "unanswered" is available

**Given** a teacher answering a question
**When** they reply
**Then** the reply appears in the thread below the student's question
**And** a reply visibility toggle is available: Private (visible only to the asking student) or Shared (visible to the entire class)
**And** a "Send & resolve" combined action marks the question as resolved

**Given** batch handling of similar questions
**When** the teacher selects multiple similar questions
**Then** "N selected · similar questions" indicator appears with a combined reply option
**And** the batch reply is sent to all selected question threads

**Given** resolved questions
**When** a question is resolved
**Then** it is removed from the active (unanswered) queue
**And** it remains visible in the thread history but no longer shows in the teacher's action count

**Given** the Q&A → Inbox integration (FR-40)
**When** questions remain unanswered
**Then** they appear as action items in the teacher's Inbox with count and time elapsed
**And** the teacher dashboard "Unanswered questions" action rail shows the question text, exercise anchor, and time elapsed

**Given** the database
**When** migrations run
**Then** a `questions` table exists: id, center_id, exercise_id, student_id, anchor_type (item/exercise), anchor_ref (JSONB — question ID, passage offset, etc.), content, status (open/resolved), created_at
**And** a `question_replies` table exists: id, question_id, author_id, content, visibility (private/shared), created_at
**And** Admin has NO visibility into Q&A — it is teacher↔student only
**And** RLS policies are applied
