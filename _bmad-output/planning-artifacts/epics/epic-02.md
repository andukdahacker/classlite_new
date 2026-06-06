# Epic 2: Onboarding, Center Setup & Roles

## Description

Covers the full onboarding journey from persona selection through center creation, class template spawning, and role-based access control. Includes the wizard UI with branching paths per persona, post-onboarding checklist, center settings with Google Meet integration, and the permissions framework that gates every subsequent feature.

## Functional Requirements

FR-1 through FR-11

## UX Design References

UX-DR21

## Stories

---

### Story 2.1: Onboarding API — Persona, Center Setup & Save/Resume

**Size:** L | **Audience:** Backend | **Dependencies:** Story 1.3, Story 1.4

As a new user completing onboarding,
I want the server to persist my persona choice, center details, and progress at every step,
So that I can close the browser and resume exactly where I left off.

**Acceptance Criteria:**

**Given** the user has authenticated and has no center,
**When** they POST to `/api/onboarding/persona` with a valid persona (`operator`, `founder`, `solo_teacher`),
**Then** the persona is saved to the user record and a 200 response is returned.

**Given** the user has selected a persona,
**When** they POST to `/api/centers` with a center name and optional brand color / logo,
**Then** a new center is created, the user is assigned the Owner role, and a short code is auto-generated.

**Given** the user is mid-onboarding,
**When** any onboarding step is completed,
**Then** the `onboarding_progress` table is updated with the current step, timestamp, and partial payload so the wizard can resume on return.

**Given** the user returns after closing the browser,
**When** they hit the onboarding entry point,
**Then** the API returns their saved progress and the frontend resumes at the correct step.

---

### Story 2.2: Class Template & Spawning API

**Size:** L | **Audience:** Backend | **Dependencies:** Story 2.1

As an onboarding user selecting a template,
I want the server to store pre-built IELTS templates and spawn real classes from them,
So that I can start teaching immediately without manual class configuration.

**Acceptance Criteria:**

**Given** the system is seeded,
**When** GET `/api/templates` is called,
**Then** at least 4 pre-built IELTS templates are returned, each with title, target band, skill focus, and session count.

**Given** a valid template payload,
**When** POST `/api/templates` is called,
**Then** a new template is created in the `class_templates` table with associated `template_sessions` rows.

**Given** a template ID and spawn parameters (N classes, cohort names, teacher assignments),
**When** POST `/api/templates/{id}/spawn` is called,
**Then** N classes are created in the `classes` table, each pre-filled from the template, with teachers assigned (inviting non-existing teachers by email if needed).

**Given** a teacher email that does not exist in the system,
**When** the spawn endpoint assigns that email as a teacher,
**Then** an invite record is created and the teacher can claim the class upon registration.

---

### Story 2.3a: Onboarding UI — Persona Selection & Center Setup

**Size:** M | **Audience:** Frontend | **Dependencies:** Story 2.1

As a new user arriving at ClassLite for the first time,
I want to choose my persona and set up my center identity,
So that the platform tailors the experience to my role and my center has a recognizable brand.

**Acceptance Criteria:**

**Given** the user lands on `/welcome` (screen s00),
**When** the page renders,
**Then** three persona cards are displayed (Operator/Founder, Solo Teacher) in a clean full-width layout with no sidebar, each showing a title and short description.

**Given** the user clicks a persona card,
**When** the card is selected,
**Then** it is visually highlighted, the description expands, and a "Continue" button becomes enabled.

**Given** the user proceeds to `/setup/center` (screen s01),
**When** the center setup form renders,
**Then** it contains: center name (required text field), short code (auto-generated preview that updates as the name changes), brand color picker (6 preset swatches), and an optional logo upload area.

**Given** no logo is uploaded,
**When** the center setup form renders the logo preview,
**Then** a letter-mark default is generated from the center name initials and displayed as a live preview.

**Given** the user completes the center setup form,
**When** they click "Continue",
**Then** the center is created via the API and the wizard advances to the next step.

---

### Story 2.3b: Onboarding UI — Template Selection & Class Spawning

