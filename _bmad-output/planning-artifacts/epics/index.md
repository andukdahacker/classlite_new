---
stepsCompleted: [1, 2, 3, 4, 5]
inputDocuments:
  - '_bmad-output/planning-artifacts/prds/prd-classlite_new-2026-05-26/prd.md'
  - '_bmad-output/planning-artifacts/architecture.md'
  - '_bmad-output/planning-artifacts/ux-design-specification.md'
  - 'docs/classlite-entry/classlite-ia.md'
  - 'docs/classlite-entry/01-owner-onboarding.html'
  - 'docs/classlite-entry/02a-teacher-dashboard-classes.html'
  - 'docs/classlite-entry/02b-teacher-time.html'
  - 'docs/classlite-entry/02c-teacher-content-grading.html'
  - 'docs/classlite-entry/02d-teacher-resources.html'
  - 'docs/classlite-entry/03-student.html'
  - 'docs/classlite-entry/04-owner-admin.html'
  - 'docs/classlite-entry/05-cross-role.html'
  - 'docs/classlite-entry/06a-inbox.html'
  - 'docs/classlite-entry/06b-empty-states.html'
  - 'docs/classlite-entry/06c-error-states.html'
  - 'docs/classlite-entry/07-billing.html'
  - 'docs/classlite-entry/08-mobile.html'
---

# ClassLite v2 — Epic Breakdown

## Overview

This directory contains the complete epic and story breakdown for ClassLite v2, decomposing the requirements from the PRD, UX Design Specification, and Architecture into implementable stories. Each epic is a separate file for maintainability.

### Document Structure

| File | Epic | Stories |
|------|------|---------|
| [epic-01a-foundation.md](epic-01a-foundation.md) | 1A: Project Foundation | 1.1, 1.2a–f, 1.3, 1.3b |
| [epic-01b-auth.md](epic-01b-auth.md) | 1B: Authentication | 1.4, 1.5, 1.6 |
| [epic-01c-frontend-landing.md](epic-01c-frontend-landing.md) | 1C: Frontend Foundation & Landing | 1.7a–c, 1.8, 1.9a–d, 1.10 |
| [epic-02.md](epic-02.md) | 2: Onboarding, Center Setup & Roles | 2.1–2.7 |
| [epic-03.md](epic-03.md) | 3: Class Management & Scheduling | 3.1–3.5 |
| [epic-04.md](epic-04.md) | 4: Exercise Authoring, AI Content & Knowledge Hub | 4.1–4.5 |
| [epic-05.md](epic-05.md) | 5: Assignments, Student Attempts & Submissions | 5.1–5.5 |
| [epic-06.md](epic-06.md) | 6: Grading & AI-Assisted Grading | 6.1–6.4 |
| [epic-07.md](epic-07.md) | 7: People Management, Enrollment & Q&A | 7.1–7.4 |
| [epic-08.md](epic-08.md) | 8: Analytics, Dashboards & Search | 8.1–8.5 |
| [epic-09.md](epic-09.md) | 9: Billing, Plans & Account Management | 9.1–9.4 |
| [epic-10.md](epic-10.md) | 10: Inbox, Notifications, Archive & Polish | 10.1–10.4 |

### Story Metadata Convention

Each story includes:
- **Size:** S (1-2 days) / M (3-5 days) / L (1-2 weeks)
- **Audience:** Backend / Frontend / Full-stack
- **Dependencies:** Which stories must be complete first
- **UX-DRs:** Which UX design requirements apply (where relevant)

### Changes from Original epics.md

1. **Epic 1 split into 3 sub-epics** (1A Foundation, 1B Auth, 1C Frontend/Landing) to enable parallelism and clearer sprint boundaries
2. **Oversized stories decomposed:** 1.2 → 1.2a-f, 1.7 → 1.7a-c, 1.9 → 1.9a-d, 2.3 → 2.3a-c
3. **Gap stories added:** 1.2d (email abstraction), 1.2e (presigned upload infra), 1.2f (event tracking), 1.3b (audit logging), 2.7 (bulk student import), 4.5 (JSONB schema migration), 8.5 (analytics seed data)
4. **New UX-DRs added:** UX-DR22-25 for Epics 5-8 (feedback design language, teacher bulk-review, skeleton states, progress sharing)
5. **Failure-path ACs added** to security-surface stories (auth, AI pipeline, file uploads, billing webhooks)
6. **Story metadata added** (size, audience, dependencies) to every story

