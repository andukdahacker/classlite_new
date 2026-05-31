---
title: ClassLite v2
status: final
created: 2026-05-26
updated: 2026-05-27
---

# PRD: ClassLite v2

## 0. Document Purpose

This PRD defines ClassLite v2 — a ground-up rewrite of the ClassLite tutoring center management platform. It is written for the product owner, downstream UX designers, architects, and developers who will build the system. Features are grouped by domain; functional requirements (FRs) are numbered globally for stable cross-referencing. Assumptions are tagged inline as `[ASSUMPTION]` and indexed in §9. The companion IA document (`docs/classlite-entry/classlite-ia.md`) and 93-screen mockup set are the authoritative UX reference; this PRD builds on them; it does not duplicate screen-level layout details.

---

## 1. Vision

ClassLite is a purpose-built SaaS platform for tutoring centers and freelance teachers, starting in Vietnam. It replaces the patchwork of WhatsApp groups, shared Google Sheets, paper gradebooks, and manual scheduling that most small-to-mid tutoring operations rely on today — with a single tool that handles classes, students, exercises, grading, scheduling, and analytics.

The core differentiator is **AI-assisted grading**. Teachers spend hours per week marking Writing and Speaking submissions by hand. ClassLite's AI proposes band scores, flags errors, suggests feedback comments, and lets the teacher accept, edit, or override — cutting grading time dramatically while keeping the teacher in control of the final mark.

ClassLite is built for **IELTS** — band scoring across the four criteria (Task Response, Coherence & Cohesion, Lexical Resource, Grammatical Range & Accuracy), exercise types mapped to Reading/Listening/Writing/Speaking, and pre-built class templates tuned to common IELTS prep formats. Expansion to other subjects (TOEFL, other languages, math) is a future goal but not an MVP concern. The UI is bilingual (Vietnamese + English) from day one.

---

## 2. Target User

### 2.1 Primary Personas

**Center Owner (Operator/Founder).** Runs a tutoring center with 2–15 teachers and 50–300 students. Manages staff, enrollment, billing, and wants visibility into center-wide performance without micromanaging teachers. In Vietnam, often a former teacher who grew into a business operator.

**Freelance Teacher (Solo).** Teaches 1–5 classes independently. No center management overhead — just needs class, exercise, grading, and student communication tools. Often a university graduate or part-timer supplementing income with IELTS tutoring.

**Student.** Enrolled in one or more classes. Completes assignments (Writing essays, Speaking recordings, Reading/Listening quizzes), receives graded feedback, tracks their own performance. Age range typically 16–30. Mobile-first consumption pattern.

### 2.2 Jobs To Be Done

- **Owner:** "I need to see how my center is performing — which students are at risk, which teachers are overloaded, whether we're hitting band targets — without chasing people on Zalo."
- **Owner:** "When a new cohort starts, I want to spin up classes from a proven template in minutes, not rebuild everything from scratch."
- **Teacher:** "I spend 3 hours every Sunday grading Writing essays. I want that down to 30 minutes without sacrificing quality."
- **Teacher:** "I need my exercises, materials, and student data in one place — not scattered across Google Drive, a grading spreadsheet, and WhatsApp."
- **Student:** "I want to see my band score, understand what I got wrong, and know what to work on next — without waiting days for the teacher to get back to me."
- **Student:** "I want to do my Writing practice and get feedback on my phone, not haul a laptop to the coffee shop."

### 2.3 Non-Users (v1)

- **Parents.** No parent portal or parent-facing features in v1. `[ASSUMPTION: Parent communication happens outside ClassLite for now.]`
- **Large institutions** (universities, school districts). ClassLite targets small-to-mid centers (≤15 teachers). Enterprise features like SSO, branch chains, and org hierarchies are out of scope.
- **Self-study learners** with no teacher. ClassLite requires a teacher-student relationship; it is not a self-serve learning app.

### 2.4 Key User Journeys

- **UJ-1. Owner sets up a new center and launches classes.**
  - **Persona + context:** Linh runs a 5-teacher IELTS center in Ho Chi Minh City. She just signed up.
  - **Entry state:** Unauthenticated. Lands on `/welcome`.
  - **Path:** Picks "Founder" persona → names her center, picks a brand color → selects the "Writing Bootcamp 6.5" template → spawns 3 classes from it, assigning teachers (one to herself, two to staff she invites by email) → optionally pastes student emails.
  - **Climax:** Sees the dashboard with her 3 classes created, teachers invited (pending), and a "Finish setting up" checklist showing 3/7 done.
  - **Resolution:** Linh is on the Owner dashboard. Remaining setup tasks (enroll students, set up billing) are visible and actionable. Teachers receive invite emails.

- **UJ-2. Teacher grades a batch of Writing submissions with AI assistance.**
  - **Persona + context:** Minh teaches two Writing classes (28 students total). 14 essays just came in.
  - **Entry state:** Authenticated, on the Teacher dashboard. "Needs grading" badge shows 14.
  - **Path:** Clicks the first submission → sees the student's essay with AI-proposed band scores for all 4 IELTS criteria and 3 AI-suggested inline comments (error/praise/suggestion) → accepts 2 comments, edits 1, adds a manual comment → reviews the AI band proposal, bumps Coherence from 6.0 to 6.5 → submits grade → navigates to next student via "Next" button.
  - **Climax:** After ~3 minutes per essay (vs. 12 minutes manual), Minh has graded all 14. Students are notified.
  - **Resolution:** "Needs grading" badge is zero. Minh's grading data feeds into class analytics.

- **UJ-3. Student completes a Writing assignment and receives feedback.**
  - **Persona + context:** Trang is preparing for IELTS, enrolled in Minh's Writing class. A new assignment is due Thursday.
  - **Entry state:** Authenticated on phone, sees "Due soon" on her dashboard.
  - **Path:** Taps the assignment → reads the Writing Task 2 prompt → writes her essay in the built-in editor (autosave, word count visible) → submits before deadline.
  - **Climax:** Two days later, gets an inbox notification: "Your essay has been graded." Opens the result — sees overall band 6.0, per-criterion breakdown, and 5 inline comments anchored to specific parts of her essay.
  - **Resolution:** Trang sees her band trend in "My performance" — up from 5.5 last month. She taps a comment to understand a grammar error.

- **UJ-4. Owner monitors center health and intervenes on an at-risk student.**
  - **Persona + context:** Linh checks her center dashboard on Monday morning.
  - **Entry state:** Authenticated, Owner dashboard.
  - **Path:** Sees 3 at-risk students flagged across her center → clicks into one → sees attendance dropped to 60%, last 2 assignments missed, band trending down → reviews the teacher's notes → navigates to enrollment to check if a class transfer might help.
  - **Climax:** Linh understands the situation without messaging the teacher. She decides to flag it and let the teacher handle it.
  - **Resolution:** The at-risk signal is visible; the data is centralized. No Zalo messages needed.

---

## 3. Glossary

