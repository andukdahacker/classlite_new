# Epic 3: Class Management & Scheduling

## Description

Covers the full lifecycle of classes from creation through scheduling and session management. Includes class CRUD with template pre-fill, the class detail view with tabbed navigation, template management for reuse, the schedule workspace with calendar views, and session-level detail with attendance recording.

## Functional Requirements

FR-12 through FR-19

## Stories

---

### Story 3.1: Class CRUD, Lifecycle & Creation UI

**Size:** L | **Audience:** Full-stack | **Dependencies:** Story 2.6

As a Teacher, Admin, or Owner,
I want to create, edit, and manage classes with lifecycle transitions,
So that I can organize teaching around structured class entities that reflect real-world progression.

**Acceptance Criteria:**

**Given** a valid class payload,
**When** POST `/api/classes` is called,
**Then** a new class is created with the provided details and an initial status of `Upcoming`.

**Given** a template is selected during class creation,
**When** the creation form renders,
**Then** all template fields are pre-filled with toggleable elements allowing the user to include or exclude specific template sections.

**Given** a class is created,
**When** the default settings are inspected,
**Then** due dates are OFF by default and must be explicitly enabled.

**Given** a class exists,
**When** its lifecycle is managed,
**Then** valid status transitions are enforced: Upcoming → Active → Paused ↔ Active → Ended, with no other transitions allowed.

**Given** the user navigates to `/classes` (screen s07),
**When** the classes index page renders,
**Then** Teachers see only their own assigned classes, while Admins and Owners see all classes in the center.

---

### Story 3.2: Class Detail View with Tabs

**Size:** L | **Audience:** Frontend | **Dependencies:** Story 3.1

As a user viewing a class,
I want a tabbed detail page showing all aspects of the class,
So that I can access students, assignments, sessions, materials, and analytics from a single location.

**Acceptance Criteria:**

**Given** the user navigates to `/classes/{id}` (screen s08),
**When** the class detail page renders,
**Then** the following tabs are displayed: Overview, Students, Assignments, Sessions, Materials, Analytics.

**Given** the Overview tab is active,
**When** the tab content renders,
**Then** class metadata (name, status, teacher, schedule), the next upcoming session, and quick analytics (attendance rate, student count) are displayed.

**Given** the Students tab is active (screen s09),
**When** the tab content renders,
**Then** the student roster is displayed with columns for attendance percentage, current band score, and enrollment status.

**Given** the Assignments tab is active (screen s09),
**When** the tab content renders,
**Then** a list of assignments for the class is displayed with title, due date, and submission count.

**Given** the Sessions tab is active (screen s09),
**When** the tab content renders,
**Then** all sessions for the class are listed with date, time, attendance count, and status.

**Given** the Materials tab is active (screen s09),
**When** the tab content renders,
**Then** uploaded and linked materials are displayed with file type, upload date, and session association.

**Given** the Analytics tab is active (screen s09),
**When** the tab content renders,
**Then** a placeholder view is displayed indicating that full analytics will be available in Epic 8.

**Given** any tab is selected,
**When** the data is fetched,
**Then** each tab loads data from its own separate API endpoint, enabling independent loading and caching.

---

### Story 3.3: Class Templates Management

**Size:** M | **Audience:** Full-stack | **Dependencies:** Story 2.2

As an Admin or Owner,
I want to manage class templates with full CRUD and reordering,
So that I can maintain a library of reusable class structures for consistent course delivery.

**Acceptance Criteria:**

**Given** the user navigates to `/classes/templates` (screen s19),
**When** the templates index page renders,
**Then** all templates are listed with title, skill focus, session count, and a "used N times" counter showing how many classes have been spawned from each template.

**Given** the user clicks on a template,
**When** they navigate to the template detail view (screen s20),
**Then** full template details are displayed including all sessions with their order, topics, and durations.

**Given** the user edits a template (screen s21),
**When** they drag to reorder sessions,
**Then** the session order is updated and persisted via the API.

**Given** a template is edited after classes have been spawned from it,
**When** the changes are saved,
**Then** already-spawned classes are NOT affected — template changes only apply to future spawns.

**Given** CRUD operations on templates,
**When** the API is called,
**Then** endpoints exist for create, read, update, and delete of templates, with appropriate authorization checks.

---

### Story 3.4: Schedule Workspace & Session Management

**Size:** L | **Audience:** Full-stack | **Dependencies:** Story 3.1

As a Teacher, Admin, or Owner,
I want a calendar-based schedule workspace to view and manage sessions,
So that I can plan, visualize, and adjust the teaching schedule across day, week, and month views.

**Acceptance Criteria:**

**Given** the user navigates to `/schedule` (screen s13),
**When** the schedule workspace renders,
**Then** day, week, and month calendar views are available with a mini-month navigator for quick date jumping.

**Given** sessions exist for classes,
**When** the calendar renders,
**Then** sessions are displayed as color-coded blocks matching their class color, with time and class name visible.

**Given** the user is an Admin or Owner,
**When** they view the schedule,
**Then** the calendar shows all sessions center-wide across all classes.

**Given** the user is a Student,
**When** they navigate to `/my-schedule` (screen s32),
**Then** a read-only calendar view is displayed showing only sessions for their enrolled classes.

**Given** the user clicks to create a new session (screen s14),
**When** the session creation modal opens,
**Then** it includes fields for date, time, duration, class, topic, and a recurrence pattern selector (none, daily, weekly, custom).

**Given** a recurring session is created,
**When** the recurrence is saved,
**Then** all generated session instances share a `recurrence_group_id` in the `sessions` table.

**Given** the user edits a recurring session,
**When** the edit modal opens,
**Then** an "Apply to..." scope selector is available with options: "This session only", "This and future sessions", "All sessions in group".

---

### Story 3.5: Session Detail & Attendance Recording

**Size:** M | **Audience:** Full-stack | **Dependencies:** Story 3.4

As a Teacher,
I want to view session details and record attendance,
So that I can manage each session's content and track student participation.

**Acceptance Criteria:**

**Given** the user navigates to a session detail view (screen s12),
**When** the page renders,
**Then** the following sections are displayed: session info (date, time, class, topic), attendance, materials, exercises, notes, and action buttons.

**Given** the attendance section is visible,
**When** the teacher views the student list,
**Then** each enrolled student is listed with a status selector: Present, Late, or Absent.

**Given** multiple students need attendance recorded,
**When** the teacher uses bulk actions,
**Then** options to "Mark all Present", "Mark all Absent", or apply a status to selected students are available.

**Given** a session has ended,
**When** attendance has not been marked for any student,
**Then** an Inbox prompt is generated reminding the teacher to record attendance for that session.

**Given** session data is persisted,
**When** the database is inspected,
**Then** records exist in the `attendance`, `session_materials`, `session_exercises`, and `session_notes` tables linked to the session.