---

## Screen Reference Legend

Screen codes (sNN) reference the UX Design Specification wireframes:

| Code | Screen |
|------|--------|
| s00 | Persona selection |
| s01 | Center setup |
| s02/s07 | Template selection |
| s03/s08 | Class spawning |
| s04/s06 | Onboarding completion |
| s05 | Solo Teacher first class |
| s06 | Teacher dashboard |
| s07 | Classes index |
| s08 | Class detail |
| s09 | Class detail tabs (Students/Assignments/Sessions/Materials/Analytics) |
| s10 | Student detail |
| s10a | Teacher's student roster |
| s12 | Session detail |
| s13 | Schedule workspace |
| s14 | Session creation modal |
| s15 | Exercise library |
| s16 | Exercise editor |
| s17 | AI generation dialog |
| s18 | Teacher Q&A view |
| s19 | Templates index |
| s20 | Template detail |
| s21 | Template edit |
| s22 | Class creation |
| s23 | Writing grading view |
| s24 | Speaking grading view |
| s25 | Auto-grade review view |
| s26 | Knowledge Hub |
| s27 | File detail |
| s28 | Archive |
| s29 | Student dashboard |
| s32 | Student schedule (read-only) |
| s33 | Quiz attempt interface |
| s34 | Writing attempt interface |
| s35 | Submission result |
| s36 | Student Q&A sidebar |
| s37 | My Performance |
| s38 | User profile |
| s39 | Staff list |
| s40 | Staff detail |
| s41 | Invite staff modal |
| s42 | Center-wide student list |
| s43 | Enrollment management |
| s44 | Permissions matrix |
| s45 | Analytics home |
| s46 | Class performance |
| s47 | Student performance (teacher view) |
| s48 | Admin/Owner dashboard |
| s49 | Center settings |
| s50 | Teacher inbox |
| s51 | Student inbox |
| s52 | Admin/Owner inbox |
| s53–s62 | Empty states (per section) |
| s63–s67 | Error states (per type) |
| s68 | Plan picker |
| s69 | Billing dashboard |
| s70 | Invoice history |
| s71 | Upgrade modal |
| s73 | Grace period strip |
| s74 | Student dashboard mobile |
| s75 | Student inbox mobile |
| s78 | Writing attempt mobile |
| s79 | Submission result mobile |
| s81 | Student performance mobile |
| s82 | Teacher dashboard mobile |
| s84 | Teacher inbox mobile |

---

## Requirements Inventory

### Functional Requirements (FR-1 through FR-81)

