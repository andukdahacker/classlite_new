# Epic 8: Analytics, Dashboards & Search

**FRs:** FR-47 through FR-53, FR-67

---

## Story 8.1: Role-Specific Dashboards

| Field        | Value                  |
| ------------ | ---------------------- |
| Size         | L                      |
| Audience     | Full-stack             |
| Dependencies | 3.5, 5.1, 7.2         |

**As a** teacher/admin/owner/student, **I want** a role-specific dashboard at /dashboard, **so that** I see the information and actions most relevant to my role immediately after login.

### Acceptance Criteria

**Given** a Teacher navigating to `/dashboard` (s06)
**When** the teacher dashboard renders
**Then** it shows: a week-strip of upcoming sessions (scrollable, today highlighted), and three action rails:
**And** "Needs grading" rail: count + queue showing student name, assignment, class, and overdue flag
**And** "Unanswered questions" rail: count + preview showing question text, exercise anchor, and time elapsed
**And** "At-risk students" rail: showing attendance %, pending assignment count, and band score per flagged student

**Given** an Admin or Owner navigating to `/dashboard` (s48)
**When** the owner/admin dashboard renders
**Then** it shows a center pulse view: active classes count, students enrolled, staff active today, sessions this week/today
**And** a "Needs attention" card highlights: unassigned students, at-risk students, capacity warnings (approaching plan limits), and pending invites
**And** the dashboard is distinct from the teacher dashboard — center-wide aggregates, not personal teaching data

**Given** a Student navigating to `/dashboard` (s29)
**When** the student dashboard renders
**Then** it shows: upcoming sessions with time/class, "Due soon" card with assignments ordered by deadline and countdown, "Recent feedback" card with latest graded submissions and band scores, and "My questions" card with open Q&A threads awaiting teacher reply
**And** the dashboard is read-only — no management actions
**And** first-login empty state shows a guided welcome with contextual actions (s62)

**Given** the teacher dashboard on mobile (s82)
**When** rendered at 390px
**Then** it shows a triage view optimized for between-session use with the grading queue and questions prominent

**Given** the student dashboard on mobile (s74)
**When** rendered at 390px
**Then** it shows an above-fold "what do I need to do?" view with countdown cards for due assignments

**Given** the dashboard APIs
**When** GET `/api/dashboard` is called
**Then** the response is role-scoped: teacher gets teaching data, student gets personal data, admin/owner gets center-wide aggregates
**And** each section's data is sourced from existing tables (submissions, questions, attendance, sessions, enrollments)

---

## Story 8.2: Analytics Home & Class Performance

| Field        | Value              |
| ------------ | ------------------ |
| Size         | L                  |
| Audience     | Full-stack         |
| Dependencies | 6.1, 6.4          |

**As a** teacher/admin/owner, **I want** an analytics home and class performance view, **so that** I can monitor class-level trends, identify weak areas, and intervene early.

### Acceptance Criteria

**Given** a user navigating to `/analytics` (s45)
**When** the analytics home renders
**Then** it branches based on role: Teacher sees their own classes and students, Admin/Owner sees all classes and students center-wide, Student is redirected to their "My Performance" view

**Given** a user navigating to `/analytics/class/{id}` (s46)
**When** the class performance view renders
**Then** it shows: avg band over time (weekly sparkline), target band line, skill × week heatmap (four IELTS criteria vs. weeks), class-wide repetitive mistake patterns, at-risk student list, and on-time submission rate

**Given** the repetitive mistakes section
**When** displaying patterns
**Then** mistakes are aggregated from: auto-graded answer errors, Writing error/praise tags from grading comments, and Speaking transcript flags
**And** each pattern shows: description, instance count, trend direction (improving/worsening), and affected student count

**Given** the skill × week heatmap
**When** rendered
**Then** the four grading criteria (Task Response, Coherence & Cohesion, Lexical Resource, Grammatical Range) are rows
**And** weeks are columns
**And** cell colors indicate average band for that criterion in that week (red=low, green=high)

**Given** the analytics API
**When** GET `/api/analytics/classes/{id}` is called
**Then** the response includes: band_over_time (array of weekly averages), skill_heatmap (criterion × week matrix), mistake_patterns (aggregated from grades), at_risk_students (list with reasons), submission_rate (on-time percentage)
**And** data is computed from grades, submissions, and attendance tables
**And** the endpoint respects role scoping — teachers can only access their own classes

---

## Story 8.3: Student Performance Views

