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

This document provides the complete epic and story breakdown for ClassLite v2, decomposing the requirements from the PRD, UX Design Specification, and Architecture into implementable stories.

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

---
---

# Epic 1A: Project Foundation

## Description

Infrastructure sub-epic split from the original Epic 1. Establishes the monorepo structure, Go API skeleton with middleware, database connectivity, auth schema with row-level security, and cross-cutting infrastructure services (email, storage, events, audit logging) that all subsequent epics depend on.

## Functional Requirements

No FRs are directly owned by this epic. Epic 1A is pure infrastructure that enables every FR across Epics 2-10.

## Non-Functional Requirements Addressed

- **NFR-2 (Multi-Tenancy Foundation):** RLS policies, `SET LOCAL app.current_tenant_id` per-request, tenant-scoped queries returning zero rows on null tenant.
- **NFR-3 (Performance Baseline):** pgx connection pooling, middleware ordering (rate limiter early), health endpoint with DB connectivity check.
- **NFR-4 (Security Core):** CORS middleware, rate limiting, custom error types that never leak internals, RLS adversarial test suite, audit logging.

## Stories

---

### Story 1.1: Monorepo Scaffold

**Size:** L | **Audience:** Full-stack | **Dependencies:** None

As a developer,
I want a monorepo with three service directories, Docker Compose for local development, CI/CD pipelines, and shared scripts,
So that the team has a consistent, reproducible development environment from day one.

**Acceptance Criteria:**

**Given** the repository is cloned and Docker is running,
**When** I run `docker-compose up`,
**Then** the Go API, Next.js web app, and database containers all start and are reachable on their configured ports.

**Given** the CI/CD pipeline is triggered,
**When** code is pushed to the main branch,
**Then** linting, tests, and build steps pass for all three services.

**Given** the monorepo scripts directory exists,
**When** I run the setup script,
**Then** all dependencies are installed and the local `.env` files are created from templates.

---

### Story 1.2a: Go API Skeleton & Middleware Chain

**Size:** M | **Audience:** Backend | **Dependencies:** Story 1.1

As a backend developer,
I want a Go API entry point with request_id, logger, CORS, and rate_limit middleware wired in the correct order,
So that every request is traceable, logged, access-controlled, and rate-limited before reaching any handler.

**Acceptance Criteria:**

**Given** any incoming HTTP request,
**When** it passes through the middleware chain,
**Then** a unique `X-Request-ID` header is set (or preserved if already present), the request is logged via slog with the request ID, CORS headers are applied per configuration, and rate limiting is enforced.

**Given** the middleware chain is configured,
**When** I inspect the wiring order,
**Then** the order is: request_id -> logger -> cors -> rate_limit -> router.

**Given** the rate limiter threshold is exceeded,
**When** another request arrives from the same source,
**Then** a `429 Too Many Requests` response is returned before the request reaches the router.

---

### Story 1.2b: Database Connection, Health Endpoint & Tenant Context

**Size:** S | **Audience:** Backend | **Dependencies:** Story 1.1

As a backend developer,
I want a pgx connection pool, a health endpoint that reports DB connectivity, and a per-request tenant context function,
So that the API can connect to PostgreSQL reliably, operators can monitor health, and every query runs in the correct tenant scope.

**Acceptance Criteria:**

**Given** the API starts with a valid `DATABASE_URL`,
**When** the pgx pool initializes,
**Then** the pool connects successfully and is reusable across requests.

**Given** the health endpoint is called,
**When** the database is reachable,
**Then** `GET /api/health` returns `200` with `{ "status": "ok", "db": "connected" }`.

**Given** the health endpoint is called,
**When** the database is unreachable,
**Then** `GET /api/health` returns `503` with `{ "status": "degraded", "db": "disconnected" }`.

**Given** a request includes a valid tenant context,
**When** a database query is executed,
**Then** `SET LOCAL app.current_tenant_id = '<center_id>'` is issued on the connection before any query runs.

---

### Story 1.2c: Error Handling & Config System

**Size:** S | **Audience:** Backend | **Dependencies:** Story 1.2a

As a backend developer,
I want custom error types (NotFoundError, ForbiddenError, ValidationError, ConflictError) mapped to standard HTTP responses, and a config loader for all environment variables,
So that error responses are consistent, never leak internals, and configuration is centralized.

**Acceptance Criteria:**

**Given** a handler returns a `NotFoundError`,
**When** the error mapping middleware processes it,
**Then** the response is `404` with body `{ "error": { "code": "NOT_FOUND", "message": "...", "requestId": "...", "details": null } }`.

**Given** a handler returns a `ForbiddenError`,
**When** the error mapping middleware processes it,
**Then** the response is `403` with the standard error envelope.

**Given** a handler returns a `ValidationError` with field-level details,
**When** the error mapping middleware processes it,
**Then** the response is `422` with `details` containing the field errors.

**Given** a handler returns a `ConflictError`,
**When** the error mapping middleware processes it,
**Then** the response is `409` with the standard error envelope.

**Given** an unhandled panic or unknown error occurs,
**When** the error mapping middleware catches it,
**Then** the response is `500` with a generic message and no internal details are leaked.

**Given** environment variables are set,
**When** the config loader initializes,
**Then** all required env vars are loaded, validated, and accessible via a typed config struct.

---

### Story 1.2d: Email Service Abstraction

**Size:** S | **Audience:** Backend | **Dependencies:** Story 1.1

As a developer,
I want an email service interface (`EmailSender.Send(ctx, to, template, data)`) with a Resend implementation,
So that email sending is decoupled from the provider and testable.

**Acceptance Criteria:**

**Given** the `EmailSender` interface is defined in `internal/service/email.go`,
**When** a caller invokes `Send(ctx, to, template, data)`,
**Then** the call is dispatched to the configured implementation (Resend or mock).

**Given** the Resend implementation in `internal/service/email_resend.go` is configured with a valid API key,
**When** `Send` is called,
**Then** the email is delivered via the Resend API with the correct template and data.

**Given** the mock implementation is used in tests,
**When** `Send` is called,
**Then** the call is recorded and no external API call is made.

---

### Story 1.2e: Presigned Upload Infrastructure

**Size:** S | **Audience:** Backend | **Dependencies:** Story 1.1

As a developer,
I want a reusable presigned URL upload pattern for Cloudflare R2,
So that Knowledge Hub (Epic 4) and Speaking recordings (Epic 5) don't duplicate upload logic.

**Acceptance Criteria:**

**Given** a valid authenticated request,
**When** `POST /api/uploads/presign` is called with `{ "filename": "notes.pdf", "contentType": "application/pdf", "feature": "knowledge" }`,
**Then** the response contains a presigned PUT URL with key format `{center_id}/{feature}/{uuid}.{ext}` and an expiry of 15 minutes.

**Given** a file has been uploaded to R2 using the presigned URL,
**When** `POST /api/uploads/confirm` is called with the object key,
**Then** the endpoint verifies the object exists in R2 and returns `{ "key": "...", "size": 12345, "contentType": "application/pdf" }`.

**Given** the storage interface is defined in `internal/service/storage.go`,
**When** tests need to verify upload logic,
**Then** a mock implementation can be substituted without hitting R2.

---

### Story 1.2f: Event Tracking Foundation

**Size:** S | **Audience:** Backend | **Dependencies:** Story 1.1

As a developer,
I want a lightweight in-process event bus for domain events (grade released, assignment created, enrollment changed, etc.),
So that analytics (Epic 8) and notifications (Epic 10) can consume structured events without coupling to the producing code.

**Acceptance Criteria:**

**Given** the event bus is defined in `internal/event/bus.go`,
**When** `Publish(ctx, event)` is called with a domain event,
**Then** all registered handlers for that event type are invoked synchronously.

**Given** a handler is registered via `Subscribe(eventType, handler)`,
**When** an event of that type is published,
**Then** the handler receives the event with fields `Type`, `CenterID`, `UserID`, `Payload`, and `Timestamp`.

**Given** any event is published,
**When** the event bus processes it,
**Then** the event is logged via slog with all fields for future replay capability.

**Given** no external message queue is configured (MVP),
**When** events are published,
**Then** they are processed in-process without requiring any external infrastructure.

---

### Story 1.3: Auth Database Schema & Row-Level Security

**Size:** L | **Audience:** Backend | **Dependencies:** Story 1.2b

As a backend developer,
I want the auth database schema (users, centers, center_members, email_verifications, refresh_tokens, password_resets, invites) with RLS policies and sqlc setup,
So that all auth data is tenant-isolated at the database level and queries are type-safe.

**Acceptance Criteria:**

**Given** the migration is applied,
**When** I inspect the database,
**Then** all 7 tables exist with correct columns, indexes, and foreign keys.

**Given** RLS is enabled on all tenant-scoped tables,
**When** `app.current_tenant_id` is null or not set,
**Then** all SELECT, UPDATE, and DELETE queries return zero rows (not an error).

**Given** RLS is enabled,
**When** `app.current_tenant_id` is set to a valid center ID,
**Then** only rows belonging to that center are visible.

**Given** the adversarial test suite runs,
**When** a query attempts cross-tenant access, null tenant access, or SQL injection via the tenant ID,
**Then** all attempts are blocked and zero rows are returned.

**Given** sqlc is configured,
**When** I run `sqlc generate`,
**Then** type-safe Go query functions are generated for all auth-related queries.

---

### Story 1.3b: Audit Logging Infrastructure

**Size:** M | **Audience:** Backend | **Dependencies:** Story 1.2b

As a developer,
I want an audit log table and service that records who changed what and when,
So that multi-tenant billing and enrollment changes are traceable.

**Acceptance Criteria:**

**Given** the migration is applied,
**When** I inspect the database,
**Then** the `audit_logs` table exists with columns: `id`, `center_id`, `user_id`, `action` (string), `entity_type`, `entity_id`, `changes` (JSONB with before/after), `ip_address`, `created_at`.

**Given** RLS is enabled on `audit_logs`,
**When** `app.current_tenant_id` is null or set to a different center,
**Then** audit records from other tenants are not visible.