FR-1: User selects one of three personas (Operator, Founder, Solo Teacher) on first login
FR-2: Operator and Founder users configure their center: name, short code, brand color, logo
FR-3: User can select from pre-built IELTS class templates or build from scratch
FR-4: User duplicates template into N live classes with cohort name, teacher assignment
FR-5: Post-onboarding "Finish setting up" card with remaining tasks tracked as fraction
FR-6: All onboarding steps auto-save; user can exit and resume
FR-7: Owner can edit center profile, manage term calendar, configure rooms, connect integrations
FR-8: Owner can connect Google Meet for auto-generated session meeting links
FR-9: Fixed permission set per role: Teacher < Admin < Owner; Student as independent consumer
FR-10: Owner can toggle two capabilities per role: "Can see teacher performance analytics" and "Can publish to Knowledge hub"
FR-11: Only an Owner can assign the Owner role to another user
FR-12: Create a class from template or scratch with name, description, teacher, target band, schedule, capacity
FR-13: Class detail view with tabs: Overview, Students, Assignments, Sessions, Materials, Analytics
FR-14: Class statuses: Upcoming → Active → Paused → Ended with archive after configurable period
FR-15: Templates as first-class entities with ordered session plans
FR-16: Calendar workspace (day/week/month views) with mini-month navigator
FR-17: Sessions with recurrence pattern and "Apply to..." scope branch
FR-18: Session shows info, attendance, materials, exercises, teacher notes, actions
FR-19: Teacher manually marks attendance (Present, Late, Absent)
FR-20: Exercise table with filtering by skill, tag, class, assignment status
FR-21: Exercise editor with two panels: metadata sidebar + sections with question groups
FR-22: Exercise settings: time limit toggle and answer matching mode
FR-23: Locked finalized exercises once assigned and submitted
FR-24: AI generates full section (passage + questions) with preview
FR-25: AI generates questions for existing section with preview
FR-26: AI generates distractor options with preview
FR-27: Assignment creation: exercise + class + deadline + optional instructions
FR-28: Quiz attempt: split-pane with flagging, nav, timer, incremental save
FR-29: Writing attempt: rich text editor with autosave, word count, time-on-task
FR-30: Speaking attempt: audio recorder with prep countdown, recording window, re-record
FR-31: Late submissions accepted but flagged with configurable penalties; hard deadline locks
FR-32: Submission result: overall band, per-criterion breakdown, feedback, inline comments
FR-33: Writing grading with highlight-and-pin anchored comments (Error/Praise/Suggestion)
FR-34: AI-assisted Writing grading: band proposals with rationale, inline comments with confidence
FR-35: Speaking grading: audio player with waveform, playback speed, timestamp-pinned comments
FR-36: AI-assisted Speaking grading: auto-transcription, band proposals, flagged moments
FR-37: Auto-grading Reading/Listening/Vocabulary against answer key with teacher override
FR-38: Student highlights exercise content to anchor a question; Q&A during active attempts
FR-39: Teacher sees all open questions, can answer in-thread, batch-select, resolve
FR-40: Unanswered questions appear as action items in teacher's Inbox
FR-41: Staff list with name, role, classes, load, status; detail shows profile, schedule, load bar
FR-42: Staff invitation via modal with email, name, role, optional class; expires 7 days
FR-43: Center-wide student list with filtering; tabs: All/At-risk/New/Unassigned/Archived
FR-44: Teacher sees aggregated student roster across own classes; tabs: All/At-risk/New/By class
FR-45: Student detail: overall band, per-skill breakdown, attendance, submissions, trends, notes
FR-46: Enrollment management: Add, Transfer, Withdraw with effective date, note, audit history
FR-47: Analytics home: role-scoped entry point branching to class and student performance
FR-48: Class performance: avg band over time, skill×week heatmap, mistakes, at-risk, on-time rate
FR-49: Student performance (teacher/admin/owner): Overview, Mistakes, Recommendations tabs
FR-50: Student performance (student "My Performance"): Overview and Patterns with softened framing
FR-51: Admin/Owner dashboard: center pulse with active classes, students, staff, "Needs attention"
FR-52: Teacher dashboard: week-strip sessions, grading queue, unanswered questions, at-risk students
FR-53: Student dashboard: upcoming sessions, work due soon, recent feedback, open Q&A
FR-54: Knowledge Hub: upload, organize (folders), manage files linkable to sessions and exercises
FR-55: File detail: preview, metadata, linked locations, actions, view rate tracking
FR-56: Teacher Inbox: unanswered questions, ungraded/late submissions, mentions
FR-57: Student Inbox: teacher replies, posted grades, comments, new assignments, schedule changes
FR-58: Admin/Owner Inbox: enrollment, new staff, integration health, billing events
FR-59: In-app notifications with unread badge, near-real-time updates
FR-60: Archive: past classes/sessions/exercises as read-only with Duplicate and Edit-a-copy
FR-61: Three plan tiers (Free/Pro/Studio) with limits
FR-62: Plan limit enforcement: soft warning banners, hard block when exceeding
FR-63: Upgrade prorated, downgrade at next renewal
FR-64: AI credit add-on packs (Pro/Studio only)
FR-65: Payment failure: 7-day grace, auto-retry days 3/5, auto-downgrade day 7
FR-66: Invoice history with filter, PDF download, retry, CSV export, email-to-accountant
FR-67: Global search (Cmd+K) across classes, students, exercises, assignments, Knowledge Hub
FR-68: User profile: name, avatar, email, password, language, notification settings
FR-69: Purpose-designed empty states per section with guided actions
FR-70: Error states with three-part recovery pattern
FR-71: Public landing page with hero, features, social proof, pricing, footer; bilingual, SEO
FR-72: Pricing section with three tiers in VND, annual/monthly toggle
FR-73: Authenticated redirect: logged-in users redirected to dashboard
FR-74: Landing page fully responsive at mobile breakpoints
FR-75: Email/password registration with validation and rate limiting
FR-76: Email verification with 24h link, resend rate-limited
FR-77: Login/logout with "Remember me", lockout after 5 failed attempts
FR-78: Password reset via email with 1-hour token, invalidates sessions
FR-79: Invite acceptance with center info, role, handles existing accounts, expired invites
FR-80: Session management with token validation, multi-device, Owner force-logout
FR-81: Google OAuth signup/login with account linking, skips email verification