**Size:** M | **Audience:** Frontend | **Dependencies:** Story 2.3a, Story 2.2

As a user continuing onboarding,
I want to pick a class template and spawn my first classes with teachers and students,
So that I have real classes ready before I finish onboarding.

**Acceptance Criteria:**

**Given** the user reaches `/setup/template` (screens s02/s07),
**When** the template selection page renders,
**Then** pre-built IELTS templates are displayed as cards showing title, target band, skill focus, and session count, plus a "Build from scratch" option.

**Given** the user selects a template,
**When** they click on a template card,
**Then** an editable preview of the template details is shown, allowing modifications before spawning.

**Given** the user proceeds to `/setup/spawn` (screens s03/s08) as an Operator or Founder,
**When** the class spawning form renders,
**Then** it allows: specifying N classes, entering a cohort name per class, assigning a teacher per class with inline invite (email entry for non-existing teachers), and optionally adding student emails.

**Given** the user is a Founder,
**When** spawning classes,
**Then** the first class is auto-assigned to the Founder as teacher.

**Given** the user is a Solo Teacher,
**When** they reach `/setup/first-class` (screen s05),
**Then** a single-class creation form is displayed instead of the multi-class spawning view.

---

### Story 2.3c: Onboarding UI — Completion & Resume

**Size:** S | **Audience:** Frontend | **Dependencies:** Story 2.3b

As a user finishing onboarding,
I want to see a summary of everything I set up and be able to jump into the dashboard,
So that I have confidence the setup is complete and can start using ClassLite immediately.

**Acceptance Criteria:**

**Given** the user reaches `/setup/done` (screens s04/s06),
**When** the completion screen renders,
**Then** a summary of all created items (center, classes, teachers invited, students added) is displayed along with an "Open Dashboard" call-to-action button.

**Given** the user is on any onboarding step,
**When** they close the browser or navigate away,
**Then** the current step and all entered data are auto-saved so the wizard resumes at that exact step on return.

**Given** the user is on any onboarding step (except persona selection),
**When** they view the step,
**Then** a "Skip this step" link is available to advance without completing the current form.

**Given** the onboarding wizard renders,
**When** i18n locale is set,
**Then** all labels, placeholders, and messages are translated according to the active locale.

**Given** the onboarding wizard renders,
**When** any screen loads,
**Then** the background uses a dot-grid pattern consistent with the ClassLite design system.

---

### Story 2.4: Post-Onboarding Checklist & First AI Grade Card

**Size:** M | **Audience:** Full-stack | **Dependencies:** Story 2.3c, Story 6.2

As a user who just completed onboarding,
I want to see a checklist of remaining setup tasks and a preview of AI grading,
So that I know what else to configure and get an early taste of ClassLite's core value.

**Acceptance Criteria:**

**Given** the user has completed onboarding and lands on the dashboard,
**When** the dashboard renders,
**Then** a "Finish setting up" card is displayed showing completed vs. total steps as a fraction (e.g., "3/6 complete").

**Given** the user views the checklist card,
**When** they click "Snooze",
**Then** the card is hidden for 7 days and reappears afterward.

**Given** the user views the checklist card,
**When** they click "Dismiss",
**Then** the card is permanently hidden and does not reappear.

**Given** the user is a Teacher or Founder,
**When** the dashboard renders after onboarding,
**Then** a first AI grade card is displayed showing a sample graded essay with band score, criteria breakdown, and feedback — demonstrating ClassLite's AI grading capability.

**Given** the user is an Owner (non-teaching),
**When** the dashboard renders after onboarding,
**Then** a sample dashboard preview is displayed showing placeholder analytics and class overview instead of the AI grade card.

**Given** the Free tier in v1 (lead-gen positioning, per locked product decision),
**When** an owner signs up and completes onboarding,
**Then** there is NO 7-day Pro trial mechanic in v1 — the 5-student/class cap (Story 9.1) acts as the natural upgrade trigger. The Upgrade-to-Pro CTA appears at the cap boundary AND in the Free-tier Settings → Billing → Upgrade panel. Trial mechanic is deferred to post-launch conversion-data review.