- **Center** — The organizational entity representing a tutoring center or school. All data is scoped to a center. A solo teacher operates within a single-user center.
- **IELTS Band Score** — The assessment scale used throughout ClassLite. Ranges from 1.0–9.0 in 0.5 increments. Calculated per criterion and overall. The four IELTS Writing/Speaking criteria are: Task Response (or Task Achievement for Task 1), Coherence & Cohesion, Lexical Resource, Grammatical Range & Accuracy.
- **Class Template** — A reusable blueprint for a class, containing a session plan with ordered sessions, each linking to documents and exercises. Templates can be duplicated ("spawned") into live classes.
- **Class** — A live teaching group with an assigned teacher, enrolled students, a schedule, and linked assignments. Created from a template or from scratch.
- **Session** — A single scheduled meeting within a class. Sessions can recur on a pattern (e.g., Mon+Wed 19:00–21:00). Individual sessions can be rescheduled or cancelled without affecting the series.
- **Exercise** — An authored assessment containing sections, question groups, and questions. Types include Reading passages, Listening audio, Writing prompts, and Speaking cue cards. Exercises live in the teacher's exercise library and can be assigned to multiple classes.
- **Assignment** — An exercise assigned to a specific class with a deadline. Once assigned, students can attempt it.
- **Submission** — A student's completed attempt at an assignment. Follows a lifecycle: In Progress → Submitted → (optionally) AI Processing → Graded.
- **Grading Rubric** — The IELTS criteria used to evaluate a submission. Writing and Speaking use the four criteria; Reading and Listening use raw score converted to band.
- **AI Credit** — A metered unit consumed when the system performs AI-assisted operations (grading suggestions, content generation). Credits are allocated per plan tier per month.
- **Knowledge Hub** — A shared, foldered document and file repository accessible to teachers and (selectively) students.
- **Inbox** — A role-scoped notification center. Not a messaging product — surfaces actionable items (ungraded submissions, student questions, enrollment events, billing alerts).
- **Anchored Q&A** — A Docs-style question-and-answer sidebar attached to exercises. Students highlight content to ask questions; teachers reply in-thread. Not a chat system.
- **At-Risk Student** — A student flagged by the system when any of these thresholds are met: attendance drops below 70%, two or more consecutive assignments missed, or band score drops by ≥1.0 over the last 4 graded submissions. Thresholds are system-defined. `[ASSUMPTION: At-risk thresholds are not user-configurable in MVP.]`

---

## 4. Features

### 4.0a Landing Page

**Description:** A public-facing marketing page that serves as the product's front door. Visitors see the value proposition, feature highlights, pricing tiers, and a clear path to sign up. The page must work without authentication and be indexable by search engines. This is the top of the acquisition funnel that feeds into the Free tier (§12).

**Functional Requirements:**

#### FR-71: Public landing page
An unauthenticated visitor landing on the root URL (`/`) sees a single-page marketing layout: hero section with headline and primary CTA ("Get started free"), feature highlight blocks (AI grading, class management, analytics), a social proof section (placeholder for testimonials/logos), and a footer with legal links (Terms, Privacy).

**Consequences (testable):**
- The page loads without authentication.
- The page is server-rendered or statically generated for SEO (indexable by search engines, includes meta tags and Open Graph data).
- Primary CTA navigates to the signup flow (FR-75).
- The page is bilingual — language toggle (Vietnamese/English) is visible in the header. Default language is detected from browser locale. `[ASSUMPTION: Landing page ships with Vietnamese and English only, matching the app.]`

#### FR-72: Pricing section
The landing page includes a pricing comparison section displaying the three tiers (Free, Pro, Studio) with feature limits from FR-61. Each tier card has a CTA: Free → "Start free", Pro/Studio → "Start free trial" or "Get started."

**Consequences (testable):**
- Pricing is displayed in VND (consistent with FR-61).
- Annual/monthly toggle is present; annual shows the savings callout.
- All tier CTAs route to the signup flow (FR-75).
- Tier feature lists match the limits defined in FR-61.

#### FR-73: Authenticated redirect
If a user who is already logged in visits the landing page, they are redirected to their role-appropriate dashboard.

**Consequences (testable):**
- Logged-in Owner/Admin → Owner dashboard.
- Logged-in Teacher → Teacher dashboard.
- Logged-in Student → Student dashboard.
- Users mid-onboarding → resume onboarding (FR-6).

#### FR-74: Responsive landing page
The landing page is fully responsive at mobile breakpoints (390×844 reference, consistent with screens s74–s87).

**Consequences (testable):**
- Hero, features, pricing, and footer stack vertically on mobile.
- CTA buttons are full-width on mobile.
- No horizontal scrolling at any breakpoint.

---

### 4.0b Authentication