### Non-Functional Requirements

NFR-1: Internationalization — Vietnamese + English with runtime switch, externalized strings
NFR-2: Multi-tenancy — all data scoped to center, query-level isolation, RLS
NFR-3: Performance — FCP <2s on 4G, grading view <3s, search <500ms
NFR-4: Security — proven auth, server-side RBAC, no raw payment data, file scanning, rate limiting
NFR-5: Accessibility — WCAG 2.1 AA, keyboard navigation for grading, screen reader support
NFR-6: Data integrity — immutable graded submissions, enrollment audit trails, soft deletes

### UX Design Requirements

**Original (UX-DR1 through UX-DR21):**

UX-DR1: Shared design token file (tokens.css) — single source of truth for both Astro and React
UX-DR2: Accessibility token fixes — darken --cl-muted, create text-safe and button-safe amber variants
UX-DR3: Landing page design — Fraunces hero, calculator, feature cards, social proof, pricing
UX-DR4: StickyHeader — transparent → solid on scroll past 400px
UX-DR5: AuthCard layout — centered 420px card, wordmark, dot grid background
UX-DR6: GoogleOAuthButton — ToS-compliant branded styling with states
UX-DR7: CollapsibleEmailForm — Google-first pattern, collapsed by default
UX-DR8: PasswordInput + PasswordStrengthBar — 4-segment, aria-live announcements
UX-DR9: VerificationPending + useVerificationPoller — 5s poll, 10-min timeout
UX-DR10: InviteCard + useInviteToken — 6 states (valid new, valid logged in, valid not logged in, expired, accepted, not found)
UX-DR11: PainCalculator — static stat display with Geist Mono
UX-DR12: PricingCard — tier cards with popular variant (amber border + badge)
UX-DR13: SocialProofCard — Vietnamese-register social proof
UX-DR14: FeatureCard — tinted cards (blue/gold/green)
UX-DR15: Mobile auth layout — one action per screen, 48px touch targets
UX-DR16: Failure state design — three-part recovery for 10 cataloged states
UX-DR17: Language continuity across domains — shared cookie
UX-DR18: Logged-in redirect — hint cookie with stale loop prevention
UX-DR19: Multi-tab refresh coordination — navigator.locks + BroadcastChannel
UX-DR20: OAuth email mismatch recovery screen
UX-DR21: First AI grade experience — pre-loaded sample, animated progress, subtle results

**New (UX-DR22 through UX-DR25) — addressing gap in Epics 5-8:**

UX-DR22: Feedback Design Language — defines how scores, progress, regression, and AI confidence appear across the product. Band scores use consistent typography (Geist Mono 28px for primary, 14px for per-criterion). Regression is communicated with neutral framing ("Your score changed from 6.5 to 6.0") not negative framing ("You scored worse"). AI confidence shown to teachers (High/Medium badges) but hidden from students. Progress charts use --cl-accent for improvement, --cl-ink-soft for stable, no red for decline (use --cl-muted instead). Applies to: Epic 5 (result view), Epic 6 (grading UI, AI suggestions), Epic 8 (analytics, dashboards, My Performance).

UX-DR23: Teacher Bulk-Review Interface — defines the grading queue UX for teachers processing multiple submissions. Queue shows: student name, assignment title, class, submission time, overdue flag. Prev/Next navigation without returning to list. Progress indicator ("3 of 12 graded"). Quick-action bar: Accept AI grade, Skip, Flag for later. Keyboard shortcuts: arrow keys for nav, Enter to open, Escape to return to queue. Applies to: Epic 6 (grading views).

UX-DR24: Skeleton & Loading States — defines loading patterns for all primary views. Every view that fetches data shows a skeleton matching the final layout (not a spinner). Skeleton uses --cl-line-soft with subtle pulse animation. Content appears with a 150ms fade-in (respects prefers-reduced-motion). Error during load shows inline retry, not a full-page error. Applies to: All epics with data-fetching views (Epics 3-10).