---

### Story 2.5: Center Settings & Google Meet Integration

**Size:** L | **Audience:** Full-stack | **Dependencies:** Story 2.1

As a center Owner or Admin,
I want to manage center settings and connect Google Meet for scheduled sessions,
So that the center identity stays current and virtual classes get automatic meeting links.

**Acceptance Criteria:**

**Given** the user is an Owner or Admin,
**When** they navigate to `/settings` (screen s49),
**Then** the center settings page renders with editable fields for: center name, logo, brand color, and timezone.

**Given** the user updates any center setting,
**When** they save changes,
**Then** the updated values are persisted and reflected immediately across the application.

**Given** the settings page renders,
**When** the user views the scheduling section,
**Then** term calendar management and room configuration are available, backed by `terms` and `rooms` tables.

**Given** the user clicks "Connect Google Meet",
**When** the OAuth flow completes,
**Then** the `google_meet_connected` flag is set to true, and the Google Calendar API integration is active for creating meeting links on scheduled sessions.

**Given** the user is a Teacher (not Owner or Admin),
**When** they attempt to access `/settings`,
**Then** a "Permission Denied" message is displayed and no settings are editable.

**Given** center settings are persisted,
**When** the database is inspected,
**Then** the center record includes `timezone`, `google_meet_connected`, and related `rooms` and `terms` table entries.

---

### Story 2.6: Roles, Permissions & Authorization Enforcement

**Size:** L | **Audience:** Full-stack | **Dependencies:** Story 1.3

As a center Owner,
I want a role hierarchy and permissions system that controls what each user can see and do,
So that sensitive operations are restricted and the sidebar adapts to each role.

**Acceptance Criteria:**

**Given** the role system is configured,
**When** roles are inspected,
**Then** four roles exist in a hierarchy: Owner > Admin > Teacher, with Student as an independent role outside the hierarchy.

**Given** a user is assigned a role,
**When** they log in and the sidebar renders,
**Then** the sidebar menu items are scoped to their role — Owners see all items, Admins see management items, Teachers see class-focused items, Students see their own items only.

**Given** an Owner or Admin navigates to `/people/permissions` (screen s44),
**When** the permissions matrix renders,
**Then** it displays all roles and their capabilities in a grid, with two capabilities editable (configurable per center).

**Given** an Admin user,
**When** they attempt to invite a new user with the Owner role,
**Then** the action is blocked — Admins cannot invite or promote users to Owner.

**Given** any user performs an action,
**When** the server checks authorization,
**Then** the role-based permissions are enforced at the API layer, returning 403 for unauthorized operations.

---

### Story 2.7: Bulk Student Import

**Size:** M | **Audience:** Full-stack | **Dependencies:** Story 2.6, Story 3.1

As an Owner or Admin,
I want to import students from a CSV or Excel file,
So that I can onboard existing student rosters from spreadsheets without manual entry.

**Acceptance Criteria:**

**Given** the user is an Owner or Admin on the student management page,
**When** they click "Import Students",
**Then** a file upload dialog accepts `.csv` and `.xlsx` files with expected columns: `email`, `full_name`, `class_name` (optional).

**Given** a file is uploaded,
**When** the system parses it,
**Then** duplicate emails within the file are flagged, invalid email formats are reported, and rows exceeding 200 are rejected with a clear message.

**Given** parsing is complete with no blocking errors,
**When** the preview screen renders,
**Then** the user sees a table of parsed rows with status indicators (new user, existing user, validation error) and can confirm or cancel the import.

**Given** the user confirms the import,
**When** the server processes the file,
**Then** user records are created for new emails, enrollments are created linking students to specified classes, and invite emails are sent to new users.

**Given** the import completes with some row-level errors,
**When** the result screen renders,
**Then** a downloadable error report (CSV) is available listing failed rows with reasons, and successful rows are already persisted.

**Given** the user attempts to import more than 200 rows,
**When** the file is validated,
**Then** the import is rejected with a message indicating the 200-row limit per import.