**Given** the audit service in `internal/service/audit.go` is initialized,
**When** `Log(ctx, action, entity, changes)` is called,
**Then** a row is inserted into `audit_logs` with the current user ID, center ID, IP address, and timestamp derived from the request context.

**Given** the `audit_logs` table has data,
**When** querying by center, entity type, and date range,
**Then** the query uses the index on `(center_id, entity_type, created_at)` efficiently.

---
---

# Epic 1B: Authentication

**Description:** Users can register, log in, manage sessions, reset passwords, sign in with Google, and accept staff invitations. Complete auth API with security-hardened flows.

**FRs Covered:** FR-75, FR-76, FR-77, FR-78, FR-79, FR-80, FR-81

**NFRs Addressed:** NFR-4 (security core)

**Stories:** 1.4, 1.5, 1.6

---

## Story 1.4: Email/Password Registration & Email Verification API

**Size:** L | **Audience:** Backend | **Dependencies:** Story 1.3 (auth schema)

As a new user,
I want to register with my email and password and verify my email address,
So that I have a secure, verified account on the platform.

### Acceptance Criteria

**Given** a user submits a valid registration form with email and password,
**When** the registration request is processed,
**Then** a new user record is created with the password hashed using bcrypt, an email verification token is generated with a 24-hour expiry, and a verification email is sent via the email service abstraction (Resend).

**Given** a user submits a registration form with an email that already exists in the system,
**When** the registration request is processed,
**Then** the request is rejected with an appropriate error indicating the email is already in use (without revealing whether the account is verified or not, to prevent enumeration).

**Given** a user has received a verification email,
**When** they click the verification link containing the token,
**Then** their account is marked as verified and the token is invalidated.

**Given** a user has a verification token that is older than 24 hours,
**When** they attempt to verify their email with that token,
**Then** the request is rejected and the user is informed the token has expired and must request a new one.

**Given** a user requests a new verification email,
**When** the request is processed,
**Then** a new verification token is generated (invalidating any previous token), and a new email is sent.

**Given** a frontend client needs to know the verification status of a user,
**When** it polls the verify-status endpoint,
**Then** the endpoint returns the current verification state of the user's email.

**Given** registration and verification endpoints are exposed,
**When** excessive requests are made from a single source,
**Then** rate limiting is applied to prevent abuse.

**Given** the email service abstraction layer (Story 1.2d),
**When** a verification email needs to be sent,
**Then** it is sent through the abstraction layer using Resend as the provider, allowing future provider swaps without code changes.

### Failure-Path Acceptance Criteria

**Given** a user who has sent 5 verification emails in 10 minutes,
**When** they request another,
**Then** they receive a 429 Too Many Requests response with a `Retry-After` header indicating when they can try again.

**Given** a registration request with a malformed email (including SQL injection attempts, excessively long strings, or invalid characters),
**When** the request is processed,
**Then** it is rejected by input validation before any database interaction occurs, returning a 400 Bad Request with a sanitized error message.

**Given** the Resend email service is unavailable (network error, service outage, rate limit from provider),
**When** a registration request succeeds,
**Then** the user record is created in the database, a retry job is queued for the verification email delivery, and the user sees a message indicating "Email may be delayed" rather than a registration failure.

---

## Story 1.5: Login, Session Management & Password Reset API

**Size:** L | **Audience:** Backend | **Dependencies:** Story 1.4

As a registered user,
I want to log in securely, have my session managed with rotating tokens, and reset my password if I forget it,
So that my account remains secure and I can always regain access.

### Acceptance Criteria

**Given** a user submits valid login credentials (email and password),
**When** the login request is processed,
**Then** a JWT access token (15-minute expiry) and a refresh token (7-day expiry for standard sessions, 30-day for "remember me") are issued. The refresh token is set as an httpOnly, secure, SameSite cookie.

**Given** a user's access token has expired,
**When** the client sends the refresh token,
**Then** a new access token and a new refresh token are issued (refresh token rotation), and the old refresh token is invalidated.

**Given** a user has failed login 5 times consecutively,
**When** they attempt a 6th login,
**Then** the account is locked out for 15 minutes, and the user is informed of the lockout with the remaining time.

**Given** a locked-out user waits for the lockout period to expire,
**When** they attempt to log in with correct credentials,
**Then** the login succeeds and the failure counter is reset.

**Given** a user requests a password reset,
**When** the request is processed,
**Then** a password reset token is generated and sent to the user's email (if the email exists; the response is identical whether or not the email is found, to prevent enumeration).

**Given** a user submits a valid password reset token with a new password,
**When** the reset is processed,
**Then** the password is updated (hashed with bcrypt), all existing sessions (refresh tokens) for the user are invalidated, and the reset token is consumed.

**Given** a user logs out,
**When** the logout request is processed,
**Then** the refresh token is invalidated and the httpOnly cookie is cleared.

### Rate Limit Storage

Rate limiting uses PostgreSQL-backed storage (not in-memory) so it functions correctly behind a load balancer across multiple API instances. Implementation uses a `rate_limits` table with columns: `key` (VARCHAR, primary key composite), `count` (INTEGER), `window_start` (TIMESTAMPTZ), `expires_at` (TIMESTAMPTZ). A periodic cleanup job removes expired rows.

### Failure-Path Acceptance Criteria

**Given** two browser tabs attempting a token refresh simultaneously (both sending the same refresh token),
**When** both requests reach the server,
**Then** token family detection handles the race condition: the first request succeeds and rotates the token; if the old (rotated-out) token is reused by the second tab, the system detects token reuse and revokes the entire token family, forcing the user to re-authenticate. This prevents session fixation and token theft scenarios.

**Given** a JWT with a valid cryptographic signature but referencing a user ID that has been deleted from the database,
**When** the auth middleware processes the request,
**Then** it returns a 401 Unauthorized response (not a 500 Internal Server Error), with the token treated as invalid.

**Given** the JWT signing key configuration,
**When** the API server starts up,
**Then** the signing key is loaded from an environment variable (e.g., `JWT_SIGNING_KEY`), validated to be at least 256 bits in length, and if the key is missing or too short, the API refuses to start and logs a clear error message indicating the configuration problem.

---

## Story 1.6: Google OAuth & Invite Acceptance API

**Size:** L | **Audience:** Backend | **Dependencies:** Story 1.5

As a user or invited staff member,
I want to sign in with my Google account and optionally accept a staff invitation during the OAuth flow,
So that I can use social login for convenience and seamlessly join a class when invited.

### Acceptance Criteria

**Given** a user clicks "Sign in with Google,"
**When** the OAuth flow is initiated,
**Then** the user is redirected to Google's consent screen with a CSRF nonce stored server-side (or in a secure, signed cookie) and included in the OAuth `state` parameter.

**Given** a user completes the Google consent screen,
**When** Google redirects back with an authorization code,
**Then** the callback endpoint validates the CSRF nonce from the `state` parameter, exchanges the code for tokens, retrieves the user's Google profile (email, name, avatar), and either creates a new account or links to an existing account matched by email.

**Given** a user already has an email/password account with the same email as their Google account,
**When** they sign in with Google for the first time,
**Then** the Google identity is linked to their existing account (account linking by email), and they can subsequently sign in with either method.

**Given** a user has been invited to join a class and clicks the invite link,
**When** the invite flow redirects through Google OAuth,
**Then** the invite token is piggybacked on the OAuth state parameter in the format `{nonce}:{inviteToken}`, and after successful authentication, the invite is automatically accepted.

**Given** a user accepts an invite via Google OAuth but the Google account email does not match the invited email,
**When** the callback processes the invite,
**Then** the email mismatch is handled according to business rules (either rejecting the invite acceptance with a clear error, or prompting the user to confirm linking), and the mismatch is logged for audit purposes.

**Given** an administrator force-logs out a staff member,
**When** the force-logout is processed,
**Then** all refresh tokens for that user are deleted, preventing new access tokens from being issued after the current access token expires.

### Failure-Path Acceptance Criteria

**Given** a Google OAuth callback with an invalid, expired, or replayed CSRF nonce in the `state` parameter,
**When** the callback endpoint processes the request,
**Then** the request is rejected with a 403 Forbidden status, and the user is redirected to the login page with `error=csrf_invalid` as a query parameter.