UX-DR25: Progress Sharing — defines how performance data can be shared outside the app (acknowledging the parent/guardian audience in Vietnamese IELTS centers). "Share summary" button on student detail and My Performance generates a shareable text block (clipboard-ready) with: student name, date range, overall band, per-skill breakdown, attendance rate. Format is plain text suitable for Zalo/WhatsApp. PDF export of student performance report (one page, branded with center logo). No direct parent account access in v1 — sharing is copy/paste and PDF. Applies to: Epic 7 (student detail), Epic 8 (My Performance).

### UX-DR Traceability Matrix

| UX-DR | Epic | Stories |
|-------|------|---------|
| UX-DR1 | 1C | 1.7a |
| UX-DR2 | 1C | 1.7a |
| UX-DR3 | 1C | 1.10 |
| UX-DR4 | 1C | 1.10 |
| UX-DR5 | 1C | 1.8 |
| UX-DR6 | 1C | 1.8 |
| UX-DR7 | 1C | 1.8 |
| UX-DR8 | 1C | 1.8 |
| UX-DR9 | 1C | 1.9a |
| UX-DR10 | 1C | 1.9c |
| UX-DR11 | 1C | 1.10 |
| UX-DR12 | 1C | 1.10 |
| UX-DR13 | 1C | 1.10 |
| UX-DR14 | 1C | 1.10 |
| UX-DR15 | 1C | 1.8, 1.10 |
| UX-DR16 | 1C | 1.9d |
| UX-DR17 | 1C | 1.7c, 1.10 |
| UX-DR18 | 1C | 1.9d, 1.10 |
| UX-DR19 | 1C | 1.7b |
| UX-DR20 | 1C | 1.9d |
| UX-DR21 | 2, 6 | 2.4, 6.2 |
| UX-DR22 | 5, 6, 8 | 5.5, 6.1, 6.2, 8.1, 8.3 |
| UX-DR23 | 6 | 6.1, 6.2, 6.3, 6.4 |
| UX-DR24 | 3–10 | All data-fetching views |
| UX-DR25 | 7, 8 | 7.2, 8.3 |

---

## FR Coverage Map