**Description:** Authentication is the gate between the public landing page and the product. Covers registration, login, logout, password recovery, email verification, and invite acceptance. All auth flows delegate credential storage and token management to the chosen auth provider (Open Question #6). ClassLite never stores raw passwords.

**Functional Requirements:**

#### FR-75: Email/password registration
A visitor can create an account with: email (required, unique), password (required, minimum 8 characters), and full name (required). Registration is accessible from the landing page CTA and from invite acceptance links.

**Consequences (testable):**
- Duplicate email shows a clear error ("An account with this email already exists — log in instead?").
- Password strength indicator is displayed (weak/medium/strong).
- After successful registration, the user is redirected to email verification (FR-76).
- Registration is rate-limited to prevent abuse.

#### FR-76: Email verification
After registration, the system sends a verification email with a time-limited link. The user must verify their email before accessing the product.

**Consequences (testable):**
- Verification link expires after 24 hours.
- "Resend verification email" is available on the verification-pending screen (rate-limited to 1 per 60 seconds).
- Unverified users who attempt to log in see a "Please verify your email" screen with the resend option.
- Once verified, the user is redirected to onboarding (FR-1). `[ASSUMPTION: Email verification is required before product access. No grace period for unverified accounts.]`

#### FR-77: Login and logout
Returning users log in with email and password. A "Remember me" toggle extends session duration. Logout is accessible from the user pill (bottom-left sidebar).

**Consequences (testable):**
- Failed login shows a generic error ("Invalid email or password") — does not reveal whether the email exists.
- Login is rate-limited: after 5 failed attempts within 10 minutes, the account is temporarily locked for 15 minutes with a lockout message.
- "Remember me" extends session to 30 days; without it, session expires after 24 hours of inactivity. `[ASSUMPTION: Session duration values are defaults — exact values are an architecture decision.]`
- Logout clears the session and redirects to the landing page.

#### FR-78: Password reset
"Forgot password?" link on the login screen triggers a reset flow: enter email → receive reset link → set new password.

**Consequences (testable):**
- Reset link expires after 1 hour.
- After successful reset, all existing sessions for that user are invalidated.
- The reset email is sent regardless of whether the email exists in the system (prevents email enumeration).
- New password must differ from the current password.

#### FR-79: Invite acceptance flow
Staff invited via FR-42 receive an email with an invite link. Clicking it lands on an invite acceptance screen showing: center name, inviting user's name, assigned role, and a registration form (name pre-filled if provided, email locked to the invite address, password required).

**Consequences (testable):**
- Invite link expires after 7 days (consistent with FR-42).
- Expired invite shows a clear message with a "Request new invite" prompt.
- If the invited email already has an account, the flow links the existing account to the center instead of creating a new one.
- After acceptance, the user lands on their role-appropriate dashboard (skipping onboarding since the center already exists).

#### FR-80: Session management
The system maintains authenticated sessions using tokens issued by the auth provider. Sessions are validated on every server request.

**Consequences (testable):**
- Expired sessions redirect to login with a "Session expired — please log in again" message.
- Users can be logged in on multiple devices simultaneously.
- Owner can force-logout a staff member from the staff detail view (FR-41). `[ASSUMPTION: Force-logout is an Owner-only action. No "log out all devices" self-service in MVP.]`

#### FR-81: Google OAuth
Users can sign up and log in with their Google account as an alternative to email/password. Required for MVP — Gmail is the dominant email provider among Vietnamese students and teachers.

**Consequences (testable):**
- "Continue with Google" button is displayed on both signup and login screens.
- If the Google email matches an existing email/password account, the accounts are linked (user can use either method going forward).
- Google OAuth users skip email verification (Google has already verified the email).
- `[ASSUMPTION: Google OAuth is the only social login provider in MVP. Additional providers (Facebook, Apple) are deferred.]`

---

### 4.1 Onboarding

**Description:** A persona-forked setup wizard that gets a new user from signup to a working dashboard in under 5 minutes. The user picks a persona (Operator, Founder, Solo Teacher) which determines their product role and the onboarding path. Operator and Founder flows create a center, build or select a class template, and spawn classes. Solo Teacher creates a single class. All paths end at the dashboard with a "Finish setting up" checklist for remaining tasks. Realizes UJ-1.

**Functional Requirements:**

#### FR-1: Persona selection
User selects one of three personas (Operator, Founder, Solo Teacher) on first login. The selection determines their product role (Admin, Owner, Teacher respectively) and which onboarding steps are shown.

**Consequences (testable):**
- Operator → Admin role, sees center setup + template + spawn + done.
- Founder → Owner role, sees center setup + template + spawn + done (first class auto-assigned to self).
- Solo Teacher → Teacher role in a single-user center, sees first-class form + done.

#### FR-2: Center setup
Operator and Founder users configure their center: name (required), short code, brand color (6 preset options), and optional logo upload (defaults to auto-generated letter mark).

**Consequences (testable):**
- Center is created with the provided name and branding.
- Short code is auto-generated from center name if not provided.
- Letter mark renders using center name initial + selected brand color when no logo is uploaded.

#### FR-3: Template selection or creation
User can select from pre-built IELTS class templates or build a template from scratch. Template fields: name, target band, primary skill, session count, default schedule pattern.

**Consequences (testable):**
- At least 4 pre-built templates ship with the product (Writing Bootcamp 6.5, Speaking Mastery 7+, Foundation Listening+Reading, Starter Band 5.5 All Skills).
- "Build from scratch" option is always available.
- Selected template is editable before spawning.

#### FR-4: Class spawning
User duplicates the selected template into N live classes. Each spawned class requires a cohort name and teacher assignment. Teacher assignment supports inline invitation (email) for teachers not yet in the system. Student emails are optional at this stage.

**Consequences (testable):**
- Each spawned class is created as a live class with its own schedule, linked to the source template.
- Invited teachers receive an email invitation; their status shows as "Pending" until accepted.
- Founder's first spawned class is auto-assigned to the founder.

#### FR-5: Post-onboarding checklist
After onboarding, the dashboard shows a "Finish setting up" card with remaining tasks (e.g., enroll students, spawn more classes, set up billing). Progress is tracked as a fraction (e.g., 3/7). Card can be snoozed or dismissed.

**Consequences (testable):**
- Checklist items update as the user completes them.
- Snooze hides the card for 7 days.
- Dismiss permanently removes the card.

#### FR-6: Save and resume
All onboarding steps auto-save. User can exit at any point and resume where they left off.

**Consequences (testable):**
- Navigating away and returning restores the user's last completed step.
- A "skip this step" option is available on every step.

**Notes:** `[ASSUMPTION: Spreadsheet import as an alternative to onboarding (visible in mockups) is a post-MVP feature.]`

---

### 4.2 Center & Workspace Management

**Description:** Center-level configuration for the owner. Covers center profile, term calendar, integrations (Google Meet), and rooms. Single-center only — no branch switcher or multi-center management.

**Functional Requirements:**

#### FR-7: Center settings
Owner can edit center profile (name, logo, brand color, timezone), manage term calendar, configure room names, and connect integrations.

**Consequences (testable):**
- Only Owner role can access center settings.
- Teachers who deep-link to center settings see a "Permission denied" screen.
- Timezone setting applies to all schedule displays center-wide.

#### FR-8: Google Meet integration
Owner can connect Google Meet so that class sessions include an auto-generated meeting link.

**Consequences (testable):**
- When connected, new sessions include a Google Meet link visible to teacher and students.
- `[ASSUMPTION: Google Meet is the only integration in MVP. Google Drive integration is deferred.]`

---

### 4.3 Roles & Permissions

**Description:** Four fixed roles with a clear hierarchy: Owner > Admin > Teacher (these three form a ladder) and Student (separate consumer role). Most permissions are fixed to the role ladder. Two capabilities are editable by the Owner.

**Functional Requirements:**

#### FR-9: Role hierarchy and fixed permissions
The system enforces a fixed permission set per role. Teacher < Admin < Owner for management capabilities. Student is an independent consumer role.

**Consequences (testable):**
- Admin sees the same sidebar as Owner minus center settings and billing.
- Teacher sees only their own classes, students, exercises, and analytics.
- Student sees only their own classes, assignments, schedule, and performance.
- Admin cannot teach classes or see the Questions Q&A sidebar.

#### FR-10: Editable permissions
Owner can toggle two specific capabilities per role via a permissions matrix: "Can see teacher performance analytics" and "Can publish to Knowledge hub."

**Consequences (testable):**
- Changes to these two toggles take effect immediately.
- All other permission rows in the matrix are read-only.

#### FR-11: Owner-only role assignment
Only an Owner can assign the Owner role to another user. Admins can invite Teachers and Admins but not Owners.

**Consequences (testable):**
- The "Owner" role chip is hidden in the invite modal when the sender is Admin.

---

### 4.4 Class Management

**Description:** The core teaching unit. Classes are created from templates or from scratch, have an assigned teacher, enrolled students, a schedule, linked assignments, and materials. Teachers see their own classes; Admins and Owners see all classes center-wide. Realizes UJ-1, UJ-2.

**Functional Requirements:**

#### FR-12: Class creation
Teacher, Admin, or Owner can create a class from a template (pre-filling fields) or from scratch. Fields: name, description, teacher (required), target band, schedule pattern, capacity.

**Consequences (testable):**
- Creating from a template pre-fills session plan, documents, and exercises (each toggleable).
- Due dates from the template are off by default when creating from template.
- Form validation catches name conflicts, invalid dates, and capacity exceeding plan limits.

#### FR-13: Class detail and tabs
Each class has a detail view with tabs: Overview, Students, Assignments, Sessions, Materials, Analytics.

**Consequences (testable):**
- Overview shows class metadata, next session, and quick analytics (avg band by criterion).
- Students tab shows roster with attendance %, avg band, submission stats, status (Good/Normal/At-risk).
- Materials tab shows files with type, size, shared date, and view rate.

#### FR-14: Class lifecycle
Classes move through statuses: Upcoming → Active → Paused → Ended. Teachers can pause and resume classes.

**Consequences (testable):**
- Paused classes stop generating session reminders.
- Ended classes move to Archive after a configurable period. `[ASSUMPTION: Auto-archive period is 30 days after class end date.]`

#### FR-15: Class templates
Templates are first-class entities with their own index. Fields: title, skills, target band, session count, color. Each template contains an ordered session plan — sessions with title, description, linked documents (from Knowledge Hub), and linked exercises.

**Consequences (testable):**
- Templates show a "used N times" counter.
- Sessions within a template are drag-reorderable.
- Templates can be edited without affecting classes already spawned from them.

---

### 4.5 Scheduling & Sessions

**Description:** Teachers manage their schedule across all classes. Sessions recur on patterns (e.g., Mon+Wed 19:00–21:00) and can be individually rescheduled or cancelled. A calendar workspace (day/week/month views) provides the master schedule view.

**Functional Requirements:**

#### FR-16: Schedule workspace
Teacher sees a calendar (day/week/month views) with a mini-month navigator and filter controls. Sessions are created and edited in-place or via modal.

**Consequences (testable):**
- Admin/Owner sees center-wide schedule across all teachers.
- Student sees only their own sessions across enrolled classes (read-only).

#### FR-17: Session creation with recurrence
Sessions are created with a recurrence pattern. The create/edit modal supports setting recurrence and a "Delete → Apply to…" scope branch (this session only / this and future / all sessions).

**Consequences (testable):**
- Editing a single session in a recurring series does not affect other sessions unless the user selects a broader scope.
- Cancelling a session within a series marks it as cancelled without removing future sessions.

#### FR-18: Session detail
Each session shows: info, attendance, materials, linked exercises, teacher notes, and actions.

**Consequences (testable):**
- Materials and exercises can be attached to individual sessions.

#### FR-19: Attendance recording
Teacher manually marks attendance per student for each session. Statuses: Present, Late, Absent. `[ASSUMPTION: No automatic attendance (e.g., via session join) — teacher marks manually.]`

**Consequences (testable):**
- Attendance can be marked before, during, or after the session.
- Attendance data feeds into student detail (FR-46), class analytics (FR-49), and at-risk detection.
- Unmarked sessions show a "Mark attendance" prompt in the teacher's Inbox.

---

### 4.6 Exercise Authoring & Content

**Description:** Teachers build exercises in a structured editor. An exercise contains sections (passages, audio, prompts) with nested question groups. Question types include True/False/Not Given, gap-fill, matching headings, MCQ, short answer, and Speaking cue cards. The exercise library is searchable and filterable. Realizes UJ-2.

**Functional Requirements:**

#### FR-20: Exercise library
Teacher sees a table of all their exercises with columns: title, code, sections, question count, skills, tags, classes assigned, last modified, and actions.

**Consequences (testable):**
- Exercises are filterable by skill, tag, class, and assignment status (assigned/unassigned).
- Actions include Edit, Duplicate, and Archive.

#### FR-21: Exercise editor
The editor has two panels: left sidebar (exercise metadata — title, description, skill, tags, target band, classes assigned) and right main area (sections with drag-reorderable question groups).

**Consequences (testable):**
- Sections support passage text (Reading), audio with duration/sections (Listening), writing prompts (Writing), and cue cards (Speaking).
- Question groups within a section are drag-reorderable.
- Each question has text, type, options, and a correct answer.

#### FR-22: Exercise settings
Time limit toggle (countdown shown to students) and answer matching mode for gap-fill/short-answer auto-grading.

**Consequences (testable):**
- When time limit is enabled, students see a countdown timer during the attempt.
- Answer matching is case-insensitive by default.
- Answer normalization strips hyphens and extra whitespace before comparison (e.g., "hydro-electric" matches "hydroelectric").
- Teacher can add multiple accepted answer variants per question.

#### FR-23: Locked finalized assignments
Once an exercise has been assigned and students have submitted, it becomes read-only. The teacher can clone it or unfinalize to edit.

**Consequences (testable):**
- Attempting to edit a finalized exercise shows a "Locked" state with options to clone or unfinalize.

---

### 4.7 AI-Powered Content Generation

**Description:** Teachers can use AI to generate exercise sections, questions, or individual answer options. AI generation consumes credits from the center's monthly allocation. Realizes UJ-2.

**Functional Requirements:**

#### FR-24: AI section generation
Teacher can generate a full section (passage + question groups) by providing: section type, topic/source material (free text or Knowledge Hub document), target band, question count, and question type mix.

**Consequences (testable):**
- Generated content is shown in a preview before insertion.
- Each generation consumes credits; estimated cost is shown before confirming ("est. cost 1 credit").
- A credit counter is visible ("3 of 50 monthly AI credits used").

#### FR-25: AI question generation
Teacher can generate questions for an existing section by specifying topic, question type, and count.

**Consequences (testable):**
- Generated questions are previewed before insertion into the section.

#### FR-26: AI distractor generation
Teacher can generate individual distractor options for a question by specifying difficulty and count.

**Consequences (testable):**
- Generated distractors are previewed before insertion.

---

### 4.8 Assignments & Submissions

**Description:** Assignments link an exercise to a class with a deadline. Students attempt assignments through type-specific interfaces (quiz, writing editor, speaking recorder). Submissions follow a lifecycle and are graded by the teacher (with AI assistance for Writing and Speaking). Realizes UJ-3.

**Functional Requirements:**

#### FR-27: Assignment creation
Teacher creates an assignment by selecting an exercise, a class, a deadline, and optional custom instructions.

**Consequences (testable):**
- Assignment status: Open → Closed → Archived.
- Teacher can close an assignment before the deadline (preventing new submissions).

#### FR-28: Student attempt — Reading/Listening/Vocabulary
Split-pane interface: passage/audio on one side, questions on the other. Features: question flagging, Previous/Next navigation, timer (if enabled on exercise).

**Consequences (testable):**
- Student can flag questions for review before final submission.
- Timer auto-submits when time expires (if auto-submit is enabled on exercise).
- Answers are saved incrementally (not lost on connection drop). `[ASSUMPTION: Incremental save interval is every 30 seconds or on each answer change.]`

#### FR-29: Student attempt — Writing
Built-in Docs-style rich text editor with toolbar (bold, italic, underline, bullets, numbered list, undo/redo). Features: autosave, live word count vs. minimum, time-on-task tracker, due-date countdown.

**Consequences (testable):**
- Autosave triggers on every pause in typing (debounced).
- Word count updates in real time.
- The prompt is displayed as a blockquote above the editor.

#### FR-30: Student attempt — Speaking
In-app audio recorder with prep time countdown (e.g., 1 minute) followed by recording window (e.g., 1–2 minutes). Re-record is allowed before final submission.

**Consequences (testable):**
- Student can re-record as many times as they want before submitting.
- Only the final recording is submitted.

#### FR-31: Late submission handling
Submissions after the deadline are accepted but flagged. Late penalties are configurable per assignment.

**Consequences (testable):**
- Late submissions show a penalty calculation (e.g., 6.0 − 0.5 = 5.5) in the result view.
- Past a hard deadline, the submission is locked and read-only; the student's only path is to request an extension. `[ASSUMPTION: Extension requests are handled outside ClassLite in MVP — no in-app extension workflow.]`

#### FR-32: Submission result view
Student sees: overall band/score, per-criterion breakdown, teacher's written feedback, inline anchored comments, submission timestamp, and late/on-time status.

**Consequences (testable):**
- Results are only visible after the teacher releases the grade.
- Class average is explicitly hidden from student view.

---

### 4.9 Grading

**Description:** The grading system supports three modes: Writing grading (anchored inline comments, Docs-style), Speaking grading (audio player with timestamp-pinned comments), and Auto-grading (Reading/Listening/Vocabulary, marked against answer key). AI assistance is available for Writing and Speaking. The teacher always has final authority over the grade. Realizes UJ-2.

**Functional Requirements:**

#### FR-33: Writing grading with anchored comments
Teacher sees the student's essay with a highlight-and-pin system. Three comment types: Error (red), Praise (green), Suggestion (yellow). Each comment is tagged by grading criterion (e.g., Task Response, Coherence).

**Consequences (testable):**
- Comments are anchored to specific text spans or paragraphs.
- Band score inputs for each criterion + calculated overall band are displayed.
- "Submit grade & notify student" releases the grade and sends a notification.
- "Prev student / Next student" navigation enables queue-based grading.

#### FR-34: AI-assisted Writing grading
AI analyzes the essay and proposes: a band score per criterion with written rationale, and inline comments (error/praise/suggestion) with confidence levels (High/Medium).

**Consequences (testable):**
- Each AI suggestion can be Accepted, Edited, or Dismissed individually.
- Bulk "Accept all praise" is available.
- Disclaimer is always visible: "Suggestion — teacher always decides the final band."
- AI grading consumes credits.

#### FR-35: Speaking grading
Audio player with waveform and playback speed control. Teacher clicks the waveform to pin timestamped comments. Band inputs for Fluency, Lexical, Grammar, Pronunciation + overall.

**Consequences (testable):**
- Comments are anchored to specific timestamps in the audio.
- Playback speed is adjustable.

#### FR-36: AI-assisted Speaking grading
AI auto-transcribes the audio and proposes band scores per criterion. Identifies specific moments (hesitations, errors, strong delivery) with timestamps and confidence levels.

**Consequences (testable):**
- Transcription time and audio duration are displayed.
- "View transcript" button shows the full text.
- Each AI-flagged moment can be Accepted, Edited, or Dismissed.
- Teacher-saved notes and AI draft notes appear together chronologically.

#### FR-37: Auto-grading (Reading/Listening/Vocabulary)
Submissions are auto-marked against the answer key immediately on submission. Teacher sees: score (e.g., 11/14), percentage, provisional band, and per-answer breakdown.

**Consequences (testable):**
- Spelling variants are flagged for teacher override (e.g., "hydro-electric" vs "hydroelectric").
- Teacher can override any answer (mark correct/wrong); final score updates after overrides.
- Results are only visible to the student after the teacher clicks "Release result & notify."

---

### 4.10 Anchored Q&A

**Description:** A Docs-style question-and-answer sidebar attached to exercises. Students highlight specific content to ask questions; teachers answer in-thread. This is not a messaging product — it is scoped to exercise content. Teacher ↔ Student only; Admins have no visibility.

**Functional Requirements:**

#### FR-38: Student asks a question
Student highlights an item in an exercise to anchor a question. Questions can also be anchored to the whole exercise. Q&A is accessible both from the exercise library (teacher side) and during a student's active attempt (student side).

**Consequences (testable):**
- Each question shows an anchor pin (orange for specific item, blue for whole exercise).
- Questions appear in the sidebar with the anchored context visible.
- During an attempt, the student can open the Q&A sidebar without leaving the attempt interface.

#### FR-39: Teacher answers questions
Teacher sees all open questions across their exercises in the Q&A sidebar. Can answer in-thread, batch-select similar questions, and resolve.

**Consequences (testable):**
- Filter by unanswered is available.
- Batch select shows "N selected · similar questions" with a combined reply option.
- Reply visibility toggle: Private (to asking student only) or Shared (visible to entire class).
- "Send & resolve" combined action available.
- Resolved questions are removed from the active queue.

#### FR-40: Q&A feeds into Inbox
Unanswered questions appear as action items in the teacher's Inbox with count and time elapsed.

**Consequences (testable):**
- Questions are counted in the teacher dashboard "Unanswered questions" action rail.

---

### 4.11 People Management

**Description:** Admin/Owner manage staff (teachers and admins) and students center-wide. Enrollment is a controlled process (add/transfer/withdraw) — students do not self-enroll. Realizes UJ-4.

**Functional Requirements:**

#### FR-41: Staff list and detail
Admin/Owner see all staff with: name, role, classes assigned, load (sessions/week), status, last active. Staff detail shows profile, classes, schedule, load bar, and activity.

**Consequences (testable):**
- Load bar visualizes sessions/week against a max (e.g., 7/10) with a "heavy load" warning threshold.
- Owner-only actions on staff detail: assign to class, reset password, archive staff.

#### FR-42: Staff invitation
Admin/Owner invite staff via modal: email (required), name (optional), role (Teacher/Admin/Owner), optional class assignment, optional welcome note.

**Consequences (testable):**
- Invite expires in 7 days.
- Invited staff set their own password on acceptance.
- Owner role chip is hidden when sender is Admin.

#### FR-43: Center-wide student list
Admin/Owner see all students across all classes with: name, classes, teacher(s), avg band, status, joined date. Filterable by class and teacher. Tabs: All / At-risk / New / Unassigned / Archived.

**Consequences (testable):**
- Clicking a student row opens the student detail view (same as teacher's student detail, but scoped center-wide).

#### FR-44: Teacher's student roster
Teacher sees an aggregated roster of students across all classes they teach. Tabs: All / At-risk / New / By class.

**Consequences (testable):**
- Distinct from the center-wide student list (FR-43). Teacher sees only their own students.
- Row click opens the student detail view scoped to the teacher's data.

#### FR-45: Student detail view
Shows: overall band (avg last N submissions), per-skill breakdown, attendance rate, pending/missing submissions, on-time rate, trend indicators (vs first month, vs class target, projected to reach target). Includes a teacher's notes sidebar with flagging, attachments, and @mention.

**Consequences (testable):**
- Trend indicators compare current performance to the student's first month and the class target.
- Teacher notes are a chronological comment log.

#### FR-46: Enrollment management
Admin/Owner perform three enrollment actions: Add (new/unassigned → class), Transfer (class A → class B), Withdraw (class → unassigned). Each action requires: student, action type, target class, effective date, optional note (visible to teacher only).

**Consequences (testable):**
- All enrollment actions are logged in a history.
- Teachers and students are notified of enrollment changes.
- Teachers cannot perform enrollment actions.

---

### 4.12 Analytics

**Description:** Performance analytics scoped by role. Teachers see their own classes/students; Admin/Owner see center-wide. Students see only their own performance (softened framing). The analytics system aggregates data from grading, attendance, and submissions. Realizes UJ-4.

**Functional Requirements:**

#### FR-47: Analytics home
Role-scoped entry point branching to class performance and student performance views.

**Consequences (testable):**
- Teacher: shows classes they teach and students within those classes.
- Admin/Owner: shows all classes and all students center-wide.
- Student: redirected to their own "My performance" view.

#### FR-48: Class performance
Cohort-level analytics: avg band over time (weekly sparkline), target band, skill × week heatmap, class-wide repetitive mistakes (with instance count, trend direction, affected student count), at-risk student list, on-time submission rate.

**Consequences (testable):**
- Mistake patterns are aggregated from auto-graded answers, Writing error/praise tags, and Speaking transcript flags.
- Heatmap shows the four grading criteria vs. weeks.

#### FR-49: Student performance (teacher/admin/owner view)
Three tabs: Overview (band progression, per-skill bars, submission count, praise/error pin counts), Mistakes (expandable rows with actual quotes from graded submissions + teacher notes, filterable by skill), Recommendations (AI + teacher suggestions linked to exercises/Knowledge Hub materials).

**Consequences (testable):**
- AI recommendations propose from existing content only; teacher advice overrides AI.
- Each recommendation can be assigned to the student, edited, or dismissed.

#### FR-50: Student performance (student's own view — "My Performance")
Two tabs: Overview and Patterns (softened version of teacher's Mistakes view).

**Consequences (testable):**
- Student never sees class averages or other students' data.
- "Patterns" uses neutral framing (no "mistakes" language).

#### FR-51: Admin/Owner dashboard
Center pulse view: active classes count, students enrolled, staff active today, sessions this week/today. "Needs attention" card highlights: unassigned students, at-risk students, capacity warnings, pending invites.

**Consequences (testable):**
- Distinct from teacher dashboard (FR-52). Shows center-wide aggregates.

#### FR-52: Teacher dashboard
Week-strip of sessions, action rails: "Needs grading" (count + queue), "Unanswered questions" (count + preview), "At-risk students" (attendance %, pending count, band score per student).

**Consequences (testable):**
- Grading queue shows student name, assignment, class, and overdue flag.
- Questions rail shows question text, exercise anchor, and time elapsed.

#### FR-53: Student dashboard
Surfaces: upcoming sessions, work due soon (with countdown), and recent feedback. Read-only — no management actions. Realizes UJ-3.

**Consequences (testable):**
- "Due soon" card shows assignments ordered by deadline with time remaining.
- "Recent feedback" card shows the latest graded submissions with band scores.
- "My questions" card shows open Q&A threads awaiting teacher reply.
- First-login empty state shows a guided welcome with contextual actions.

---

### 4.13 Knowledge Hub

**Description:** A shared, foldered document and file repository. Teachers curate materials (PDFs, images, audio files); students access shared materials. Files can be linked to sessions and exercises.

**Functional Requirements:**

#### FR-54: Knowledge Hub management
Teachers can upload, organize (into folders), and manage files. File types include PDFs, images, and audio. Each file shows: preview, info, where it's linked, and actions.

**Consequences (testable):**
- Files can be linked to class sessions and exercise sections.
- "From Knowledge Hub" button in class materials and exercise editor pulls in existing files.
- Admin/Owner can curate (add/edit/delete); teachers can add; students can view files shared with their class.
- Publishing to Knowledge Hub is gated by the editable permission (FR-10).
- Files are shared at the class level — a file linked to a class's session or exercise is visible to that class's students. `[ASSUMPTION: No per-file sharing toggle in MVP — sharing is implicit via class linkage.]`

#### FR-55: File detail
Shows file preview (adapts by file type), metadata (type, size, upload date), where the file is linked (classes, exercises), and actions (download, rename, move, delete).

**Consequences (testable):**
- View rate is tracked (X of N students viewed).

---

### 4.14 Inbox & Notifications

**Description:** A role-scoped notification center that surfaces actionable items. Not a messaging product. Three distinct inbox variants by role.

**Functional Requirements:**

#### FR-56: Teacher Inbox
Central queue of: unanswered questions, ungraded submissions, late submissions, mentions. Per-row actions: Grade, Reply, Archive.

**Consequences (testable):**
- Items are actionable — clicking "Grade" navigates directly to the grading view.

#### FR-57: Student Inbox
Surfaces: teacher replies to questions, posted grades, comments on submissions, new assignments, schedule changes.

**Consequences (testable):**
- Items link directly to the relevant submission, question thread, or schedule.

#### FR-58: Admin/Owner Inbox
Operational signals: enrollment requests, new staff, integration health, billing events.

**Consequences (testable):**
- Billing events are visible only to Owner.

#### FR-59: Notification delivery
In-app notifications with unread badge on the Inbox sidebar item.

**Consequences (testable):**
- Badge count updates in real time (or near-real-time). `[ASSUMPTION: Real-time updates via WebSocket or polling — implementation detail for architecture.]`
- `[ASSUMPTION: Email notifications for critical events (grading complete, assignment due) are a post-MVP feature.]`

---

### 4.15 Archive

**Description:** Past classes, sessions, and exercises are archived rather than deleted. Archived items can be duplicated or edited as a copy.

**Functional Requirements:**

#### FR-60: Archive access
Teacher sees their own archived items; Admin/Owner see center-wide archived items.

**Consequences (testable):**
- Archived items are read-only.
- "Duplicate" creates a new editable copy.
- "Edit a copy" clones and opens for editing.

---

### 4.16 Billing & Plans

**Description:** Three subscription tiers (Free, Pro, Studio) with per-teacher pricing. Billing is Owner-only. Plan limits enforce student-per-class caps, teacher count, AI credit allocation, and storage. Soft warnings before hard blocks.

**Functional Requirements:**

#### FR-61: Plan tiers
Three tiers with limits:

| Limit | Free | Pro | Studio |
|---|---|---|---|
| Teachers | 1 | Up to 10 | Unlimited |
| Classes | 1 | Unlimited | Unlimited |
| Students per class | 5 | 20 | 60 |
| AI credits/month | — | 500 | 2,000 + add-on packs |
| Knowledge Hub storage | 500 MB | 5 GB | 50 GB |

Pricing is displayed in VND. `[ASSUMPTION: Exact VND price points TBD — mockup USD figures ($20–$49/teacher/mo) serve as reference for tier positioning, not final prices.]`

**Consequences (testable):**
- Free tier has no AI grading credits.
- Annual billing saves the equivalent of 2 months vs. monthly.

#### FR-62: Plan limit enforcement
Soft warning banners appear as usage approaches limits (e.g., 18/20 students). Hard block when attempting to exceed the cap.

**Consequences (testable):**
- Soft warning shows two resolution paths: upgrade or restructure (e.g., split the class).
- Warning re-appears at each threshold step (18, 19, then block at 20).
- Hard block prevents the action but does not degrade existing access.

#### FR-63: Upgrade and downgrade
Upgrades are prorated (day-count credit applied, math shown in modal). Downgrades take effect at next renewal.

**Consequences (testable):**
- Upgrade modal shows prorated calculation before confirmation.
- Downgrade does not remove data — it restricts access when the new tier's limits are exceeded.

#### FR-64: AI credit add-on
Centers can purchase additional AI credit packs as one-time purchases.

**Consequences (testable):**
- Add-on credits are consumed after the monthly allocation is exhausted.
- `[ASSUMPTION: Add-on credit packs are available on Pro and Studio tiers only.]`

#### FR-65: Payment failure and grace period
7-day grace period on payment failure: auto-retry on day 3 and day 5, warning emails on days 0, 3, 5, 6. Auto-downgrade to Free on day 7 (23:59).

**Consequences (testable):**
- During grace: red top strip on every page.
- On auto-downgrade: nothing is deleted; AI grading pauses; second teacher seat locks; classes over 5 students become read-only.
- Recovery: update payment method and retry charge.

#### FR-66: Invoice management
Invoice history with filter, download PDF, retry failed payment. CSV export and "Email all to accountant" available.

**Consequences (testable):**
- Invoice statuses: Paid, Declined, Declined → Paid, Refunded, Upcoming, Free.
- Tax (e.g., 10% VAT for Vietnam) is itemized on invoices.

**Notes:** Payment provider is Polar.sh. The system must never store or handle raw payment data — delegated entirely to Polar.

---

### 4.17 Search

**Description:** A global search accessible via the top bar (⌘K shortcut). Searches across classes, students, exercises, assignments, and Knowledge Hub files.

#### FR-67: Global search
User can search from any screen. Results are scoped to the user's role permissions.

**Consequences (testable):**
- Teachers see results from their own data only.
- Admin/Owner see center-wide results.
- `[ASSUMPTION: Search UI is a command palette / quick-switcher. Full search UX is not drawn in mockups — implementation follows standard patterns.]`

---

### 4.18 User Profile

**Description:** Common profile and settings screen available to all roles.

#### FR-68: Profile management
User can update their name, avatar, email, password, language preference (Vietnamese/English), and notification settings.

**Consequences (testable):**
- Language preference switches the entire UI immediately.
- Profile screen renders in the user's current role shell.

---

### 4.19 Empty & Error States

**Description:** Purpose-designed empty states guide first-time users with contextual CTAs. Error states provide clear recovery paths.

#### FR-69: Empty states
Each major section has a designed empty state with guided actions (e.g., "Dashboard day-one" shows a 3-step start guide; "Classes empty" shows 3 paths to create).

**Consequences (testable):**
- Empty states are role-specific (teacher, student, admin/owner inbox variants).
- Each empty state offers at least one actionable path forward.

#### FR-70: Error states
The system handles: late-with-penalty graded views, locked past-deadline submissions, form validation errors (name conflicts, invalid dates, capacity limits), locked finalized assignments, and permission denied screens.

**Consequences (testable):**
- Permission denied screen shows which role is required to access the page.
- Form validation shows all errors simultaneously (not one at a time).
- Late-with-penalty view shows the penalty math (original − penalty = final).

---

## 5. Non-Goals (Explicit)

- **Not a messaging product.** No direct messaging, no chat. Communication is limited to submission comments, anchored Q&A, and inbox notifications.
- **Not a self-serve learning app.** Students cannot browse or enroll in classes independently. All enrollment is admin/teacher-controlled.
- **No parent portal.** Parent-facing features are out of scope.
- **No multi-center / branch management.** Single center per workspace. Multi-branch is a future tier feature.
- **No marketplace.** Teachers cannot sell exercises or templates to other teachers.
- **No video conferencing.** ClassLite integrates with Google Meet but does not build its own video.
- **No custom grading rubrics.** Grading criteria follow the IELTS standard and are not user-configurable.
- **No SCORM/LTI integration.** No interop with LMS standards.
- **No offline mode.** Requires internet connection for all features.

---

## 6. MVP Scope

### 6.1 In Scope

- Public landing page with value proposition, feature highlights, pricing display, and signup CTA
- Authentication (email/password registration, email verification, login/logout, password reset, invite acceptance, Google OAuth)
- Persona-forked onboarding (Operator, Founder, Solo Teacher)
- Center setup with branding
- Four roles (Owner, Admin, Teacher, Student) with fixed permission ladder
- Class templates and class management (create, spawn, lifecycle)
- Session scheduling with recurrence
- Exercise authoring (Reading, Listening, Writing, Speaking question types)
- AI-powered content generation (sections, questions, distractors)
- Assignments with deadlines and late handling
- Student attempt interfaces (quiz, writing editor, speaking recorder)
- Grading: Writing (anchored comments), Speaking (timestamp-pinned), Auto-grade (Reading/Listening/Vocab)
- AI-assisted grading for Writing and Speaking
- Anchored Q&A (student ↔ teacher)
- People management (staff, students, enrollment)
- Analytics (class performance, student performance, dashboards)
- Knowledge Hub (file repository)
- Inbox (role-scoped notifications)
- Archive
- Billing (Free/Pro/Studio tiers, plan limits, grace period)
- Global search (⌘K)
- Bilingual UI (Vietnamese + English)
- Responsive design (desktop + mobile breakpoints per mockup screens s74–s87)
- IELTS grading criteria and exercise types (hardcoded, not abstracted)

### 6.2 Out of Scope for MVP

- **Other subjects** (TOEFL, math, languages) — future expansion. No abstraction layer needed now; build for IELTS directly.
- **Spreadsheet import** for bulk class/student setup — deferred.
- **Google Drive integration** — only Google Meet in MVP.
- **Email notifications** for grading, assignments, schedule changes — in-app only for MVP. `[NOTE FOR PM: High user demand likely. Plan for fast follow.]`
- **Custom grading rubrics** — IELTS criteria are hardcoded.
- **SSO / SAML** — enterprise feature, deferred.
- **White-label** — removed from scope entirely.
- **Parent portal** — deferred indefinitely.
- **Bulk operations** (batch student enrollment, batch grading) — UI patterns defined (modal/drawer) but no specific bulk operations built.
- **Push notifications** (mobile web) — deferred.

---

## 7. Success Metrics

**Primary**

- **SM-1:** Weekly Active Teachers (WAT) — teachers who log in and perform at least one grading or exercise action per week. Target: 80% of registered teachers. Validates FR-33, FR-34, FR-37.
- **SM-2:** Grading time per essay — median time from opening a Writing submission to releasing the grade. Target: ≤5 minutes (down from ~12 minutes manual baseline). Validates FR-33, FR-34.
- **SM-3:** Onboarding completion rate — percentage of users who complete onboarding through to dashboard. Target: >70%. Validates FR-1 through FR-6.

**Secondary**

- **SM-4:** Student submission rate — percentage of assigned work submitted before deadline. Target: >75%. Validates FR-27 through FR-30.
- **SM-5:** AI suggestion acceptance rate — percentage of AI grading suggestions accepted without edit. Target: 40–60% (too high suggests rubber-stamping; too low suggests poor AI quality). Validates FR-34, FR-36.
- **SM-6:** Free-to-Pro conversion rate — percentage of Free tier centers that upgrade within 60 days. Target: >15%. Validates FR-61, FR-62.
- **SM-7:** Monthly center retention rate — percentage of paying centers (Pro/Studio) that remain subscribed month-over-month. Target: >90% after month 3. Validates FR-61, FR-65.

**Counter-metrics (do not optimize)**

- **SM-C1:** AI suggestion override rate — must not drop below 20%. If teachers never override, they may not be reviewing AI output carefully. Counterbalances SM-5.
- **SM-C2:** Support ticket volume — should not spike as user count grows. A spike indicates UX confusion, not growth. Counterbalances SM-1, SM-3.

---

## 8. Open Questions

1. ~~**Payment provider:**~~ **RESOLVED** — Polar.sh.
2. ~~**Pricing currency:**~~ **RESOLVED** — VND.
3. ~~**AI model provider:**~~ **RESOLVED** — Google Gemini.
4. ~~**At-risk thresholds:**~~ **RESOLVED** — attendance <70%, 2+ consecutive missed assignments, or band drop ≥1.0 over last 4 submissions. Not user-configurable in MVP.
5. ~~**Subject pack architecture:**~~ **RESOLVED** — IELTS only for MVP. No subject pack abstraction needed.
6. **Auth provider for v2:** v1 used Firebase Auth. Is that carried forward, or switching to a different auth system? *Owner: architect. Resolve during architecture phase.*
7. **Hosting and deployment:** Where will v2 be hosted? v1 used Railway. Any constraints? *Owner: architect. Resolve during architecture phase.*
8. **Data retention and deletion:** How long are archived items retained? GDPR-adjacent considerations for Vietnamese data protection law (PDPD)? *Owner: product + legal. Resolve before launch.*

---

## 9. Assumptions Index

- **§4.0a FR-71** — Landing page ships with Vietnamese and English only, matching the app.
- **§4.0b FR-76** — Email verification is required before product access. No grace period for unverified accounts.
- **§4.0b FR-77** — Session duration values (30 days / 24 hours) are defaults; exact values are an architecture decision.
- **§4.0b FR-80** — Force-logout is an Owner-only action. No "log out all devices" self-service in MVP.
- **§4.0b FR-81** — Google OAuth is the only social login provider in MVP. Additional providers (Facebook, Apple) are deferred.
- **§2.3** — Parent communication happens outside ClassLite for now.
- **§3 (At-Risk Student)** — At-risk thresholds are not user-configurable in MVP.
- **§4.1 FR-6 Note** — Spreadsheet import as an alternative to onboarding is a post-MVP feature.
- **§4.2 FR-8** — Google Meet is the only integration in MVP. Google Drive integration is deferred.
- **§4.4 FR-14** — Auto-archive period is 30 days after class end date.
- **§4.5 FR-19** — Attendance is manual (teacher-marked), not automatic.
- **§4.8 FR-28** — Incremental save interval is every 30 seconds or on each answer change.
- **§4.8 FR-31** — Extension requests are handled outside ClassLite in MVP — no in-app extension workflow.
- **§4.13 FR-54** — Knowledge Hub file sharing is implicit via class linkage, no per-file sharing toggle.
- **§4.14 FR-59** — Real-time updates via WebSocket or polling — implementation detail for architecture.
- **§4.14 FR-59** — Email notifications for critical events are a post-MVP feature.
- **§4.16 FR-61** — Exact VND price points TBD. Mockup USD figures serve as tier positioning reference only.
- **§4.16 FR-64** — Add-on credit packs are available on Pro and Studio tiers only.
- **§4.17 FR-67** — Search UI is a command palette / quick-switcher following standard patterns.

---

## 10. Information Architecture

See `docs/classlite-entry/classlite-ia.md` for the complete 93-screen inventory, role model, per-role visibility matrix, and app shell elements. The IA document is authoritative for navigation structure and screen-level routing.

**App shell:** Left sidebar (role-gated navigation), top bar (breadcrumbs + search + primary CTA), user pill (bottom-left, shows avatar + name + role).

**Responsive behavior:** Desktop is the primary design surface. Mobile breakpoints (390×844 reference) follow the designs in screens s74–s87, adapted as responsive layouts rather than a separate mobile app.

---

## 11. Cross-Cutting NFRs

#### NFR-1: Internationalization
The UI must support Vietnamese and English with a runtime language switch. All user-facing strings must be externalized. Date, time, and number formatting must respect locale. Document output language follows user preference.

#### NFR-2: Multi-tenancy
All data is scoped to a center. No cross-center data leakage. Database queries must enforce center isolation at the query level, not just the application level.

#### NFR-3: Performance
- Page load (first contentful paint): <2s on 4G connection.
- Grading view load (essay + AI suggestions): <3s.
- Search results: <500ms.
- Autosave (Writing editor): debounced, no perceptible lag.

#### NFR-4: Security
- Authentication via a proven auth provider (specific provider TBD).
- Role-based access control enforced server-side on every request.
- No raw payment data stored or handled by ClassLite — delegated to Polar.sh.
- File uploads scanned for malware. `[ASSUMPTION: Malware scanning is handled by the storage provider or a third-party service.]`
- Rate limiting on authentication endpoints.

#### NFR-5: Accessibility
- WCAG 2.1 AA compliance for all interactive elements.
- Keyboard navigation for grading workflows (next/prev student, accept/dismiss AI suggestions).
- Screen reader support for form inputs and navigation.

#### NFR-6: Data integrity
- Submissions are immutable once graded and released.
- Enrollment changes are logged with audit trail.
- Cascading deletes are used only for center/user removal; all other deletions are soft (archive).

---

## 12. Monetization

**Model:** Per-teacher/month SaaS subscription with three tiers (Free, Pro, Studio). Annual billing available at a discount. AI credits as a metered add-on.

**Free tier** serves as acquisition funnel: one teacher, one class, five students. Enough to validate the product but not to run a real center.

**Pro tier** is the target for freelance teachers and small centers (≤10 teachers). Removes class/student limits and adds AI grading.

**Studio tier** is for larger centers (10+ teachers) with higher student caps, more AI credits, and priority support.

**Payment provider:** Polar.sh. All pricing displayed in VND.

---

## 13. Platform

**Web application.** Single responsive web app serving all roles. Desktop is the primary design surface; mobile breakpoints follow screens s74–s87.

**No native mobile app** in MVP. The responsive web app is the mobile experience.

**Browser support:** `[ASSUMPTION: Chrome, Firefox, Safari, Edge — latest two versions. No IE11.]`