**Given** a Google OAuth callback where Google returns an error response (e.g., `access_denied` when the user refuses consent, or `server_error` from Google's side),
**When** the callback endpoint processes the error,
**Then** the user is redirected to the login page with a specific, user-friendly error code (e.g., `error=google_access_denied` or `error=google_server_error`) rather than a generic 500 Internal Server Error.

**Given** a partial OAuth flow where the user initiates Google sign-in but closes the Google consent screen without completing it,
**When** the user returns to the application,
**Then** the application state is clean with no dangling nonces left in an unresolvable state. Nonces have a short TTL (e.g., 10 minutes) and are automatically cleaned up on expiry.

**Given** a force-logout has been issued for a staff member but their current access token is still within the 15-minute validity window,
**When** the staff member makes API requests using that access token,
**Then** the requests succeed until the access token expires naturally. Force-logout only deletes refresh tokens, not access tokens. **This is a known limitation:** the staff member retains access for up to 15 minutes after force-logout. This tradeoff is accepted to avoid the performance cost of checking a token blocklist on every request, and must be documented in the API documentation and communicated to administrators.

---
---

# Epic 1C: Frontend Foundation & Landing Page

## Description

React dashboard scaffolded with design tokens, component library, i18n, routing, state management, error tracking. Auth UI screens for registration, login, verification, reset, invites, and error recovery. Astro landing page with pricing and bilingual support.

Split from the original Epic 1. Contains the decomposed Story 1.7 (split into 1.7a/1.7b/1.7c), Story 1.8 (kept as-is), the decomposed Story 1.9 (split into 1.9a/1.9b/1.9c/1.9d), and Story 1.10 (kept as-is).

## Screen References

- s00: Persona selection
- s22: Class creation
- s33: Student attempt
- s67: Permission denied

## Functional Requirements

- **FR-71:** Public landing page with hero, feature highlights, social proof, pricing, footer; bilingual, SEO-optimized
- **FR-72:** Pricing section displaying three tiers in VND with annual/monthly toggle and tier-specific CTAs
- **FR-73:** Authenticated redirect: logged-in users visiting landing page redirected to role-appropriate dashboard
- **FR-74:** Landing page fully responsive at mobile breakpoints (390x844 reference)

## UX Design Rules

- **UX-DR1:** Shared design token file (`tokens.css`) with CSS custom properties — single source of truth consumed by both Astro landing and React dashboard codebases; lint rule enforcing no raw hex values
- **UX-DR2:** Accessibility token fixes — darken `--cl-muted` to `#595c66` (5.1:1 on paper), create `--cl-accent-2-text` (`#7c4309`) for text-safe amber, `--cl-accent-2-btn` (`#92500a`) for button-safe amber, `--cl-line-interactive` (`#a8a095`) for interactive input borders
- **UX-DR3:** Landing page design — hero with pain articulation headline (Fraunces 44px), calculator visual, feature showcase cards, Vietnamese-register social proof, pricing comparison, navy footer mirroring sidebar
- **UX-DR4:** StickyHeader component — transparent to solid on scroll past 400px; CTA transitions from secondary to primary style; respects `prefers-reduced-motion`
- **UX-DR5:** AuthCard layout component — centered card (max-width 420px, 14px radius), ClassLite wordmark above card, paper background with dot grid pattern
- **UX-DR6:** GoogleOAuthButton — Google ToS-compliant branded styling; visually dominant on all auth screens
- **UX-DR7:** CollapsibleEmailForm — Google-first pattern; email/password form collapsed by default on register and login screens
- **UX-DR8:** PasswordInput + PasswordStrengthBar — eye toggle with aria-label, 4-segment strength bar, aria-live strength announcements
- **UX-DR9:** VerificationPending + useVerificationPoller hook — polls every 5s, auto-redirect on verified, 10-min timeout, Google fallback link
- **UX-DR10:** InviteCard + useInviteToken hook — 6 states covering new user, existing logged in, existing not logged in, expired, already accepted, not found
- **UX-DR11:** PainCalculator component — static stat display with Geist Mono values; pure HTML/CSS
- **UX-DR12:** PricingCard component — tier cards with popular variant (amber border + badge); prices hardcoded in Astro
- **UX-DR13:** SocialProofCard component — Vietnamese-register social proof with named center archetypes
- **UX-DR14:** FeatureCard component — tinted cards with title, description, and preview area
- **UX-DR15:** Mobile auth layout — one action per screen, full-width buttons, 48px minimum touch targets, thumb-zone primary CTA
- **UX-DR16:** Failure state design — three-part recovery pattern (what happened + why + what to do next)
- **UX-DR17:** Language continuity across domains — shared cookie carries preference from landing to auth to product
- **UX-DR18:** Logged-in redirect from landing page — non-httpOnly hint cookie; stale cookie loop broken via session_expired redirect
- **UX-DR19:** Multi-tab refresh coordination — `navigator.locks` + `BroadcastChannel` to prevent concurrent refresh token rotation races
- **UX-DR20:** OAuth email mismatch recovery screen — shows expected vs. actual email with two recovery paths

## Non-Functional Requirements Addressed

- **NFR-1 (i18n Foundation):** react-i18next with en.json + vi.json, runtime language switch, locale-aware formatting, language cookie shared across domains.
- **NFR-3 (Performance Baseline):** Lazy-loaded route chunks (student, teacher, auth), static Astro HTML for landing page, no JS required for PainCalculator.
- **NFR-5 (Accessibility Foundation):** WCAG-compliant contrast ratios via UX-DR2 token fixes, aria-live password strength announcements, 44x44px minimum touch targets, `prefers-reduced-motion` respect.

## Stories

---

### Story 1.7a: Design System & Component Library

**Size:** M | **Audience:** Frontend | **Dependencies:** None
**UX-DRs:** UX-DR1, UX-DR2

As a frontend developer,
I want a shared design token file and shadcn/ui configured with ClassLite tokens,
So that all UI components across both the React dashboard and Astro landing page render with a consistent visual language.

**Acceptance Criteria:**

**Given** the design token file `src/tokens.css`,
**When** inspecting the CSS custom properties,
**Then** all ClassLite tokens are defined:
- Surfaces: `--cl-paper`, `--cl-surface`, and related surface tokens
- Text: `--cl-ink`, `--cl-ink-soft`, `--cl-muted` at `#595c66` (5.1:1 contrast on paper)
- Accents: `--cl-accent`, `--cl-accent-2`, `--cl-accent-2-text` at `#7c4309` (text-safe amber), `--cl-accent-2-btn` at `#92500a` (button-safe amber)
- Borders: `--cl-line`, `--cl-line-soft`, `--cl-line-interactive` at `#a8a095`
- Status colors, tints, typography (Fraunces, Geist, Geist Mono), radius scale, shadows, sidebar tokens, and layout tokens

**Given** the `tokens.css` file exists in the React dashboard project,
**When** checking the Astro landing page project,
**Then** the same `tokens.css` file is committed to `classlite-landing/src/styles/` as a shared source of truth.

**Given** the shadcn/ui configuration (`components.json`),
**When** shadcn components are used in the React dashboard,
**Then** they are themed with ClassLite design tokens: `--cl-ink` for primary color, 6px radius for buttons and inputs, Geist as the base font.

**Given** the Tailwind configuration,
**When** a developer uses a raw hex color value instead of a token,
**Then** a lint rule flags the violation, enforcing token-only color usage across both codebases.

---

### Story 1.7b: App Shell, Routing & State Management

**Size:** L | **Audience:** Frontend | **Dependencies:** Story 1.7a
**UX-DRs:** UX-DR19

As a frontend developer,
I want React Router with lazy loading, TanStack Query with silent refresh, multi-tab coordination, and Zustand stores,
So that the application has performant routing, reliable data fetching with automatic auth recovery, and clean client-side state separation.

**Acceptance Criteria:**

**Given** the `classlite-web/` project,
**When** running `npm run dev`,
**Then** the Vite dev server starts with HMR and proxies `/api/*` to the Go API.

**Given** the `src/routes.tsx` file,
**When** inspecting route definitions,
**Then** routes are defined with React Router v7 and lazy loading,
**And** student-facing routes and teacher/admin routes are in separate code-split chunks,
**And** auth routes (login, register, verify, reset, invite) are in their own chunk.

**Given** the `src/lib/query-client.ts` file,
**When** TanStack Query is configured,
**Then** the global `onError` handler triggers a silent refresh attempt on 401 responses,
**And** on successful refresh, the original request is retried,
**And** on failed refresh, the user is redirected to `/login`.

**Given** multiple browser tabs are open,
**When** an access token expires and one tab initiates a refresh,
**Then** `navigator.locks.request('token_refresh')` prevents concurrent refresh token rotation,
**And** `BroadcastChannel` notifies other tabs of the new token so they do not independently attempt refresh (UX-DR19).

**Given** the `src/stores/` directory,
**When** inspecting Zustand stores,
**Then** `uiStore.ts` (sidebar state, modal state), `editorStore.ts`, and `languageStore.ts` exist,
**And** Zustand stores contain NO server-derived data (all server state lives in TanStack Query cache).

**Given** the Sentry SDK configuration,
**When** an unhandled error occurs in the frontend,
**Then** it is captured by Sentry with `request_id` breadcrumbs for cross-service correlation with the Go API.

---

### Story 1.7c: Shared Layout Components & i18n

**Size:** M | **Audience:** Frontend | **Dependencies:** Story 1.7a, Story 1.7b
**UX-DRs:** UX-DR17

As a frontend developer,
I want shared layout components, error boundaries, and a fully configured i18n system,
So that every page has a consistent shell, errors are caught gracefully, and the product supports Vietnamese and English with seamless language continuity across domains.

**Acceptance Criteria:**

**Given** the `src/components/shared/` directory,
**When** inspecting shared layout components,
**Then** the following exist:
- `AppLayout.tsx`: sidebar + topbar shell that wraps authenticated pages
- `ErrorBoundary.tsx`: top-level error boundary that displays a Sentry event ID for support reference
- `PermissionDenied.tsx`: role-gated access denied screen
- `NotFound.tsx`: 404 screen for unmatched routes

**Given** the `src/locales/` directory,
**When** react-i18next is initialized,
**Then** `en.json` and `vi.json` translation files exist with initial keys for auth screens,
**And** the language can be switched at runtime via a toggle without a page reload,
**And** date, time, and number formatting respects the active locale.

**Given** a user switches language on any screen,
**When** the preference is stored,
**Then** a cookie on `.classlite.app` domain persists the choice so it carries from the landing page to auth screens to the product without re-selection at transition points (UX-DR17).

**Given** the `src/hooks/` directory,
**When** inspecting app-wide hooks,
**Then** `useAuth.ts`, `useCurrentCenter.ts`, `useRole.ts`, and `usePolling.ts` exist as stubs ready for implementation in subsequent stories.

---

### Story 1.8: Auth UI -- Registration & Login Screens

**Size:** L | **Audience:** Frontend | **Dependencies:** Story 1.7c
**UX-DRs:** UX-DR5, UX-DR6, UX-DR7, UX-DR8, UX-DR15

As a new or returning user,
I want to see polished registration and login screens with Google OAuth as the primary action,
So that I can create an account or sign in quickly with minimal friction.

**Acceptance Criteria:**

**Given** the `features/auth/` directory,
**When** inspecting auth components,
**Then** the following shared components exist:
- `AuthCard.tsx`: centered card (max-width 420px, 14px radius, `--cl-shadow-card`), ClassLite wordmark (Fraunces 22px italic + amber dot) above card, paper background with dot grid pattern (UX-DR5)
- `GoogleOAuthButton.tsx`: white background, line border, colored Google SVG logo, ToS-compliant; states: default, hover, loading (spinner replaces logo), disabled (UX-DR6)
- `CollapsibleEmailForm.tsx`: collapsed by default behind a link trigger, dashed-to-solid border on expand (UX-DR7)
- `PasswordInput.tsx`: eye toggle with aria-label for show/hide
- `PasswordStrengthBar.tsx`: 4 segments (red/amber/gold/green), aria-live="polite" strength announcements (UX-DR8)

**Given** an unauthenticated user navigating to `/register`,
**When** the registration page renders,
**Then** they see the AuthCard with Fraunces heading conveying "create account" in the active locale,
**And** the Google OAuth button is the largest, most prominent element,
**And** below a divider with localized "or" text, a link to expand the CollapsibleEmailForm is visible,
**And** the expanded form shows: full name input, email input, password input with eye toggle and strength bar,
**And** a primary submit button for account creation,
**And** a link below the card directing to the login screen for users who already have an account,
**And** all labels are visible above fields (Geist Mono 10px uppercase), not placeholder-only.

**Given** the registration form,
**When** the user fills in fields and blurs,
**Then** inline validation runs: email format check, password minimum 8 characters,
**And** password strength bar updates in real time (weak/medium/strong levels displayed via aria-live),
**And** all validation errors are shown simultaneously on submit attempt.

**Given** a successful registration submission,
**When** the API returns 201,
**Then** the user is redirected to the verification pending screen.

**Given** a duplicate email error (409),
**When** the API returns the error,
**Then** an inline error appears on the email field indicating the email is already registered.

**Given** an unauthenticated user navigating to `/login`,
**When** the login page renders,
**Then** they see the AuthCard with Google OAuth button (primary), a collapse trigger for the email form, email + password form, a remember-me checkbox, and a forgot-password link,
**And** failed login shows a form-level alert indicating incorrect credentials.

**Given** a successful login,
**When** the API sets auth cookies,
**Then** the user is redirected to their dashboard (or onboarding if new, per role).

**Given** auth screens at mobile breakpoint (at or below 640px),
**When** rendered on a 390px viewport,
**Then** the card is full-width with 20px horizontal padding,
**And** all buttons are full-width at 48px height,
**And** all inputs are 48px height,
**And** touch targets are minimum 44x44px (UX-DR15).

**Given** the language toggle on auth screens,
**When** the user switches language,
**Then** the entire auth screen re-renders in the selected language,
**And** the language preference is stored in a cookie that persists across domains (UX-DR17).

---

### Story 1.9a: Email Verification UI

**Size:** S | **Audience:** Frontend | **Dependencies:** Story 1.7c, Story 1.8
**UX-DRs:** UX-DR9

As a user who just registered with email,
I want a clear verification-pending screen that automatically detects when I verify,
So that I can seamlessly proceed to onboarding without manually refreshing or navigating.

**Acceptance Criteria:**

**Given** an unverified user redirected after registration,
**When** the verification pending screen renders,
**Then** they see an envelope illustration (80x80), a Fraunces heading conveying "check your email" in the active locale, their email address displayed in bold, and a resend button with a 60-second countdown between resend attempts,
**And** a Google fallback link offering the option to sign in with Google using the same account to bypass email verification.

**Given** the `useVerificationPoller` hook is active,
**When** the hook polls `GET /auth/verify-status` every 5 seconds,
**Then** it monitors the response status continuously.

**Given** the verification poller detects `status: verified`,
**When** the poll response arrives,
**Then** the user is automatically redirected to onboarding without any manual action.

**Given** the verification poller has been running for 10 minutes,
**When** the timeout is reached,
**Then** polling stops and a manual button appears allowing the user to re-check verification status.

**Given** the verification poller detects `status: token_expired`,
**When** the response arrives,
**Then** the screen displays a message indicating the link has expired with a CTA to request a new verification email.

---

### Story 1.9b: Password Reset UI

**Size:** S | **Audience:** Frontend | **Dependencies:** Story 1.7c, Story 1.8
**UX-DRs:** None

As a user who forgot their password,
I want to request a reset link and set a new password,
So that I can regain access to my account without contacting support.

**Acceptance Criteria:**

**Given** a user navigating to `/forgot-password`,
**When** the page renders,
**Then** they see an email input and a submit button,
**And** on submission, a confirmation message is shown regardless of whether the email exists in the system (preventing email enumeration),
**And** a hint about checking the spam folder is visible below the submit area,
**And** after submission, the screen displays instructions to check their email.

**Given** a user navigating to `/reset-password?token={token}`,
**When** the token is valid,
**Then** they see a new password input with the PasswordStrengthBar component and a confirm button,
**And** on successful reset, they are redirected to login with a success notification.

**Given** an expired reset token,
**When** the page renders,
**Then** the screen displays a message indicating the link has expired with a single-click CTA to request a new link,
**And** the CTA pre-fills the user's email address so they do not need to re-enter it.

---

### Story 1.9c: Invite Acceptance UI

**Size:** M | **Audience:** Frontend | **Dependencies:** Story 1.7c, Story 1.8
**UX-DRs:** UX-DR10

As a user who received an invite link from a center,
I want to see who invited me, which center, and my assigned role, and complete acceptance with minimal steps,
So that I feel expected and can join my center quickly.

**Acceptance Criteria:**

**Given** a user clicking an invite link to `/invite/{token}`,
**When** the invite is valid and they are a new user (no existing account),
**Then** the InviteCard shows:
- Center logo or auto-generated lettermark (56x56)
- A heading showing the inviter name and center name (e.g., "[Inviter] invited you to join [Center name]" in the active locale)
- A role badge in amber indicating the assigned role
- Google OAuth button as the primary action
- A collapsed email form with the email field locked to the invite address

**Given** a user clicking an invite link who is already logged in with a matching account,
**When** the invite page renders,
**Then** they see a single confirmation button to join the center (not auto-accepted, requiring explicit user action).

**Given** a user clicking an invite link who has an existing account but is not logged in,
**When** the invite page renders,
**Then** they see a login form to authenticate before accepting the invite.

**Given** an expired invite,
**When** the invite page renders,
**Then** the screen shows a clock illustration, a message indicating the invitation has expired, the center name, and a CTA with a mailto link to contact the inviter.

**Given** an already-accepted invite,
**When** the invite page renders,
**Then** the user is redirected to the dashboard with a notification confirming they have already joined the center.

**Given** an invalid or not-found invite token,
**When** the invite page renders,
**Then** the screen shows a distinct error message (clearly different from the expired state) indicating the link is invalid.

---

### Story 1.9d: Auth Error & Recovery States

**Size:** M | **Audience:** Frontend | **Dependencies:** Story 1.7c, Story 1.8
**UX-DRs:** UX-DR16, UX-DR18, UX-DR20

As a user encountering an authentication error,
I want clear, recovery-focused error screens that tell me what happened, why, and what to do next,
So that I always have a path forward and never hit a dead end.

All error screens in this story follow the three-part pattern mandated by UX-DR16: (1) what happened, (2) why it happened, (3) what the user can do next.

**Acceptance Criteria:**

**Lockout Screen:**

**Given** 5 failed login attempts triggering lockout,
**When** the lockout screen renders,
**Then** the heading conveys "try again later" in the active locale (recovery-focused, not punitive),
**And** a countdown timer shows the remaining lockout duration (initialized from the server's `retry_after` value),
**And** the primary CTA is a password reset link, which remains active and clickable during lockout (offering an immediate escape route),
**And** refreshing the page fetches the current remaining lockout duration from the API rather than restarting the timer client-side.

**OAuth Email Mismatch Screen (UX-DR20):**

**Given** a Google OAuth email mismatch during invite acceptance,
**When** the callback redirects with `?error=email_mismatch`,
**Then** the screen shows the expected email (from the invite) vs. the actual email (from Google),
**And** offers two recovery paths: one to try a different Google account (re-initiates OAuth flow) and one to fall back to email registration.

**Google Workspace Blocked Screen:**

**Given** a Google Workspace account that blocks OAuth for ClassLite,
**When** the error redirect arrives at `/login?error=google_blocked`,
**Then** the screen explains that the user's Google account does not allow sign-in to ClassLite,
**And** two alternatives are presented: trying a personal Gmail account, or registering with email/password.

**Session Expiry Screen (UX-DR18):**

**Given** a session expiry (silent refresh failure),
**When** the user is bounced to login,
**Then** a message indicating the session has expired is shown,
**And** the URL the user was trying to reach is preserved and restored after successful re-login,
**And** the stale hint cookie (`logged_in=1`) is cleared to prevent redirect loops between the landing page and the dashboard (UX-DR18).

---

### Story 1.10: Astro Landing Page

**Size:** L | **Audience:** Frontend | **Dependencies:** Story 1.7a (shared tokens)
**UX-DRs:** UX-DR3, UX-DR4, UX-DR11, UX-DR12, UX-DR13, UX-DR14, UX-DR15, UX-DR18

As a visitor discovering ClassLite,
I want a bilingual, SEO-optimized landing page that shows the value proposition, features, pricing, and a clear path to sign up,
So that I understand what ClassLite does and can start using it for free.

**Acceptance Criteria:**

**Given** a visitor landing on `classlite.app`,
**When** the page loads,
**Then** it is server-rendered static HTML (Astro output) with SEO meta tags and Open Graph data,
**And** the page loads without authentication,
**And** the default language is detected from the browser `Accept-Language` header and redirects to `/vi/` or `/en/`.

**Given** the landing page in Vietnamese (`/vi/`),
**When** scrolling through the page,
**Then** the following sections appear in order:
1. **Header** — logo, navigation, language toggle, CTA button
2. **Hero** — Fraunces 44px heading with pain articulation, eyebrow text identifying ClassLite as an IELTS center management platform, primary CTA linking to registration
3. **Pain Articulation** — PainCalculator component: a static calculator visual showing the cost of manual grading (e.g., 5 teachers x 3 hours/week x 48 weeks = 720 hours/year), rendered with Geist Mono 28px values, 11px units, and result in `--cl-accent-2-text` at 36px; pure HTML/CSS, no JavaScript required (UX-DR11)
4. **Feature Showcase** — 3-4 FeatureCard components with tinted backgrounds (blue/gold/green mapping to `--cl-tint-*` tokens), each with title, description, and 160px preview area; SVG via inline slot for token-colored strokes (UX-DR14)
5. **Social Proof** — SocialProofCard components with Vietnamese-register social proof: named center archetypes with outcome data, stats, quotes, and details; all content hardcoded in Astro (UX-DR13)
6. **Pricing** — three PricingCard components (Free/Pro/Studio) with features matching tier limits, prices displayed in VND with an annual/monthly toggle, annual showing savings callout; the Pro tier card has a `2px solid --cl-accent-2` border and a popular badge; Free CTA links to registration, Pro/Studio CTAs link to registration with `?plan=pro` or `?plan=studio`; a centered CTA appears below the pricing grid (UX-DR12)
7. **Footer** — background using `--cl-ink` (navy) mirroring the authenticated sidebar, links using `--cl-sidebar-text` color, legal links (Terms, Privacy), Fraunces wordmark

**Given** the StickyHeader component,
**When** the user scrolls past 400px from the top,
**Then** the header transitions from transparent background to `--cl-surface` with border and shadow,
**And** the CTA button transitions from secondary to primary style,
**And** the transition duration is 0.2s and respects `prefers-reduced-motion` (UX-DR4).

**Given** a user who is already logged in (hint cookie `logged_in=1` exists),
**When** they visit the landing page,
**Then** a client-side script detects the cookie and redirects to `my.classlite.app/dashboard` (FR-73).

**Given** a stale hint cookie (user's session actually expired),
**When** `my.classlite.app` detects a failed silent refresh,
**Then** the hint cookie is cleared and the user is redirected to `classlite.app?session_expired=true`,
**And** the landing page shows a subtle banner indicating the session has expired (UX-DR18).

**Given** the landing page at mobile breakpoint (at or below 640px),
**When** rendered on a 390x844 viewport,
**Then** hero, features, pricing, and footer stack vertically,
**And** CTA buttons are full-width,
**And** no horizontal scrolling occurs at any breakpoint,
**And** pricing cards stack to a single column (UX-DR15).

**Given** the language toggle in the header,
**When** a user switches from Vietnamese to English (or vice versa),
**Then** the page navigates from `/vi/` to `/en/` (or vice versa),
**And** the language preference is stored in a cookie on `.classlite.app` for continuity to `my.classlite.app` (UX-DR17).

**Given** all CTA buttons on the landing page,
**When** clicked,
**Then** they link to `my.classlite.app/register` (with tier-specific query parameters where applicable).

---
---

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

---
---

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

---
---

# Epic 4: Exercise Authoring, AI Content Generation & Knowledge Hub

**Functional Requirements:** FR-20 through FR-26, FR-54, FR-55

---

## Story 4.1: Exercise Library & CRUD API

- **Size:** M | **Audience:** Full-stack | **Dependencies:** 2.6

As a teacher, I want to browse, create, edit, and delete exercises so that I can build a library of reusable content for my classes.

**Screens:** Exercise library at `/exercises` (s15).

**UI/UX:**
- Table view with columns: title, code, sections, questions, skills, tags, classes, last modified
- Filters by skill, tag, class, and assignment status

**API & Data:**
- Full CRUD endpoints for exercises
- `exercises` table with JSONB `content` column + `schema_version`
- Content schema:
  ```json
  {
    "sections": [{
      "type": "",
      "title": "",
      "content": "",
      "questionGroups": [{
        "questions": [{
          "text": "",
          "type": "",
          "options": [],
          "correctAnswer": "",
          "acceptedVariants": []
        }]
      }]
    }]
  }
  ```
- Go typed struct unmarshal for content deserialization

**Acceptance Criteria:**
- Given a teacher navigates to `/exercises`, When the page loads, Then a table displays all exercises with title, code, sections, questions, skills, tags, classes, and last modified columns
- Given the exercise library is displayed, When the teacher applies filters by skill, tag, class, or assignment status, Then only matching exercises are shown
- Given a teacher clicks "Create Exercise", When they submit the form with valid data, Then a new exercise is created with a JSONB content column and schema_version
- Given an exercise exists, When a teacher edits it via the CRUD endpoint, Then the exercise content is updated and schema_version is preserved
- Given an exercise exists, When a teacher deletes it, Then the exercise is removed from the library
- Given the JSONB content is retrieved, When Go deserializes it, Then the typed struct unmarshal correctly parses the content schema

---

## Story 4.2: Exercise Editor — Structure, Questions & Settings

- **Size:** L | **Audience:** Full-stack | **Dependencies:** 4.1

As a teacher, I want a structured editor for exercises so that I can define sections, question groups, and configure settings like time limits and answer matching.

**Screens:** Two-panel editor at `/exercises/{id}/edit` (s16).

**UI/UX:**
- Left sidebar: metadata editing
- Right panel: sections with question groups
- Section types: Reading passage, Listening audio, Writing prompt, Speaking cue card
- Question types: T/F/NG, Gap-fill, Matching Headings, MCQ, Short Answer
- Settings: time limit toggle, answer matching mode (case-insensitive, hyphen/whitespace normalization)
- Locked state for assigned+submitted exercises with Clone/Unfinalize options
- Drag-and-drop reorder for sections and questions
- Debounce autosave

**Acceptance Criteria:**
- Given a teacher opens `/exercises/{id}/edit`, When the editor loads, Then a two-panel layout is displayed with metadata sidebar on the left and sections on the right
- Given the editor is open, When the teacher adds a section, Then they can choose from Reading passage, Listening audio, Writing prompt, or Speaking cue card types
- Given a section exists, When the teacher adds questions, Then they can choose from T/F/NG, Gap-fill, Matching Headings, MCQ, or Short Answer types
- Given the settings panel, When the teacher configures time limit and answer matching mode, Then the settings are persisted (case-insensitive, hyphen/whitespace normalization options available)
- Given an exercise is assigned and has submissions, When the teacher opens the editor, Then the exercise is in a locked state with Clone and Unfinalize options visible
- Given multiple sections or questions exist, When the teacher drags and drops items, Then the order is updated and persisted
- Given the teacher makes edits, When they stop typing, Then changes are autosaved after a debounce delay

---

## Story 4.3: AI Content Generation Pipeline

- **Size:** L | **Audience:** Full-stack | **Dependencies:** 4.1, 1.2e (presigned uploads)

As a teacher, I want to generate exercise content using AI so that I can quickly create high-quality sections and questions without manual effort.

**Screens:** AI generation dialog (s17).

**UI/UX:**
- Section generation with parameters: type, topic, band level, question count, type mix
- Credit cost displayed before generation
- Preview generated content before accept/edit/dismiss
- Question generation for existing sections
- Distractor generation for MCQ options

**API & Data:**
- Job created via `POST /api/exercises/{id}/ai-generate`
- Frontend polls `GET /api/jobs/{jobId}` with progressive backoff (2s → 4s → 8s)
- `jobs` table:
  - `id`, `center_id`, `type` (enum), `status` (pending/processing/complete/failed)
  - `params` JSONB, `result` JSONB, `error_details`
  - `retry_count`, `max_retries`
  - `created_at`, `started_at`, `completed_at`
- Index on `(status, created_at)`
- Worker goroutines with `SELECT FOR UPDATE SKIP LOCKED`
- AI credit metering per generation

**Acceptance Criteria:**
- Given a teacher opens the AI generation dialog, When they configure section parameters (type, topic, band, question count, type mix), Then the credit cost is displayed before confirming
- Given the teacher confirms generation, When the job is created via `POST /api/exercises/{id}/ai-generate`, Then a job record is inserted with status "pending" and the frontend begins polling
- Given the frontend is polling, When it calls `GET /api/jobs/{jobId}`, Then it uses progressive backoff (2s → 4s → 8s) to reduce server load
- Given the job completes, When the result is returned, Then the teacher sees a preview of generated content and can accept, edit, or dismiss it
- Given an existing section, When the teacher requests question generation or distractor generation, Then AI generates appropriate questions or MCQ distractors for that section
- Given worker goroutines are processing jobs, When a worker picks up a job, Then it uses `SELECT FOR UPDATE SKIP LOCKED` to avoid contention
- Given AI credits are consumed, When a generation completes, Then the credit meter is updated for the center

**Failure-Path Acceptance Criteria:**
- Given a job stuck in "processing" for more than 5 minutes, When the frontend polls, Then the UI shows "Taking longer than expected" with a "Cancel and retry" option
- Given Gemini API returns an error or is unreachable, When the worker processes the job, Then the job is marked failed with `error_details`, `retry_count` incremented, retried with exponential backoff (30s, 60s, 120s) up to `max_retries` (3)
- Given `max_retries` exhausted, When the job permanently fails, Then the teacher sees "Generation failed — please try again or create content manually" with a direct link to manual creation
- Given Gemini returns malformed/unparseable output, When the worker processes it, Then the job fails with `error_details="invalid_ai_response"` and is NOT auto-retried (requires different prompt, not same retry)

---

## Story 4.4: Knowledge Hub & File Management

- **Size:** L | **Audience:** Full-stack | **Dependencies:** 1.2e (presigned uploads)

As a teacher, I want a Knowledge Hub to upload, organize, and manage files so that I can reference them in class materials and exercises.

**Screens:** Knowledge Hub at `/knowledge-hub` (s26), File detail at `/knowledge-hub/files/{slug}` (s27).

**UI/UX:**
- Folder-based file browser
- File upload via presigned URL flow:
  1. `POST /api/uploads/presign` — get presigned URL
  2. Direct upload to R2
  3. `POST /api/uploads/confirm` — confirm upload
- Supported file types: PDF, PNG, JPG, SVG, MP3, WAV, WebM
- File size validated against plan storage limits
- File detail view with preview, metadata, linked locations, and view rate
- "From Knowledge Hub" picker integrated in class materials and exercise editor

**API & Data:**
- `files` table for file metadata
- `folders` table for folder structure
- `file_views` table for tracking view analytics

**Acceptance Criteria:**
- Given a teacher navigates to `/knowledge-hub`, When the page loads, Then a folder-based file browser is displayed
- Given the teacher clicks upload, When they select a file, Then a presigned URL is obtained via `POST /api/uploads/presign`, the file is uploaded directly to R2, and confirmed via `POST /api/uploads/confirm`
- Given a file is being uploaded, When the file type is checked, Then only PDF, PNG, JPG, SVG, MP3, WAV, and WebM files are accepted
- Given a file is being uploaded, When the size is checked, Then it is validated against the center's plan storage limits
- Given a file exists, When the teacher opens `/knowledge-hub/files/{slug}`, Then a detail view shows preview, metadata, linked locations, and view rate
- Given the teacher is editing class materials or an exercise, When they use the "From Knowledge Hub" picker, Then they can browse and select files from the Knowledge Hub
- Given file views are tracked, When a file is viewed, Then the `file_views` table is updated for analytics

---

## Story 4.5: JSONB Schema Migration Strategy

- **Size:** S | **Audience:** Backend | **Dependencies:** 4.1

As a developer, I want a strategy for migrating JSONB content schemas (exercises, AI responses, submissions) when the schema evolves, so that existing data remains readable without manual intervention.

**Acceptance Criteria:**
- Given exercise content JSONB with `schema_version=1`, When the application reads it and current schema is v2, Then a lazy migration function upgrades the content in-memory and writes the updated version back on next save
- Given a batch migration script in `scripts/migrate-jsonb.sh`, When run with `--entity=exercises --from=1 --to=2`, Then all rows are updated in batches of 100 with progress logging
- Given any JSONB column with a `schema_version`, When the Go code unmarshals it, Then the unmarshal function dispatches by version and upgrades to current before returning typed struct
- Schema versions are monotonically increasing integers, never skipped

---
---

# Epic 5: Assignments, Student Attempts & Submissions

**Functional Requirements:** FR-27 through FR-32

---

## Story 5.1: Assignment Creation & Submission Lifecycle API

- **Size:** L | **Audience:** Backend | **Dependencies:** 4.1, 3.1

As a teacher, I want to create assignments and manage the submission lifecycle so that students can attempt exercises and their work progresses through defined states.

**API & Data:**
- `POST /api/assignments` to create assignments
- Assignment statuses: open / closed
- Student starts attempt → submission status `in_progress`
- Submit → status `submitted` + `late` flag calculated
- Late penalty math stored on submission
- Hard deadline locks submission (no further changes accepted)
- Submission lifecycle: `in_progress` → `submitted` → `ai_processing` → `graded`
- `assignments` table
- `submissions` table with JSONB `content` + `schema_version`
- Unique constraint: one submission per student per assignment

**Acceptance Criteria:**
- Given a teacher creates an assignment via `POST /api/assignments`, When valid data is provided, Then the assignment is created with status "open"
- Given an assignment is open, When a student starts an attempt, Then a submission is created with status "in_progress"
- Given a student submits their work, When the submission is processed, Then the status changes to "submitted" and a late flag is calculated based on the deadline
- Given a submission is late, When the late penalty is applied, Then the penalty math is stored on the submission record
- Given the hard deadline has passed, When a student attempts to modify their submission, Then the submission is locked and no further changes are accepted
- Given a submission is submitted, When it progresses through the lifecycle, Then it transitions through `in_progress` → `submitted` → `ai_processing` → `graded`
- Given a student and assignment pair, When a submission already exists, Then the unique constraint prevents creating a duplicate submission

---

## Story 5.2: Quiz Attempt Interface (Reading/Listening/Vocabulary)

- **Size:** L | **Audience:** Frontend | **Dependencies:** 5.1

As a student, I want to take quiz-style exercises with various question types so that I can complete reading, listening, and vocabulary assignments.

**Screens:** Split-pane quiz interface (s33).

**UI/UX:**
- Left pane: passage display or audio player
- Right pane: questions with input types:
  - Radio buttons for T/F/NG and MCQ
  - Text input for gap-fill and short answer
  - Drag-and-drop for matching
- Prev/Next navigation between questions
- Question flag toggle to mark questions for review
- Timer displayed with server-side start time as source of truth
- Incremental save every 30 seconds
- Listening variant with integrated audio player
- Submit confirmation dialog showing answered, unanswered, and flagged question counts

**API:**
- `PUT /api/submissions/{id}/progress` — incremental save
- `POST /api/submissions/{id}/submit` — final submission

**Acceptance Criteria:**
- Given a student opens a quiz attempt, When the interface loads, Then a split-pane layout shows the passage/audio on the left and questions on the right
- Given a T/F/NG or MCQ question, When the student answers, Then radio buttons are used for selection
- Given a gap-fill or short answer question, When the student answers, Then text input fields are used
- Given a matching question, When the student answers, Then drag-and-drop interaction is available
- Given the student is navigating questions, When they click Prev/Next, Then they move between questions sequentially
- Given a question, When the student flags it, Then the flag toggle marks it for later review
- Given the attempt has started, When the timer is displayed, Then it uses the server-side start time as the source of truth
- Given the attempt is in progress, When 30 seconds elapse since the last save, Then answers are incrementally saved via `PUT /api/submissions/{id}/progress`
- Given a listening exercise, When the student starts, Then an audio player is integrated into the left pane
- Given the student clicks submit, When the confirmation dialog appears, Then it shows counts of answered, unanswered, and flagged questions
- Given the student confirms submission, When the request is sent, Then `POST /api/submissions/{id}/submit` finalizes the attempt

**Failure-Path Acceptance Criteria:**
- Given a network drop during incremental save, When connection resumes, Then the next save includes all unsaved answers without data loss
- Given the timer expires while the student has unsaved answers, When auto-submit triggers, Then all current answers are saved before submission

---

## Story 5.3: Writing Attempt Interface

- **Size:** L | **Audience:** Frontend | **Dependencies:** 5.1

As a student, I want a writing interface to compose and submit written responses so that I can complete writing assignments with real-time feedback on my progress.

**Screens:** Writing attempt at `/assignments/{id}/write` (s34), Mobile (s78).

**UI/UX:**
- Rich text editor with formatting toolbar
- Live word count displayed
- Time-on-task tracker
- Due-date countdown visible
- Debounce autosave via TanStack Query mutations (NOT React Hook Form)
- Mobile (s78): phone-sized writing surface with sticky word counter
- Content stored as rich text in JSONB

**Acceptance Criteria:**
- Given a student opens `/assignments/{id}/write`, When the editor loads, Then a rich text editor with toolbar is displayed
- Given the student is typing, When text changes, Then a live word count is updated in real time
- Given the attempt is active, When the student is working, Then a time-on-task tracker records elapsed time
- Given the assignment has a due date, When the editor is open, Then a due-date countdown is visible
- Given the student makes edits, When they pause typing, Then changes are autosaved via debounced TanStack Query mutations
- Given the student is on mobile (s78), When they open the writing interface, Then a phone-sized writing surface is displayed with a sticky word counter
- Given the writing content, When it is persisted, Then it is stored as rich text in the submission's JSONB content column

**Failure-Path Acceptance Criteria:**
- Given a network drop during autosave, When the student continues typing, Then a "Offline — changes saved locally" indicator appears, and local changes sync when connection resumes
- Given the browser tab is closed during an active attempt, When the student returns, Then their last autosaved content is restored

---

## Story 5.4: Speaking Attempt Interface

- **Size:** M | **Audience:** Frontend | **Dependencies:** 5.1, 1.2e (presigned uploads)

As a student, I want to record and submit speaking responses so that I can complete speaking assignments with audio recordings.

**Screens:** Speaking attempt interface, Mobile variant.

**UI/UX:**
- Cue card displayed with preparation countdown timer
- Recording window activates after prep time
- Playback preview of recording before submission
- Re-record unlimited times
- Upload recording to R2 via presigned URL: `{center_id}/speaking/{uuid}.webm`
- Mobile: large thumb-friendly controls for recording

**API:**
- `PUT /api/submissions/{id}/progress` — save progress
- `POST /api/submissions/{id}/submit` — final submission

**Acceptance Criteria:**
- Given a student starts a speaking attempt, When the cue card is shown, Then a preparation countdown timer begins
- Given the prep time expires, When the recording window activates, Then the student can record their response
- Given a recording is complete, When the student finishes, Then they can preview the playback before submitting
- Given the student is not satisfied with their recording, When they choose to re-record, Then they can re-record unlimited times
- Given a recording is ready for upload, When the student submits, Then the audio is uploaded to R2 via presigned URL at `{center_id}/speaking/{uuid}.webm`
- Given the student is on mobile, When they use the speaking interface, Then large thumb-friendly controls are available for recording
- Given the attempt is in progress, When progress is saved, Then `PUT /api/submissions/{id}/progress` is called
- Given the student submits, When the final recording is uploaded, Then `POST /api/submissions/{id}/submit` finalizes the attempt

**Failure-Path Acceptance Criteria:**
- Given microphone permission is denied, When the student starts a speaking attempt, Then a clear message explains how to enable microphone access with browser-specific instructions
- Given the R2 upload fails, When the student clicks submit, Then the upload retries automatically (up to 3 times) with progress indicator, and on permanent failure shows "Upload failed — your recording is saved locally, please try again"

---

## Story 5.5: Submission Result View

- **Size:** M | **Audience:** Frontend | **Dependencies:** 5.1, 6.1

As a student, I want to view my submission results so that I can see my grades, feedback, and understand my performance.

**Screens:** Result view at `/assignments/{id}/result` (s35), Mobile (s79).

**UI/UX:**
- Overall band score displayed
- Per-criterion breakdown with individual scores
- Feedback text with inline anchored comments
- On-time / late submission status visible
- Late penalty math displayed when applicable
- Unreleased results show "Pending grading" message
- Class average hidden from student view
- Mobile (s79): hero band score at top, inline comments, vertical criterion stack

**API:**
- `GET /api/submissions/{id}/result` — returns 404 if results not yet released

**Acceptance Criteria:**
- Given a student opens `/assignments/{id}/result`, When results are released, Then the overall band score is displayed
- Given results are displayed, When per-criterion scores exist, Then a breakdown with individual scores is shown
- Given feedback has been provided, When the student views results, Then feedback text with inline anchored comments is visible
- Given the submission timing, When the student views results, Then on-time or late status is clearly indicated
- Given a late submission, When penalty was applied, Then the late penalty math is visible to the student
- Given results have not been released, When the student visits the result page, Then "Pending grading" is displayed
- Given the result view, When class average data exists, Then it is hidden from the student view
- Given the student is on mobile (s79), When they view results, Then a hero band score is shown at top with inline comments and a vertical criterion stack
- Given results are not yet released, When the API is called via `GET /api/submissions/{id}/result`, Then it returns 404

---
---

## Epic 6: Grading & AI-Assisted Grading

Teachers can grade all submission types — Writing with anchored inline comments, Speaking with timestamp-pinned feedback, auto-graded Reading/Listening with override capability. AI suggests band scores and comments, cutting grading time from ~12 to ~3 minutes.

**FRs:** FR-33, FR-34, FR-35, FR-36, FR-37

### Story 6.1: Writing Grading with Anchored Comments

**Size:** L | **Audience:** Full-stack | **Dependencies:** 5.1

As a Teacher,
I want to grade Writing submissions with inline comments anchored to specific text spans,
So that I can give students precise, contextualized feedback on their essays.

**Acceptance Criteria:**

**Given** a Teacher navigating to a Writing grading view (`/classes/{id}/grading/{aid}/{sid}`, s23)
**When** the grading interface renders
**Then** the student's essay is displayed with the full rich text content
**And** a highlight-and-pin system allows the teacher to select text spans and attach comments

**Given** the comment system
**When** the teacher creates a comment
**Then** three comment types are available: Error (red), Praise (green), Suggestion (yellow)
**And** each comment is tagged by grading criterion: Task Response, Coherence & Cohesion, Lexical Resource, Grammatical Range & Accuracy
**And** comments are anchored to specific text spans or paragraphs with visual pin indicators

**Given** the band score inputs
**When** grading
**Then** four criterion inputs are displayed: Task Response, Coherence & Cohesion, Lexical Resource, Grammatical Range & Accuracy
**And** each accepts band scores from 1.0–9.0 in 0.5 increments
**And** the overall band is calculated automatically from the four criteria

**Given** the grading queue
**When** the teacher finishes grading one submission
**Then** "Prev student / Next student" navigation buttons enable queue-based grading without returning to the list
**And** the grading queue shows: student name, assignment, class, and overdue flag

**Given** the teacher clicking "Submit grade & notify student"
**When** the grade is released
**Then** the submission status changes to "graded" with graded_at timestamp
**And** the student receives a notification that their grade is available
**And** the graded submission becomes immutable (NFR-6)

**Given** the grading API
**When** POST `/api/submissions/{id}/grade` is called
**Then** the request body includes: `{ "criterionScores": { "taskResponse": 6.5, ... }, "overallBand": 6.5, "comments": [{ "type", "criterion", "anchorStart", "anchorEnd", "text" }], "feedback" (optional text) }`
**And** grades are stored in a `grades` table: id, submission_id, center_id, graded_by, criterion_scores (JSONB), overall_band, comments (JSONB), feedback, created_at
**And** the submission's status is updated to "graded"

**Given** inline comments on mobile (s79)
**When** the student views graded feedback on a phone
**Then** comments appear inline within the essay text (not as a side rail)
**And** tapping a comment expands it to show full feedback

### Story 6.2: AI-Assisted Writing Grading

**Size:** L | **Audience:** Full-stack | **Dependencies:** 6.1, 4.3 (job queue)

As a Teacher,
I want AI to propose band scores and inline comments for Writing submissions,
So that I can grade essays in ~3 minutes instead of ~12 by reviewing AI suggestions.

**Acceptance Criteria:**

**Given** a teacher opening a Writing submission for grading
**When** they click "Run AI Grading" (or it runs automatically if configured)
**Then** a job is created via POST `/api/submissions/{id}/ai-grade` with type `ai_grade_writing`
**And** the response returns `{ "jobId": "..." }`
**And** the frontend polls GET `/api/jobs/{jobId}` with progressive backoff (2s → 4s → 8s)

**Given** a completed AI grading job
**When** the results are returned
**Then** the AI proposes: a band score per criterion with written rationale, and inline comments (error/praise/suggestion) anchored to specific text spans
**And** each suggestion has a confidence level: High or Medium
**And** a disclaimer is always visible: "Suggestion — teacher always decides the final band."

**Given** the AI suggestions in the grading UI
**When** the teacher reviews them
**Then** each AI suggestion (band score or comment) can be individually Accepted, Edited, or Dismissed
**And** a bulk "Accept all praise" action is available for quickly accepting positive comments
**And** accepted suggestions populate the grading form — the teacher can still modify before submitting

**Given** AI grading credit consumption
**When** AI grading is triggered
**Then** credits are deducted from the center's monthly allocation
**And** the credit cost is shown before confirming

**Given** the AI grading worker (`internal/worker/ai_grade_writing.go`)
**When** processing a writing grading job
**Then** the worker sends the student's essay + IELTS Writing rubric to Google Gemini
**And** parses the response into structured band scores, rationales, and anchored comments
**And** stores the result in the job's result JSONB
**And** the result is also stored on the submission for reference

**Given** the first AI grade experience (UX-DR21)
**When** a new teacher clicks the "Try AI grading" card on their dashboard
**Then** a pre-loaded sample IELTS Writing essay opens in the grading view
**And** a single CTA triggers AI grading
**And** results appear with subtle transition after ~15–30 seconds (no celebratory modal)
**And** the teacher experiences the 12→3 minute promise before grading real submissions

**Failure-Path Acceptance Criteria:**

**Given** Gemini returns band scores outside 1.0–9.0 range or non-0.5 increments
**When** the worker parses the response
**Then** the job fails with `error_details="invalid_band_scores"` and the teacher sees "AI produced invalid scores — please grade manually" with all form fields empty (not pre-filled with bad data)

**Given** Gemini returns anchored comments with text positions that don't map to the student's essay
**When** displayed
**Then** orphaned comments are shown as general (unanchored) feedback rather than silently dropped

**Given** AI grading takes longer than 60 seconds
**When** the frontend is polling
**Then** after 30s show "Taking longer than expected — AI is still working", after 60s show "This is unusually slow — you can start grading manually and AI suggestions will appear when ready"

**Given** the teacher starts manual grading while AI is still processing
**When** AI results arrive
**Then** they are presented as a non-blocking overlay: "AI suggestions are ready — Review?" with option to merge into existing work

### Story 6.3: Speaking Grading & AI-Assisted Speaking Grading

**Size:** L | **Audience:** Full-stack | **Dependencies:** 5.4

As a Teacher,
I want to grade Speaking submissions with an audio player and timestamp-pinned comments, with AI assistance for transcription and band proposals,
So that I can efficiently evaluate spoken responses with precise feedback.

**Acceptance Criteria:**

**Given** a Teacher navigating to a Speaking grading view (s24)
**When** the grading interface renders
**Then** an audio player is displayed with: waveform visualization, play/pause, seek, and playback speed control (0.5x, 1x, 1.5x, 2x)
**And** band score inputs are shown for: Fluency & Coherence, Lexical Resource, Grammatical Range & Accuracy, Pronunciation
**And** an overall band is calculated from the four criteria

**Given** the timestamp-pinned comment system
**When** the teacher clicks on the waveform at a specific position
**Then** a comment is created anchored to that timestamp
**And** the comment can be typed with the same three types: Error, Praise, Suggestion
**And** comments appear as pins along the waveform timeline

**Given** the AI-assisted Speaking grading feature (FR-36)
**When** the teacher triggers AI grading via POST `/api/submissions/{id}/ai-grade` with type `ai_grade_speaking`
**Then** the AI auto-transcribes the audio recording
**And** proposes band scores per criterion with rationale
**And** identifies specific moments: hesitations, grammatical errors, strong delivery, pronunciation issues — each with a timestamp and confidence level

**Given** the AI transcription result
**When** displayed in the grading view
**Then** transcription time and audio duration are shown
**And** a "View transcript" button shows the full text
**And** each AI-flagged moment can be Accepted, Edited, or Dismissed individually
**And** teacher-saved notes and AI draft notes appear together chronologically along the timeline

**Given** the speaking grading API
**When** POST `/api/submissions/{id}/grade` is called for a speaking submission
**Then** the request body includes criterion scores, overall band, timestamped comments, and optional transcript reference
**And** the grade is stored and the submission status changes to "graded"

**Failure-Path Acceptance Criteria:**

**Given** audio transcription fails (inaudible, too noisy, unsupported codec)
**When** the AI worker processes it
**Then** the job partially succeeds: transcription marked as "unavailable" but band score proposals are still attempted based on audio analysis alone

**Given** the audio file is corrupted or missing from R2
**When** the teacher opens the grading view
**Then** a clear error explains the file issue with "Ask student to re-record" as the suggested action

### Story 6.4: Auto-Grading (Reading/Listening/Vocabulary)

**Size:** M | **Audience:** Backend | **Dependencies:** 5.2

As a Teacher,
I want Reading, Listening, and Vocabulary submissions to be auto-marked against the answer key with my ability to override,
So that objective assessments are graded instantly while I retain control over edge cases.

**Acceptance Criteria:**

**Given** a student submitting a Reading/Listening/Vocabulary assignment
**When** the submission is received
**Then** it is automatically marked against the exercise's answer key immediately
**And** the auto-grade produces: raw score (e.g., 11/14), percentage, and provisional band score

**Given** the auto-grade result
**When** the teacher views it in the grading view (s25)
**Then** a per-answer breakdown is shown: each question, student's answer, correct answer, and mark (correct/wrong/flagged)
**And** spelling variants are flagged for teacher review (e.g., "hydro-electric" vs "hydroelectric") rather than auto-rejected

**Given** a flagged or incorrectly marked answer
**When** the teacher overrides
**Then** they can mark any answer as correct or wrong with a single click
**And** the final score updates immediately after overrides
**And** the override is recorded (who overrode, when)

**Given** the teacher reviewing auto-graded results
**When** they are satisfied with the scores
**Then** clicking "Release result & notify" makes the grade visible to the student and sends a notification
**And** until released, the student sees only "Pending grading" — auto-grade results are not auto-released

**Given** the auto-grading logic in the Go backend
**When** processing a quiz submission
**Then** answer comparison uses the exercise's answer matching mode: case-insensitive by default, normalization strips hyphens and extra whitespace
**And** multiple accepted variants per question are checked
**And** the band conversion follows standard IELTS score-to-band tables

**Given** the auto-grading API
**When** the submission is auto-graded
**Then** the provisional grade is stored in the `grades` table with `graded_by: "system"`
**And** the submission status changes to "graded" but `released_at` remains null until the teacher releases
**And** POST `/api/submissions/{id}/release` sets `released_at` and triggers student notification

---
---

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

---
---

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

---
---

# Epic 9: Billing, Plans & Account Management

**FRs:** FR-61 through FR-66, FR-68

---

## Story 9.1: Plan Tiers & Limit Enforcement

| Field        | Value              |
| ------------ | ------------------ |
| Size         | L                  |
| Audience     | Full-stack         |
| Dependencies | 2.6                |

**As an** owner, **I want** clearly defined plan tiers with enforced limits, **so that** I understand what each tier offers and the system prevents usage beyond my plan.

### Acceptance Criteria

**Given** the plan tier definitions
**When** the system enforces limits
**Then** three tiers are available with these limits:
| Limit | Free | Pro | Studio |
|---|---|---|---|
| Teachers | 1 | Up to 10 | Unlimited |
| Classes | 1 | Unlimited | Unlimited |
| Students per class | 5 | 20 | 60 |
| AI credits/month | 0 | 500 | 2,000 + add-on packs |
| Knowledge Hub storage | 500 MB | 5 GB | 50 GB |
**And** pricing is displayed in VND
**And** annual billing saves the equivalent of 2 months vs. monthly

**Given** an Owner navigating to `/settings/billing/plans` (s68)
**When** the plan picker renders
**Then** three tier cards are displayed with feature limits, pricing (VND), and an annual/monthly toggle
**And** the current plan is highlighted
**And** annual toggle shows savings callout

**Given** usage approaching a plan limit (e.g., 18/20 students in a class)
**When** the teacher or owner encounters the threshold
**Then** a soft warning yellow banner appears: "18 of 20 students — approaching limit"
**And** the banner shows two resolution paths: upgrade or restructure (e.g., split the class)
**And** warnings re-appear at each threshold step (18, 19)

**Given** usage exceeding a plan limit (e.g., attempting to add a 21st student)
**When** the action is attempted
**Then** a hard block prevents the action with a clear message
**And** the block suggests upgrading
**And** existing access is NOT degraded — only the new action is blocked

**Given** the billing dashboard (`/settings/billing`, s69)
**When** an Owner views it
**Then** it shows: current plan, next invoice date/amount, live usage meters (teachers, students, AI credits, storage), and payment method on file

**Given** the plan enforcement API
**When** any action that consumes a limited resource is attempted
**Then** the `billing_service` checks current usage against plan limits before allowing the action
**And** returns a structured error with `code: "PLAN_LIMIT_EXCEEDED"`, the limit name, current usage, and max allowed

**Given** the database
**When** migrations run
**Then** a `subscriptions` table exists: id, center_id, plan (free/pro/studio), billing_cycle (monthly/annual), status (active/past_due/cancelled), polar_subscription_id, current_period_start, current_period_end, created_at
**And** an `ai_credits` table exists: id, center_id, monthly_allocation, monthly_used, addon_remaining, reset_at
**And** RLS policies are applied

---

## Story 9.2: Upgrade, Downgrade & AI Credit Add-ons

| Field        | Value              |
| ------------ | ------------------ |
| Size         | L                  |
| Audience     | Full-stack         |
| Dependencies | 9.1                |

**As an** owner, **I want** to upgrade, downgrade, or purchase AI credit add-ons, **so that** I can adjust my plan as my center's needs change.

### Acceptance Criteria

**Given** an Owner clicking "Upgrade" on the plan picker or billing dashboard
**When** the upgrade modal renders (s71)
**Then** it shows: current plan → target plan, prorated calculation (day-count credit applied), new monthly/annual price, and a "Confirm upgrade" button
**And** the proration math is visible: "(X days remaining × daily rate of old plan) credited toward new plan"

**Given** a confirmed upgrade
**When** the Owner confirms
**Then** the upgrade is processed via Polar.sh API (ClassLite never handles raw payment data)
**And** the subscription is updated immediately
**And** new plan limits take effect immediately
**And** the prorated amount is shown on the next invoice

**Given** a downgrade request
**When** the Owner selects a lower tier
**Then** a confirmation modal explains: "Downgrade takes effect at next renewal on [date]"
**And** data is NOT removed — but access is restricted when new tier limits are exceeded at renewal
**And** the current plan remains active until the billing period ends

**Given** the AI credit add-on feature (FR-64)
**When** an Owner on Pro or Studio clicks "Buy more credits"
**Then** available add-on credit packs are displayed with pricing (one-time purchase)
**And** the purchase is processed via Polar.sh
**And** add-on credits are consumed AFTER the monthly allocation is exhausted
**And** add-on credits do not expire at month end — they carry forward

**Given** a Free tier center attempting to purchase AI credits
**When** they navigate to the add-on section
**Then** the option is not available — add-ons are Pro and Studio only
**And** an upgrade prompt is shown instead

**Given** the Polar.sh integration
**When** billing operations are performed
**Then** all payment operations proxy through `billing_handler` → `billing_service` — the frontend never calls Polar directly
**And** Polar webhook events are received at a dedicated endpoint to sync subscription state

---

## Story 9.3: Payment Failure, Grace Period & Invoices

| Field        | Value              |
| ------------ | ------------------ |
| Size         | L                  |
| Audience     | Full-stack         |
| Dependencies | 9.2                |

**As an** owner, **I want** clear handling of payment failures with a grace period and access to invoices, **so that** I have time to resolve billing issues and can manage my financial records.

### Acceptance Criteria

**Given** a payment failure on renewal
**When** the charge is declined
**Then** a 7-day grace period begins
**And** the system auto-retries the charge on day 3 and day 5
**And** warning emails are sent on days 0, 3, 5, and 6

**Given** the grace period
**When** any page loads during the 7-day window
**Then** a red top strip appears on EVERY page with a link to payment settings (s73)

**Given** day 7 (23:59) of the grace period
**When** payment has not been recovered
**Then** the center is auto-downgraded to the Free tier
**And** nothing is deleted — AI grading pauses, second teacher seat locks, classes over 5 students become read-only
**And** recovery path: update payment method and retry charge → plan is restored

**Given** an Owner navigating to `/settings/billing/invoices` (s70)
**When** the invoice history renders
**Then** a table shows all invoices with columns: date, amount, status, actions
**And** invoice statuses include: Paid, Declined, Declined → Paid, Refunded, Upcoming, Free
**And** actions per invoice: Download PDF, Retry (for declined)
**And** tax (e.g., 10% VAT for Vietnam) is itemized on each invoice

**Given** the invoice export features
**When** the Owner uses export options
**Then** CSV export downloads all invoices as a spreadsheet
**And** "Email all to accountant" sends the full invoice history to a specified email address

**Given** the payment failure API
**When** a Polar.sh webhook fires `payment_failed`
**Then** the subscription status is updated to `past_due`
**And** the grace period start date is recorded
**And** retry schedule is queued (day 3, day 5)
**And** on day 7 without recovery, the subscription status changes to `cancelled` and plan is set to `free`

**Given** a Polar.sh webhook delivery fails
**When** the webhook is retried
**Then** the endpoint is idempotent (processing the same event twice produces the same result, no double charges or double downgrades)

**Given** the auto-downgrade triggers on day 7
**When** the center has more data than Free tier allows
**Then** NO data is deleted — AI credits pause, extra teacher seats lock, classes over 5 students become read-only, storage uploads blocked but existing files remain accessible

---

## Story 9.4: User Profile Management

| Field        | Value              |
| ------------ | ------------------ |
| Size         | M                  |
| Audience     | Full-stack         |
| Dependencies | 1.5                |

**As a** user, **I want** to manage my profile settings, **so that** I can update my personal information, avatar, password, and preferences.

### Acceptance Criteria

**Given** any user navigating to `/profile` (s38)
**When** the profile page renders
**Then** editable fields are shown: full name, avatar (upload/change), email (display, change requires verification), password (change with current password confirmation), language preference (Vietnamese/English toggle), and notification settings

**Given** a language preference change
**When** the user switches from Vietnamese to English (or vice versa)
**Then** the entire UI re-renders immediately in the selected language
**And** the preference is stored on the user record and persisted across sessions
**And** the preference applies to the language cookie shared across domains

**Given** a password change
**When** the user submits their current password and a new password
**Then** the current password is verified
**And** the new password is hashed and stored
**And** all other sessions (refresh tokens) are NOT invalidated (unlike password reset)

**Given** an avatar upload
**When** the user selects an image
**Then** the image is uploaded to R2 via presigned URL (following `{center_id}/avatars/{uuid}.{ext}` convention)
**And** the avatar URL is updated on the user record
**And** the sidebar user pill updates to show the new avatar

**Given** the profile page rendering context
**When** displayed
**Then** the profile screen renders within the user's current role shell (sidebar matches their role)
**And** the page is accessible to all roles (Teacher, Student, Admin, Owner)

**Given** the profile API
**When** PUT `/api/users/me` is called
**Then** the request accepts: `{ "fullName", "avatarUrl", "languagePref", "notificationSettings" }`
**And** email changes require a separate verification flow (not in MVP scope — display only)
**And** password changes go through POST `/api/users/me/change-password` with `{ "currentPassword", "newPassword" }`

---
---

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
**And** notification creation is triggered by domain events: grade released, question asked, enrollment changed, assignment created, schedule changed, payment failed

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