| FR | Epic | Story |
|----|------|-------|
| FR-1 | 2 | 2.1 (persona selection) |
| FR-2 | 2 | 2.1 (center setup) |
| FR-3 | 2 | 2.2 (template selection) |
| FR-4 | 2 | 2.2 (class spawning) |
| FR-5 | 2 | 2.4 (post-onboarding checklist) |
| FR-6 | 2 | 2.1 (save and resume) |
| FR-7 | 2 | 2.5 (center settings) |
| FR-8 | 2 | 2.5 (Google Meet) |
| FR-9 | 2 | 2.6 (role hierarchy) |
| FR-10 | 2 | 2.6 (editable permissions) |
| FR-11 | 2 | 2.6 (Owner-only role assignment) |
| FR-12 | 3 | 3.1 (class creation) |
| FR-13 | 3 | 3.2 (class detail tabs) |
| FR-14 | 3 | 3.1 (class lifecycle) |
| FR-15 | 3 | 3.3 (templates) |
| FR-16 | 3 | 3.4 (schedule workspace) |
| FR-17 | 3 | 3.4 (session recurrence) |
| FR-18 | 3 | 3.5 (session detail) |
| FR-19 | 3 | 3.5 (attendance) |
| FR-20 | 4 | 4.1 (exercise library) |
| FR-21 | 4 | 4.2 (exercise editor) |
| FR-22 | 4 | 4.2 (exercise settings) |
| FR-23 | 4 | 4.2 (locked finalized) |
| FR-24 | 4 | 4.3 (AI section generation) |
| FR-25 | 4 | 4.3 (AI question generation) |
| FR-26 | 4 | 4.3 (AI distractor generation) |
| FR-27 | 5 | 5.1 (assignment creation) |
| FR-28 | 5 | 5.2 (quiz attempt) |
| FR-29 | 5 | 5.3 (writing attempt) |
| FR-30 | 5 | 5.4 (speaking attempt) |
| FR-31 | 5 | 5.1 (late submission handling) |
| FR-32 | 5 | 5.5 (submission result) |
| FR-33 | 6 | 6.1 (writing grading) |
| FR-34 | 6 | 6.2 (AI writing grading) |
| FR-35 | 6 | 6.3 (speaking grading) |
| FR-36 | 6 | 6.3 (AI speaking grading) |
| FR-37 | 6 | 6.4 (auto-grading) |
| FR-38 | 7 | 7.4 (student asks question) |
| FR-39 | 7 | 7.4 (teacher answers) |
| FR-40 | 7 | 7.4 (Q&A feeds into Inbox) |
| FR-41 | 7 | 7.1 (staff list and detail) |
| FR-42 | 7 | 7.1 (staff invitation) |
| FR-43 | 7 | 7.2 (center-wide student list) |
| FR-44 | 7 | 7.2 (teacher's student roster) |
| FR-45 | 7 | 7.2 (student detail) |
| FR-46 | 7 | 7.3 (enrollment management) |
| FR-47 | 8 | 8.2 (analytics home) |
| FR-48 | 8 | 8.2 (class performance) |
| FR-49 | 8 | 8.3 (student performance — teacher view) |
| FR-50 | 8 | 8.3 (student performance — student view) |
| FR-51 | 8 | 8.1 (admin/owner dashboard) |
| FR-52 | 8 | 8.1 (teacher dashboard) |
| FR-53 | 8 | 8.1 (student dashboard) |
| FR-54 | 4 | 4.4 (Knowledge Hub) |
| FR-55 | 4 | 4.4 (file detail) |
| FR-56 | 10 | 10.1 (teacher inbox) |
| FR-57 | 10 | 10.1 (student inbox) |
| FR-58 | 10 | 10.1 (admin/owner inbox) |
| FR-59 | 10 | 10.1 (notification delivery) |
| FR-60 | 10 | 10.2 (archive) |
| FR-61 | 9 | 9.1 (plan tiers) |
| FR-62 | 9 | 9.1 (plan limit enforcement) |
| FR-63 | 9 | 9.2 (upgrade/downgrade) |
| FR-64 | 9 | 9.2 (AI credit add-on) |
| FR-65 | 9 | 9.3 (payment failure/grace period) |
| FR-66 | 9 | 9.3 (invoice management) |
| FR-67 | 8 | 8.4 (global search) |
| FR-68 | 9 | 9.4 (user profile) |
| FR-69 | 10 | 10.3 (empty states) |
| FR-70 | 10 | 10.4 (error states) |
| FR-71 | 1C | 1.10 (landing page) |
| FR-72 | 1C | 1.10 (pricing section) |
| FR-73 | 1C | 1.10 (authenticated redirect) |
| FR-74 | 1C | 1.10 (responsive landing) |
| FR-75 | 1B | 1.4 (registration) |
| FR-76 | 1B | 1.4 (email verification) |
| FR-77 | 1B | 1.5 (login/logout) |
| FR-78 | 1B | 1.5 (password reset) |
| FR-79 | 1B | 1.6 (invite acceptance) |
| FR-80 | 1B | 1.5 (session management) |
| FR-81 | 1B | 1.6 (Google OAuth) |

---

## Epic Summaries

### Epic 1A: Project Foundation
Monorepo scaffold, Go API skeleton with middleware chain, PostgreSQL with RLS and adversarial test suite, shared infrastructure (email abstraction, presigned uploads, event tracking, audit logging).
**Stories:** 1.1, 1.2a–f, 1.3, 1.3b (10 stories)
**NFRs:** NFR-2, NFR-3, NFR-4

### Epic 1B: Authentication
Email/password registration, email verification, login with session management, password reset, Google OAuth with account linking, invite acceptance with 6 states, force-logout.
**Stories:** 1.4, 1.5, 1.6 (3 stories)
**FRs:** FR-75 through FR-81
**NFRs:** NFR-4

### Epic 1C: Frontend Foundation & Landing Page
Design system with tokens.css, React dashboard scaffold (routing, state, i18n, Sentry), auth UI screens, verification/reset/invite flows, error recovery states, Astro landing page with pricing.
**Stories:** 1.7a–c, 1.8, 1.9a–d, 1.10 (10 stories)
**FRs:** FR-71 through FR-74
**UX-DRs:** UX-DR1 through UX-DR20
**NFRs:** NFR-1, NFR-3, NFR-5

### Epic 2: Onboarding, Center Setup & Roles
Persona selection, center setup with branding, template selection and class spawning, post-onboarding checklist, center settings with Google Meet, role hierarchy and permissions, bulk student import.
**Stories:** 2.1–2.7 (9 stories, including 2.3a–c decomposition)
**FRs:** FR-1 through FR-11
**UX-DRs:** UX-DR21

### Epic 3: Class Management & Scheduling
Class CRUD and lifecycle, class detail with tabs, templates management, calendar workspace with recurring sessions, session detail and attendance recording.
**Stories:** 3.1–3.5 (5 stories)
**FRs:** FR-12 through FR-19

### Epic 4: Exercise Authoring, AI Content Generation & Knowledge Hub
Exercise library and editor for all 4 IELTS skills, AI content generation pipeline (Gemini + PostgreSQL job queue), Knowledge Hub file management with presigned uploads, JSONB schema migration strategy.
**Stories:** 4.1–4.5 (5 stories)
**FRs:** FR-20 through FR-26, FR-54, FR-55

### Epic 5: Assignments, Student Attempts & Submissions
Assignment creation and lifecycle, quiz attempt (Reading/Listening), writing attempt (rich text editor), speaking attempt (audio recorder), submission result view.
**Stories:** 5.1–5.5 (5 stories)
**FRs:** FR-27 through FR-32
**UX-DRs:** UX-DR22

### Epic 6: Grading & AI-Assisted Grading
Writing grading with anchored comments, AI-assisted writing grading (12→3 min), speaking grading with timestamp-pinned feedback, AI speaking grading, auto-grading for Reading/Listening.
**Stories:** 6.1–6.4 (4 stories)
**FRs:** FR-33 through FR-37
**UX-DRs:** UX-DR22, UX-DR23

### Epic 7: People Management, Enrollment & Anchored Q&A
Staff management and invitation, student lists with at-risk detection, enrollment management with audit trail, anchored Q&A system.
**Stories:** 7.1–7.4 (4 stories)
**FRs:** FR-38 through FR-46
**UX-DRs:** UX-DR25

### Epic 8: Analytics, Dashboards & Search
Role-specific dashboards, class performance analytics with heatmaps, student performance with AI recommendations, global search (Cmd+K), analytics seed data script.
**Stories:** 8.1–8.5 (5 stories)
**FRs:** FR-47 through FR-53, FR-67
**UX-DRs:** UX-DR22, UX-DR25

### Epic 9: Billing, Plans & Account Management
Three plan tiers with enforcement, upgrade/downgrade with proration, AI credit add-ons, payment failure with 7-day grace period, invoices, user profile management.
**Stories:** 9.1–9.4 (4 stories)
**FRs:** FR-61 through FR-66, FR-68

### Epic 10: Inbox, Notifications, Archive & Polish
Role-scoped inbox with polling notifications, archive with duplicate/edit-a-copy, purpose-designed empty states, error states with three-part recovery pattern.
**Stories:** 10.1–10.4 (4 stories)
**FRs:** FR-56 through FR-60, FR-69, FR-70

---

## Dependency Graph (High-Level)

```
Epic 1A (Foundation)
├── Epic 1B (Auth) ──→ Epic 2 (Onboarding & Roles)
│                        ├── Epic 3 (Classes & Scheduling)
│                        │    ├── Epic 4 (Exercises & AI Content)
│                        │    │    ├── Epic 5 (Assignments & Attempts)
│                        │    │    │    ├── Epic 6 (Grading & AI Grading)
│                        │    │    │    │    ├── Epic 8 (Analytics & Dashboards)
│                        │    │    │    │    └── Epic 7 (People & Q&A)
│                        │    │    │    └── Epic 7 (People & Q&A)
│                        │    │    └── Epic 7 (People & Q&A)
│                        │    └── Epic 7 (People & Q&A)
│                        └── Epic 9 (Billing)
├── Epic 1C (Frontend) ──→ (parallel with 1B, feeds into all frontend stories)
└── Epic 10 (Inbox/Notifications/Polish) ← depends on events from Epics 3-9
```

---

**Total: 12 epic files, 68 stories (up from 46 in original), 81 FRs fully covered, 25 UX-DRs.**