| Field        | Value              |
| ------------ | ------------------ |
| Size         | L                  |
| Audience     | Full-stack         |
| Dependencies | 8.2                |

**As a** teacher/admin/owner, **I want** a student performance detail view, and **as a** student, **I want** a "My Performance" view, **so that** individual progress and recurring patterns are visible and actionable.

### Acceptance Criteria

**Given** a Teacher/Admin/Owner navigating to `/analytics/student/{id}` (s47)
**When** the student performance view renders
**Then** three tabs are available: Overview, Mistakes, Recommendations

**Given** the Overview tab
**When** displayed
**Then** it shows: band progression chart (over time, per skill), per-skill bar breakdown, submission count, and praise/error pin counts from grading comments

**Given** the Mistakes tab
**When** displayed
**Then** expandable rows show: mistake category, actual quotes from graded submissions, teacher notes, skill tag, and frequency
**And** the list is filterable by skill (Reading/Listening/Writing/Speaking)

**Given** the Recommendations tab
**When** displayed
**Then** AI-generated recommendations suggest exercises or Knowledge Hub materials based on the student's mistake patterns
**And** AI recommendations propose from existing content only — they do not generate new content
**And** teacher advice overrides AI recommendations
**And** each recommendation can be: assigned to the student, edited, or dismissed

**Given** a Student navigating to `/my-performance` (s37)
**When** the "My Performance" view renders
**Then** two tabs are shown: Overview and Patterns
**And** "Patterns" is a softened version of the teacher's "Mistakes" tab — no "mistakes" language, using neutral framing instead
**And** the student never sees class averages or other students' data

**Given** the student performance on mobile (s81)
**When** rendered at 390px
**Then** the view is optimized as a "glance not work" interface — key metrics prominent, charts simplified

**Given** the performance API
**When** GET `/api/analytics/students/{id}` is called
**Then** the response includes: band_progression, skill_breakdown, submission_stats, mistake_patterns, recommendations
**And** the student endpoint (`/api/analytics/me`) returns the same data but without class averages and with softened category labels

---

## Story 8.4: Global Search (Cmd+K)

| Field        | Value              |
| ------------ | ------------------ |
| Size         | M                  |
| Audience     | Full-stack         |
| Dependencies | 3.1, 4.1, 7.2     |

**As a** user, **I want** a Cmd+K (or Ctrl+K) command palette accessible from any screen, **so that** I can quickly find classes, students, exercises, assignments, and Knowledge Hub files without navigating menus.

### Acceptance Criteria

**Given** any authenticated user on any screen
**When** they press Cmd+K (or Ctrl+K on Windows)
**Then** a command palette / quick-switcher overlay appears with a search input focused
**And** the overlay is accessible from the search icon in the top bar as well

**Given** the search input
**When** the user types a query
**Then** results appear in real-time (debounced ~300ms) grouped by category: Classes, Students, Exercises, Assignments, Knowledge Hub files
**And** each result shows: icon, title, subtitle (e.g., class name for a student, skill for an exercise), and a navigation link

**Given** the search results
**When** scoped by role
**Then** Teachers see results from their own data only (their classes, their students, their exercises)
**And** Admin/Owner see center-wide results
**And** Students see only their classes, assignments, and performance

**Given** the search API
**When** GET `/api/search?q={query}` is called
**Then** the response returns categorized results with a maximum of 5 per category
**And** search uses PostgreSQL full-text search across relevant tables
**And** results are returned within 500ms (NFR-3)
**And** the endpoint enforces role-based scoping via RLS and middleware

**Given** the search palette keyboard navigation
**When** the palette is open
**Then** arrow keys navigate between results, Enter selects, and Escape closes
**And** the currently highlighted result is visually indicated
**And** the palette is accessible via screen reader with `role="combobox"` and `aria-expanded`

---

## Story 8.5: Analytics Seed Data Script

| Field        | Value              |
| ------------ | ------------------ |
| Size         | S                  |
| Audience     | Backend            |
| Dependencies | 5.1, 6.1          |

**As a** developer, **I want** a seed script that generates realistic graded submission data, **so that** analytics dashboards can be developed and tested without waiting for real usage.

### Acceptance Criteria

- `scripts/seed-analytics.sh` generates 50+ graded submissions across 3 classes with realistic IELTS band distributions (5.0-7.5 range), varied per-criterion scores, attendance records (85% present avg), and at-risk scenarios.
- Supports --center-id flag.
- Idempotent (can re-run without duplicates via unique constraints).
