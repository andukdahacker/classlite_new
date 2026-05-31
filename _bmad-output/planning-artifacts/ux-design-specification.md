---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
status: 'in-progress'
scope: 'full-product'
redoneAt: '2026-05-31'
supersedes: 'landing+auth-only specification (2026-05-28)'
inputDocuments:
  - '_bmad-output/planning-artifacts/prds/prd-classlite_new-2026-05-26/prd.md'
  - '_bmad-output/planning-artifacts/architecture.md'
  - '_bmad-output/planning-artifacts/epics/index.md'
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
workflowType: 'ux-design'
project_name: 'classlite_new'
user_name: 'Ducdo'
date: '2026-05-31'
---

# UX Design Specification — ClassLite v2 (Full Product)

**Author:** Ducdo
**Date:** 2026-05-31 (redone from full-product scope; supersedes the 2026-05-28 landing+auth-only specification)

---

## 1. Scope & Purpose

This specification defines the UX design directions for the **entire ClassLite v2 product** — every role, every surface, from the public landing page through authentication and across the full authenticated application.

It supersedes the earlier specification, which deliberately covered only the two pre-auth gaps (landing page + auth flows) because the authenticated product was already drawn as a 93-screen mockup set. This redo elevates that work into a single, product-wide design contract: the landing + auth material is preserved and integrated as one part of a larger whole (§10), and the authenticated experience — onboarding, dashboards, classes, scheduling, exercise authoring, AI-assisted grading, the student experience, people management, analytics, knowledge hub, inbox, and billing — is now specified at the same altitude.

**What this document is.** A design-directions contract. It captures the *patterns, principles, and visual/behavioral decisions* that every screen inherits, traced to the requirements (FR-1–FR-81, UX-DR1–UX-DR25) and to the screen IDs (`s00`–`s87`, `LP-01`, `AUTH-01`–`AUTH-08`) where they are realized.

**What this document is not.** It is not a screen-by-screen redraw. The screen-level reference of record remains:
- **`docs/classlite-entry/classlite-ia.md`** — the full 93-screen inventory, routes, role model, and visibility matrix.
- **`docs/classlite-entry/*.html`** — the 13 mockup showcases that encode the realized visual language.
- **`_bmad-output/planning-artifacts/ux-design-directions.html`** — the 9-screen landing + auth showcase.

**Source of truth on conflict.** The existing mockup set and token system are honored as the established visual identity. Where this spec and a mockup disagree on a *principle*, this spec wins; where they disagree on a *screen detail*, the mockup wins and this spec is updated to match. The token file (`tokens.css`, §5) is the single source of truth for all visual values across both codebases.

---

## 2. Executive Summary

### 2.1 Project Vision

ClassLite v2 is a purpose-built SaaS for IELTS tutoring centers and freelance teachers in Vietnam, replacing the patchwork of WhatsApp/Zalo groups, Google Sheets, and paper gradebooks. The core differentiator is **AI-assisted grading** — cutting Writing essay marking from ~12 minutes to ~3 minutes while keeping the teacher fully in control of every score and comment.

The product is a single role-gated application serving four roles (Owner, Admin, Teacher, Student) across one center (no branch switcher, no multi-workspace top bar). Two public/edge surfaces front it: a static **landing page** (`classlite.app`, Astro) and the **auth flows** (`my.classlite.app`, React SPA). The authenticated dashboard (`my.classlite.app`) is also React. All three are visually indistinguishable via a shared design-token system.

### 2.2 Target Users

| User | Context | Primary surface | Design priority |
|---|---|---|---|
| **Center Owner** (Founder persona) | Owns + teaches; 2–15 teachers, 50–300 students. Former teacher turned operator. | Desktop. Center-pulse dashboard, people, billing. | Trust + operational visibility |
| **Operator/Admin** (Operator persona) | Runs the center, does not teach. | Desktop. Same surfaces as Owner minus billing + role-editing. | Efficiency, oversight without micromanagement |
| **Freelance Teacher** (Solo persona) | 1–5 classes, no center overhead. Lives in Google Workspace. | Desktop for authoring/grading; mobile for triage. | Speed, the grading differentiator |
| **Student** (age 16–30) | Highest volume, lowest revenue. Enters via invite link. | Mobile-first. | Zero-friction, clarity, encouragement |

Persona → role mapping (onboarding only): **Operator → Admin**, **Founder → Owner**, **Solo teacher → Teacher** (single-user workspace). Onboarding uses persona labels (how users identify); the rest of the product uses role labels (permissions).

### 2.3 Key Design Challenges (full product)

1. **Trust construction over a skeptical, largely-undigitized market.** Competitors are WhatsApp groups and shared spreadsheets, not other SaaS. Every surface must read as steady, local, and credible — Vietnamese-first, IELTS terms in English, pricing in VND, understated rather than hype-driven.
2. **Teacher-in-control AI.** The differentiator is AI grading, but the design must never let AI feel like it's grading *for* the teacher. Every AI output is a labeled, confidence-rated, dismissible suggestion the teacher accepts, edits, or rejects. This pattern must be unmistakable and identical everywhere AI appears (authoring, Writing/Speaking grading, analytics recommendations).
3. **One product, four roles, strict isolation.** A single app shell renders four navigation spines and role-scoped data. Role-gating must be visible-but-graceful (dimming + tag, not silent removal where context helps), and absolutely safe (a student must never see another student's data, a teacher must never see center-wide billing).
4. **Density without overwhelm.** Owners and teachers work in data-dense tables, heatmaps, and queues; students need calm, one-thing-at-a-time clarity. The same token system must serve both registers.
5. **Calm recovery as a product value.** Empty states teach the IA; error/penalty/lock/denial states show their math, preserve the user's work, and route the next step through a human (teacher/owner inbox). No dead ends, no blame.
6. **Honest mobile.** The product ships only the surfaces a phone genuinely fits (student consumption, teacher triage, owner approvals) and labels the rest as deliberately desktop-only — it does not fake parity.
7. **Pre-auth → auth → product continuity.** A user crossing `classlite.app` → `my.classlite.app` → dashboard must not perceive a seam: same paper background, dot grid, Fraunces headings, button styles, and language state. (Detailed in §10.)

### 2.4 Design Opportunities

1. **Google OAuth as the universal happy path and escape hatch** — Gmail dominates in Vietnam; "Continue with Google" is the visually primary action on every auth screen and the fallback offered at every point of friction.
2. **Invite acceptance as the highest-value conversion node** — each accepted invite is a switching-cost multiplier; the invite screen foregrounds the *center's* identity, not ClassLite's.
3. **Value before configuration** — the first post-auth action is experiencing AI grading on a pre-loaded sample, not setting up a center.
4. **The grading queue as a flow state** — Prev/Next navigation, keyboard shortcuts, and AI pre-fill turn a chore into a fast, satisfying loop (UX-DR23).
5. **Reuse loops everywhere** — save-as-template, archive duplicate / edit-a-copy, and recurrence scoping let centers compound their setup work.

---

## 3. Product Experience Pillars

These nine through-lines govern every surface. They consolidate the experience principles, emotional design principles, and flow-optimization principles into one canonical set.

1. **Value before configuration.** Get the user to "I just saved time" (the first AI grade) before asking them to build anything. Owners see a pre-graded sample *dashboard*; teachers grade a sample essay. Configuration follows proof. *(FR-5, UX-DR21)*

2. **Trust before conversion.** Credibility is earned before any ask. Pain quantified, pricing visible in VND, social proof local and specific, free tier honest. Understatement signals reliability; calm converts better than urgency in this market.

3. **Teacher-in-control AI.** AI is pervasive but always subordinate. It is visually marked (gradient "AI" chip), confidence-rated (to teachers, never students), previewed before insert, and accepted/edited/dismissed per item — never auto-committed. It draws only on existing content and never overrides the teacher's final decision. *(FR-24–26, FR-34, FR-36, UX-DR22)*

4. **Route by intent, don't funnel.** Owner researching, teacher accepting an invite, student joining a class are three journeys with three shortest paths. Post-auth onboarding branches by persona; the app branches by role.

5. **Google first, email second.** Google OAuth is the dominant action on every auth screen; email/password is always available as the alternative; verification gates only email users.

6. **Anchored feedback is the communication spine.** There is no messaging product. Teacher↔student communication happens only through anchored comments on submitted work (highlight → pin → typed comment: Error/Praise/Suggestion) and anchored Q&A (highlight → ask, item-scoped or whole-exercise). The same Docs-style sticky-rail mechanic serves both. *(FR-33, FR-38–40)*

7. **Calm, blame-free recovery.** Empty ≠ broken (empties teach the IA); error ≠ blame (errors show their math, preserve work, name the rule and the human who can help). Every failure state has one clear next action. *(FR-69, FR-70, UX-DR16)*

8. **Honest, purpose-built responsiveness.** Mobile screens are designed for the thumb and the moment (consumption, triage, approval), not squished desktops. Surfaces that don't fit a phone say so. *(FR-74, UX-DR15)*

9. **One brand, two codebases, shared tokens.** Astro landing and React app are visually identical via a committed `tokens.css` and a no-raw-hex lint rule; visual regression tests catch drift. *(UX-DR1, NFR-1)*

---

## 4. Information Architecture & Navigation

### 4.1 Role Model

| Role | Ladder | Navigation spine (sidebar) | Bottom pill |
|---|---|---|---|
| **Owner** | top | Dashboard · People · Classes · Schedule · Analytics · Inbox · Knowledge hub · Archive · Settings | "Owner" |
| **Admin** | mid | Same as Owner, minus Owner-only affordances (no Owner-role invite on `s41`, no Roles & permissions `s44`, no Billing) | "Admin" |
| **Teacher** | bottom | Dashboard · Classes · Schedule · Exercises · Questions · Students · Analytics · Inbox · Knowledge hub · Archive | "Teacher" |
| **Student** | consumer (off-ladder) | Dashboard · My classes · Assignments · My schedule · Questions · My performance · Inbox | "Student" |

**Ladder:** Teacher < Admin < Owner (fixed). Student is a separate consumer role outside the ladder. **Scope:** center-wide only — no branch switcher, no workspace switcher; one app for all roles, role-gated.

### 4.2 App Shell

| Element | Position | Notes |
|---|---|---|
| **Sidebar — brand** | top-left | "ClassLite" wordmark (Fraunces, italic) with amber dot accent. Dark navy sidebar (`--cl-sidebar-bg` `#1a1f2e`), white active state. |
| **Sidebar — workspace nav** | left | Role-specific (see §4.1). Grouped: Workspace / Resources (Knowledge hub, Archive) / Settings (Owner only). |
| **Sidebar — Inbox item** | left | Carries an unread badge (`--cl-accent-2`). |
| **Sidebar — user pill** | bottom-left | 28px avatar (gradient) + name + role label. |
| **Topbar — breadcrumbs** | top-left | Workspace / section / *current*. |
| **Topbar — search** | top-right | "Search" with ⌘K shortcut → global search across classes, students, exercises, assignments, Knowledge hub (FR-67). 56px topbar height. |
| **Topbar — primary CTA** | top-right | Section-dependent: "+ New class", "+ New assignment", "Invite staff", "Use in exercise", etc. |

Background carries the subtle dot-grid pattern throughout. Page content max-width `1320px`; common right-rail detail panels at `300–320px`.

### 4.3 Navigation & Routing Principles

- **Role-level protection at the router.** A student cannot navigate to `/billing` or `/settings`; a teacher deep-linking to Center settings hits a *permission-denied orientation screen* (`s67`), not a blank 403 (§6.4).
- **Role-specific dashboards are separate components** (`OwnerDashboard` `s48` / `TeacherDashboard` `s06` / `StudentDashboard` `s29`), never one mega-component with role branches *(UX-3 in project rules)*.
- **Role-gating is shown, not silently removed, where context aids understanding.** Owner-only analytics cards render dimmed with an "ADMIN/OWNER" tag on shared screens (`s45`); the permission matrix (`s44`) shows the full ladder with locked rows. Hard data isolation (other students' results, billing) is absent from the DOM entirely.
- **Tabbed shells over screen sprawl.** Class detail (`s08`/`s09`), staff detail (`s40`), student performance (`s47`), billing (`s69`), and settings (`s49`) use a single shell with tab-switched content — same head + stat strip, swapped body.
- **One screen, role-scoped data.** Several screens serve multiple roles with scoped data: analytics (`s45`–`s47`), student detail (`s10` reused by teacher's `s10a` and owner's `s42`), inbox (`s50`–`s52`).

### 4.4 Screen Inventory (full product)

| Chapter | Screens | Range | Primary role |
|---|---|---|---|
| Landing + Auth | 9 | `LP-01`, `AUTH-01–08` | Public / all |
| 1 — Onboarding (persona-forked) | 10 | `s00–s09` | All |
| 2a — Teacher: dashboard, classes, students | 6 | `s06–s10`, `s10a` | Teacher |
| 2b — Teacher: time & schedule | 4 | `s11–s14` | Teacher |
| 2c — Teacher: content & grading | 11 | `s15–s25` | Teacher |
| 2d — Teacher: resources | 3 | `s26–s28` | Teacher |
| 3 — Student | 10 | `s29–s38` | Student |
| 4 — Admin & Owner | 6 | `s39–s44` | Admin/Owner |
| 5 — Across roles | 5 | `s45–s49` | All (scoped) |
| 6a — Inbox | 3 | `s50–s52` | All |
| 6b — Empty states | 10 | `s53–s62` | All |
| 6c — Error states | 5 | `s63–s67` | All |
| 7 — Billing & limits | 6 | `s68–s73` | Owner |
| 8 — Mobile | 14 | `s74–s87` | All |
| **Total** | **102** | | |

The per-role visibility matrix (which screen each role sees, and whether data is full/scoped/hidden) is maintained verbatim in `classlite-ia.md` and is the authority for access design; §4.3 governs how that access is *expressed* in the UI.

---

## 5. Design System Foundation

### 5.1 Design System Choice

**Tailwind CSS + shadcn/ui**, themed to ClassLite's established design language — a warm, paper-toned aesthetic with serif display typography and a navy/amber accent system. This is not a generic SaaS look; it is preserved exactly across all surfaces.

- **Dashboard + auth (`my.classlite.app`):** shadcn/ui components (Radix primitives → WCAG 2.1 AA focus/keyboard/ARIA) themed with ClassLite tokens.
- **Landing (`classlite.app`):** Astro components, hand-built, visually identical, consuming the same tokens.
- **Shared tokens (`tokens.css`):** CSS custom properties — the single source of truth, committed to both `classlite-web/src/` and `classlite-landing/src/styles/`. A lint rule forbids raw hex (all colors reference `var(--cl-*)`); visual regression tests catch drift. *(UX-DR1)*

### 5.2 Design Tokens (`tokens.css`) — extracted from the 93-screen mockup set

```css
:root {
  /* Surfaces */
  --cl-paper:          #f5f1ea;   /* Primary background (warm off-white) */
  --cl-paper-2:        #efe9df;   /* Secondary background / alternating sections */
  --cl-surface:        #ffffff;   /* Card/panel background */
  --cl-surface-warm:   #fcfaf6;   /* Side panels, modal footers, Q&A rails */
  --cl-surface-compose:#fdf9ef;   /* Compose/editor bg */

  /* Text */
  --cl-ink:            #1a1f2e;   /* Primary text / dark UI / primary button */
  --cl-ink-soft:       #2c3242;   /* Secondary text */
  --cl-muted:          #595c66;   /* Tertiary text / labels / placeholders (a11y-darkened, see 5.5) */

  /* Accents */
  --cl-accent:         #1e3a8a;   /* Primary accent (deep blue) — links, focus, button hover */
  --cl-accent-2:       #d97706;   /* Secondary accent (amber/gold) — DECORATIVE use only */
  --cl-accent-2-text:  #7c4309;   /* Text-safe amber (5.0:1 on white) */
  --cl-accent-2-btn:   #92500a;   /* Button-safe amber (white text 4.6:1) */

  /* Borders */
  --cl-line:             #d9d2c4;   /* Border / divider (warm gray) */
  --cl-line-soft:        #e6e1d5;   /* Subtle border */
  --cl-line-interactive: #a8a095;   /* Interactive-control borders (3.0:1, WCAG 1.4.11) */

  /* Status (foreground) */
  --cl-green:          #166534;   /* Success / active / granted / on-time / improvement */
  --cl-red:            #991b1b;   /* Error / danger / blocked / at-risk / hard limit */
  --cl-amber:          #b45309;   /* Warning / late / nearing-limit / needs-attention */

  /* Status tints (backgrounds) */
  --cl-tint-blue:      #eef0fb;   /* Accent / upcoming / info */
  --cl-tint-gold:      #fdf6e3;   /* Writing / amber / editable-row / warning */
  --cl-tint-green:     #ecf4ec;   /* Reading / success / active / on-time */
  --cl-tint-red:       #fbeaea;   /* Speaking / error / ended / blocked */

  /* Chip */
  --cl-chip-bg:        #ebe5d6;

  /* Typography */
  --cl-font-display:   'Fraunces', 'Times New Roman', serif;
  --cl-font-body:      'Geist', system-ui, sans-serif;
  --cl-font-mono:      'Geist Mono', monospace;

  /* Radius */
  --cl-radius-xs:   4px;   --cl-radius-sm:  6px;   --cl-radius-md:  8px;
  --cl-radius-lg:   10px;  --cl-radius-xl:  12px;  --cl-radius-2xl: 14px;
  --cl-radius-full: 999px;

  /* Shadows */
  --cl-shadow-subtle:  0 1px 3px rgba(0,0,0,0.06);
  --cl-shadow-card:    0 8px 24px -12px rgba(26,31,46,0.08);
  --cl-shadow-dropdown:0 6px 20px -6px rgba(26,31,46,0.4);
  --cl-shadow-modal:   0 30px 60px -20px rgba(26,31,46,0.5);
  --cl-shadow-amber:   0 4px 14px -6px rgba(217,119,6,0.4);

  /* Scrim */
  --cl-scrim:          rgba(26,31,46,0.32);

  /* Sidebar */
  --cl-sidebar-bg:        #1a1f2e;  --cl-sidebar-text:   #cfd1d8;
  --cl-sidebar-hover:     #252a39;  --cl-sidebar-active-bg: #ffffff;
  --cl-sidebar-active-text: #1a1f2e; --cl-sidebar-width:  220px;

  /* Layout */
  --cl-topbar-height:  56px;   --cl-page-max-width: 1320px;
  --cl-modal-width:    460px;  --cl-side-panel:     300px;  --cl-detail-panel: 320px;
}
```

**Dot-grid background pattern:** `radial-gradient(circle at 1px 1px, rgba(26,31,46,0.04) 1px, transparent 0)`, size `24px 24px` — body, onboarding shell, landing, auth.

### 5.3 Typography Scale

| Role | Font | Size | Weight | Tracking |
|---|---|---|---|---|
| Hero h1 | Fraunces | 44px | 400 | -0.02em |
| Page h1 | Fraunces | 36px | 400 | -0.02em |
| Section h2 | Fraunces | 28px | 400 | -0.01em |
| Section h3 | Fraunces | 18px | 500 | -0.005em |
| Modal title | Fraunces | 19px | 400 | -0.02em |
| **Overall band (display)** | Fraunces | 32px | 400 | -0.02em |
| Body | Geist | 15px | 400 | 0 |
| Body small | Geist | 13px | 400 | 0 |
| Buttons | Geist | 12.5px | 500 | 0 |
| **Stat/score number** | Geist Mono | 28px | 500 | 0 |
| Labels / table headers | Geist Mono | 10px | 500 | 0.14em |
| Nav group | Geist Mono | 9.5px | 500 | 0.18em |
| Eyebrow | Geist Mono | 11px | 500 | 0.14em |

Convention: **Fraunces** for display headings and the single oversized overall-band number; **Geist** for all body and UI; **Geist Mono** for labels, counts, timestamps, per-criterion scores, and prices. Vietnamese subset loaded for Fraunces + Geist; IELTS terms wrapped `<span lang="en">`.

### 5.4 Core Component Specs

| Component | Spec |
|---|---|
| **Button (default)** | bg `#fff`, `1px solid var(--cl-line)`, radius `6px`, padding `7px 14px`, Geist 12.5px/500 |
| **Button (primary)** | bg `--cl-ink`, color `#fff`, hover bg `--cl-accent` |
| **Button (AI / `btn-ai`)** | gradient/amber-marked, paired with the "AI" chip — visually distinct from teacher actions (§6.2) |
| **Input** | `1px solid var(--cl-line)`, radius `6px`, padding `9px 11px`, Geist 13px; focus `2px --cl-accent` |
| **Card** | bg `#fff`, `1px solid var(--cl-line-soft)`, radius `10px` |
| **Modal** | width `460px` (520–640px for dense modals), radius `14px`, `--cl-shadow-modal`, scrim `--cl-scrim`, footer bg `#fcfaf6` |
| **Status pill** | radius `999px`, padding `4px 10px`, 11.5px/500; semantic tint + foreground (§5.6) |
| **Band pill** | bold accent numeral + label; red when flagged/weakest |
| **Badge (nav/role)** | bg `--cl-accent-2-btn`, white text, 10px/600, radius `999px` |
| **Table header** | Geist Mono 10px/500, 0.14em tracking, padding `14px 16px` |
| **Avatar** | 28px circle, gradient `135deg --cl-accent → --cl-accent-2` |
| **Load bar** | mini track + value (e.g. "7/10"); fill turns `--cl-amber` past threshold |
| **Usage meter (`um-bar`)** | progress track per constrained resource; `.warn` amber state past threshold |
| **Switch** | track 34×19px, knob 15px, on `--cl-accent` |
| **Progress bar** | height 6px, track `--cl-line-soft`, fill `--cl-accent`, radius `999px` |

### 5.5 Color Accessibility Audit (WCAG 2.1 AA)

Verified against the mockup tokens. **Passing** (representative): `--cl-ink` on `--cl-paper` 14.6:1; `--cl-ink` on `--cl-surface` 16.4:1; `--cl-accent` on `--cl-paper` 9.2:1; `--cl-green` on `--cl-tint-green` 6.4:1; `--cl-red` on `--cl-tint-red` 7.2:1; `#fff` on `--cl-ink` 16.4:1; `--cl-sidebar-text` on `--cl-sidebar-bg` 10.8:1.

**Failures fixed in the token file (already reflected in 5.2):**

| Issue | Fix |
|---|---|
| `--cl-muted` `#6b6f7a` on paper 4.5:1 (borderline) / on paper-2 4.2:1 (fail) | Darkened to **`#595c66`** → 5.1:1 / 5.7:1 |
| `--cl-accent-2` `#d97706` as text 2.8–3.2:1 (fail) | Amber restricted to **decorative**; `--cl-accent-2-text` `#7c4309` (5.0:1) for text; `--cl-accent-2-btn` `#92500a` (white 4.6:1) for buttons/badges |
| Interactive borders on paper 1.3:1 | `--cl-line-interactive` `#a8a095` (3.0:1) for input/control boundaries (WCAG 1.4.11) |

**Hard rule:** `--cl-accent-2` (`#d97706`) is never foreground text on light backgrounds. Use `--cl-accent-2-text`, or `--cl-ink` on an amber background.

### 5.6 Status & Semantic Color System

A single, product-wide semantic mapping — applied identically across tables, pills, charts, banners, meters, and timelines:

| Semantic | Foreground / Tint | Meaning |
|---|---|---|
| **Green** | `--cl-green` / `--cl-tint-green` | success · active · granted · on-time · improvement · Reading |
| **Amber** | `--cl-amber` / `--cl-tint-gold` | warning · late · nearing-limit · needs-attention · editable · Writing |
| **Red** | `--cl-red` / `--cl-tint-red` | error · blocked · hard limit · at-risk · ended · Speaking |
| **Blue** | `--cl-accent` / `--cl-tint-blue` | info · upcoming · primary action · Listening/accent |
| **Neutral** | `--cl-ink-soft` / `--cl-muted` | stable · informational · de-emphasized |

**Severity escalation (limits & failures):** amber = proactive/soft warning (non-blocking banner) → red = hard block/failure (top strip). Demonstrated by `s72` (amber soft-limit banner) vs `s73` (red grace-period strip).

**Feedback exception (UX-DR22):** in *student-facing* performance and grading contexts, **decline is never rendered red**. Regression uses neutral framing ("Your band changed from 6.5 to 6.0") in `--cl-muted`; improvement uses `--cl-accent`; stable uses `--cl-ink-soft`. Red is reserved for teacher-side error pins and weakest-skill emphasis, not for telling a student they did worse. (See §6.1.)

**Color is never the sole signal** (WCAG 1.4.1): error = red tint + icon + text; success = green tint + checkmark + text; chart/heatmap cells pair color with value labels.

---

## 6. Cross-Cutting Design Language

These patterns recur across many screens. Specifying them once here prevents drift; each role section (§8) references them rather than re-describing them.

### 6.1 Feedback & Score Design Language *(UX-DR22)*

How scores, criteria, progress, and regression appear everywhere they appear — submission results (`s35`), grading (`s23`–`s25`), analytics (`s46`–`s47`), dashboards, and My Performance (`s37`).

- **Band scores** are presented as a **per-criterion grid of Geist Mono numerals** (14px per-criterion) collapsing to a **single oversized overall band** (Fraunces 32px display, or a circular `band-ring` on the student result `s35`). The four IELTS criteria are skill-specific (Writing: Task response / Coherence & cohesion / Lexical resource / Grammar; Speaking: Fluency / Lexical / Grammar / Pronunciation).
- **Criteria can be evidenced by pinned comments.** A criterion in the scoring grid annotates its pinned-comment count ("Lexical · 1 pinned", accent-bordered; red-bordered for error pins) — tying the score to the evidence in the essay (§6.3).
- **Per-skill breakdown** uses horizontal bars, strongest highlighted green, weakest named as a "focus area."
- **Progress over time** uses spark/bar charts: improvement `--cl-accent`, stable `--cl-ink-soft`, **decline `--cl-muted` (never red)** in student-facing contexts.
- **Neutral framing for regression.** "Your band changed from 6.5 to 6.0," never "You scored worse." Weaknesses are reframed as named focus areas paired with a concrete fix.
- **AI confidence is shown to teachers, hidden from students.** Teachers see High/Medium confidence labels on AI proposals; students never see a confidence rating on their own feedback.
- **Trajectory framing.** Bands are framed toward a target ("Band 6.0 · on track to reach 6.5 by week 14"), not as a static verdict.

### 6.2 AI Assistance Pattern *(FR-24–26, FR-34, FR-36, UX-DR21, UX-DR22)*

The single most important consistency contract in the product. AI appears in authoring (`s16`/`s17`), Writing grading (`s23`), Speaking grading (`s24`), and analytics recommendations (`s46`/`s47`) — and looks and behaves identically in all of them.

- **Always labeled.** A gradient **"AI" chip / `ai-mark`** marks every AI element; AI suggestion cards use a distinct style (gradient avatar, `q-card.ai`, `ai-rail-strip`) clearly separated from teacher input (dark avatar, "You").
- **Preview before commit.** *Generation* (exercises) produces a preview the teacher must explicitly **Insert** — Regenerate / Cancel / Insert. Nothing auto-commits to the document.
- **Accept / Edit / Dismiss per item.** *Grading* proposals (band scores, inline comments, flagged moments) each carry Accept / Edit-before-applying / Dismiss. Batch affordances exist ("Accept all praise") but never auto-apply on load.
- **Confidence labels** on teacher-facing proposals (High/Medium).
- **Explicit disclaimers** at every AI surface: "You decide each one," "Suggestion · teacher always decides the final band," "AI suggestions are starting points — you have full control."
- **Draws only on existing content.** AI recommendations link existing exercises/Knowledge-hub materials; AI never invents new student-facing content. **Teacher advice overrides AI** where both appear (`s47` Recommendations are tagged by source: AI vs "From [teacher]").
- **Cost is visible.** A credit budget shows on generation dialogs ("3 of 50 monthly AI credits used"; "est. cost 1 credit"); AI runs are async (HTTP 202 → poll), never blocking — see §9.
- **First-run AI grade** (`s53`/onboarding → `s23`): a pre-loaded sample essay, one CTA ("Run AI grading"), animated progress (~15–30s, "AI đang phân tích bài viết…"), results appear with a subtle transition — **no celebratory modal**. Quiet competence. *(UX-DR21)*
- **AI degraded/slow:** "AI grading is temporarily slow — your essay is queued," never a broken result.

### 6.3 Anchored Comments & Anchored Q&A *(FR-33, FR-35, FR-38–40)*

The product has **no chat/messaging surface**. All teacher↔student communication is anchored to work, via one shared Docs-style mechanic.

- **Mechanic:** select a span/item → a numbered **pin** appears in the text → a **card** appears in a sticky side **rail**; clicking a pin focuses its card (amber border + connector line to the anchor).
- **Anchor scope color:** orange pin = item/span-level; blue pin = whole-exercise/whole-essay.
- **Comment taxonomy (grading, `s23`):** Error (red, `!`), Praise (green, `★`), Suggestion (amber, `✎`). Comments can be **pinned to a band criterion** to justify the score.
- **Q&A taxonomy (`s18` teacher / `s36` student):** student highlights an item or chooses "Whole exercise," composes, "Send to teacher"; teacher answers in-thread, can **batch-handle similar questions**, and **resolve**. Answers carry a **visibility label** ("Shared with your class" vs private). Unanswered questions surface as Inbox action items (FR-40).
- **Rail behavior:** header with count + filter ("Unanswered ▾"), cross-exercise link ("↗ 7 across all exercises"), per-card reply box. On **mobile**, the rail becomes a **chat-bubble thread** (`s80`/`s85`) and result comments expand **inline under the line** rather than in a side rail (`s79`).
- **Reciprocity:** what the teacher writes as anchored comments on a submission is exactly what the student reads on their result (`s35`) and is previewed in the student's Inbox "Graded" row.

### 6.4 State Patterns: Loading · Empty · Error

Every data-fetching view implements all three states — no exceptions *(UX-1, UX-DR24)*.

**Loading (UX-DR24).** Skeletons that mirror the final layout, never a centered spinner — a list gets list-shaped skeletons, a chart gets a chart-dimensioned rectangle, a table gets row skeletons. Skeleton uses `--cl-line-soft` with a subtle pulse; content fades in over 150ms (respects `prefers-reduced-motion`). A load error shows an **inline retry**, not a full-page error.

**Empty (FR-69, `s53`–`s62`).** Empty ≠ broken — empties teach the IA. Canonical structure: (1) circular ghosted icon echoing the section's nav glyph; (2) Fraunces headline with one italic-accent word ("No classes *yet*"); (3) one-line muted explanation of what the surface is *for*; (4) **usually a single primary action** (`es-actions`); an optional dashed `es-help` "→" list for multi-path onboarding. Variants:
- **Guided first-run** replaces the bare component: teacher day-one (`s53`) is a 3-step starter with done/active/disabled progress disclosure; student first-login (`s62`) is a forward-looking next-session hero + checklist.
- **Ghosted-frame** for data surfaces (`s57` My Performance, `s61` Analytics): render the real chart frames at ~0.5 opacity with em-dash placeholders and a labeled amber threshold banner ("Analytics needs at least 3 graded submissions to show patterns").
- **Role tone** (clearest in `s56`, three inboxes side-by-side): Student = encouragement ("Nothing *new yet*"); Teacher = activation ("When students start working… things land here"); Owner = reassurance ("All *caught up* · the center is humming along").

**Error (FR-70, `s63`–`s67`).** Three-part recovery, blame-free *(UX-DR16)*: (1) **honest diagnosis** — a colored banner naming exactly what happened (amber `warn-banner` for recoverable/penalty; red `err-banner` for hard locks/validation); (2) **transparent context** — the math/timeline/audit-trail so the state never feels arbitrary; (3) **one clear next action** (plus a lower-stakes escape), routed through a human where relevant. Patterns:
- **Penalty** (`s63`): calm amber banner + transparent band math (Final 5.5 ← Raw 6.0 − 0.5) + submission timeline + "Request penalty waiver" (→ teacher's inbox).
- **Lock** (`s64` past-deadline, `s66` finalized): submit affordance removed; read-only strip preserves the user's draft; recovery = request extension / clone-&-edit (safe path offered first, destructive path gated and warned).
- **Validation** (`s65`): top summary banner + inline per-field messages with fix suggestions + primary action disabled until resolved ("Save · 3 errors to fix").
- **Permission denied** (`s67`): reframed as orientation — names what's behind the boundary *and who can grant access* ("Owner + Admin · Message →"), never a bare 403.
- All error copy is in i18n, never hardcoded English, never raw HTTP codes or stack traces.

### 6.5 Structural Patterns

- **List-table pattern** (`s07`, `s10a`, `s15`, `s39`, `s42`, `s70`): page-head with count superscript → filter row (status tabs with mono counts + filter/sort chips) → `table.grid`. First cell = colored letter/skill tile + name + mono meta line. Row hover = paper tint; row click → detail; ended/upcoming rows dimmed (0.7). Status via `perf-pill`; load via mini bar.
- **Tabbed-shell pattern** (`s08`/`s09`, `s40`, `s47`, `s69`, `s49`): shared `detail-head` + stat strip + `tab-strip`, body swapped per tab. Embedded summary content defers to a full destination ("View full Analytics →").
- **Detail + right-rail** (`s08`, `s10`, `s12`, `s35`): main column + 300–320px `detail-side` of info/next-step cards, including a dashed **Actions card** that segregates role-gated/destructive affordances.
- **Compose-row workspace** (`s43` enrolment): search + segmented action toggle (Add/Transfer/Withdraw) + apply, above a "needs attention" list with color-coded left borders, above a chronological audit history with action pills.

### 6.6 Reuse, Templating & Recurrence

A first-class loop that lets centers compound their work:
- **Save-as-template → template index (`s19`) → Create class from template (`s22`)** — class structure (ordered session plans with docs + exercises) is reusable (FR-15).
- **Archive (`s28`) → Duplicate-to-active** (live copy as-is) **vs Edit-a-copy** (open create flow pre-filled) — the two reuse verbs (FR-60).
- **Recurrence scope** on every session mutation: editing or deleting a recurring session always branches "This session only / This and all following / All sessions in the series" (`s12`/`s14`, FR-17).
- **Save-and-resume** on every onboarding step (auto-save indicator + "save and finish later" exit), with skipped steps surfacing as dashboard "Finish setting up" tasks (`s09`, FR-5/FR-6).

---

## 7. Emotional Design

### 7.1 Primary Emotional Goals

| User | Primary emotion | Expression |
|---|---|---|
| **Owner** | Recognition → Relief | "They understand my world" → "Someone finally built this" → operational confidence ("I can see my center without micromanaging") |
| **Admin** | Control without friction | "I can keep things running and see what needs me" |
| **Teacher** | Momentum → Quiet competence | "I'm already moving" → "This actually works, next essay" |
| **Teacher (invited)** | Belonging | "My center is already here, they saved me a spot" |
| **Student** | Simplicity → Encouragement | "I know exactly what to do" → "I can see how to improve" |
| **All (failure states)** | Confident recovery | "This broke, but I can see the next step" |
| **All (first AI grade)** | Quiet competence | "This thing actually works" |

### 7.2 Micro-Emotions

**Cultivate:** *Trust over excitement* (steady, credible, not hype-driven — muted confidence). *Competence over delight* (teachers want to feel fast, not entertained — AI reads as a reliable assistant, not a magic trick). *Belonging over onboarding* (invited users join a community, not start an account). *Calm over urgency* (no countdowns, no "limited time," free tier always available). *Encouragement over judgment* (students see focus areas + praise, never red verdicts).

**Avoid:** *Suspicion* ("too polished to be real" — ground every claim, show pricing, name real archetypes). *Abandonment* ("broken, no one's helping" — every failure names what happened + one next action). *Overwhelm* ("too much to set up" — value before configuration). *Impatience* ("why verify my email?" — "Almost there — check your inbox," not "Verification required").

### 7.3 Emotional Design Principles

1. **Credibility is the emotion.** In a distrustful market, "I believe this will work" is the highest-value state; every choice serves it. Delight is a luxury; trust is the requirement.
2. **Understatement signals reliability.** AI results appear cleanly, pricing is plain, errors are calm. Confident professional, not excited salesperson.
3. **Speed is an emotion.** 10s auth, 30s first grade — the user *feels* the product respects their time.
4. **Belonging before branding.** On invite flows and the first dashboard view, the center's identity leads; ClassLite is the infrastructure.
5. **Recovery is care.** A thoughtful error with a clear next step communicates more empathy than any onboarding animation.

---

## 8. Role Experience Design

Each subsection distills the design directions for one role/area from the realized mockups, citing screen IDs and the cross-cutting patterns (§6) they inherit.

### 8.1 Onboarding (persona-forked, `s00`–`s09`)

A full-bleed shell (no app sidebar — the product doesn't yet know the persona) that forks on the first screen and converges on the dashboard handoff.

- **Persona pick (`s00`).** Three large selectable cards (Operator / Solo / Founder), each with a color-keyed SVG relationship diagram (amber/blue/green) and Fraunces+italic title. One pre-selected; single "Continue →". No step counter (the three flows have different lengths). *(FR-1)*
- **Center setup (`s01`, Operator/Founder).** Single-column `setup-card`; dot step-progress ("Step 2 of 4"); name (required), short code, branches, and a **brand-picker** (auto letter-mark preview + 6-color row + optional logo). Persistent "Auto-saving · last saved Ns ago"; footer names the next step and offers "save and finish later." *(FR-2, FR-6)*
- **Build template (`s02` Operator / `s07` Founder).** Import banner ("from spreadsheet"), a starter grid of suggested IELTS templates (one pre-selected) + a "Build from scratch" card, then an editable template form (band pill, primary skill, sessions, schedule pattern). Skippable. *(FR-3)*
- **Spawn classes (`s03` Operator / `s08` Founder).** Each class is a numbered, removable `class-row`: cohort name, start date, **teacher field with inline-invite**, optional "+ Paste emails" students; "+ Add another class." Founder's first class auto-assigns the founder (★ default); empty rows show "Assign or invite a teacher." *(FR-4)*
- **Solo path (`s05`).** Single class form, **teacher locked to "you"** ("solo workspace"); step "2 of 3"; option to create a template instead. No center-management surface.
- **Done (`s04`/`s06`).** Centered success hero (✓ + Fraunces+italic center name) + a stat strip summarizing what was created + "Open Dashboard →".
- **Dashboard handoff (`s09`).** First real app shell with a pinned **"Finish setting up"** card (eyebrow, italic title, its own progress meter, per-persona deferred tasks; snooze/dismiss, re-openable from Settings). Skipped onboarding steps become these tasks. *(FR-5)*

**Owner first-run value:** before configuration completes, the owner is shown a **pre-graded sample dashboard** — what their center analytics will look like once teachers are active — so they feel the value their team will generate, not just fill out forms (Pillar 1, UX-DR21).

### 8.2 Owner / Admin Experience (`s39`–`s49`)

Drawn from the Owner POV; Admin sees the same minus Owner-only affordances (`s44` permissions, Owner-role invite on `s41`, Billing). The framing throughout is **center pulse and oversight without micromanagement**.

- **Admin/Owner dashboard (`s48`).** "Center pulse," not "my next session." 4-up pulse stats; left column = "Today across the center" (sessions with teacher/room/student-count, "live now" amber) + trend side-cards (avg band spark, attendance, submissions) + operational activity feed (with `.flag` warning variant); right column = **"Needs your attention"** card (amber left-border, icon-coded rows: unassigned, capacity, pending invite, at-risk, heavy-load — each an action link) + staff snapshot + a plain-language "Center health" summary. *(FR-51)*
- **Staff list (`s39`) & detail (`s40`).** List-table: Name / Role pill / Classes / **Load** (mini bar + "7/10", amber when overloaded) / Status (`perf-pill`) / Last active. Owner excluded (managed in Settings); pending invites render dimmed with `??` avatar. Detail = `student-head` + 6-up stat strip + tabs (Overview/Classes/Schedule/Activity), with a dashed **"Owner actions"** card (Assign / Reset password / Archive) segregating role-gated affordances. *(FR-41)*
- **Invite staff modal (`s41`).** Email (+ "recipient sets own password"), optional name, **role as a segmented toggle** (Teacher/Admin; Owner dimmed unless sender is Owner), optional class (teachers only), optional welcome note; footer "Invite expires in 7 days." *(FR-42, FR-11)*
- **Center-wide students (`s42`).** Same table pattern; adds Classes + Teacher(s); tabs All/At-risk/New/Unassigned/Archived; unassigned flagged amber. Row → shared student detail (`s10`). Distinct from the teacher's own-roster `s10a`. *(FR-43)*
- **Enrolment (`s43`).** The compose-row workspace (§6.5): Add/Transfer/Withdraw with effective date + note; "needs attention" list with color-coded borders (amber unassigned / red capacity); chronological audit history with action pills. All actions logged + notify; Admin/Owner only. *(FR-46, NFR-6)*
- **Roles & permissions (`s44`, Owner-only).** Three role summary cards (Owner card amber-tinted "YOU") above a **capability × role matrix** grouped by area; cells = granted ✓ / blank / **locked 🔒** (fixed ladder); **editable rows amber-highlighted** with an "editable" tag (only the two toggleable capabilities: see-teacher-analytics, publish-to-Knowledge-hub). Read-only elsewhere. *(FR-9, FR-10)*
- **Center settings (`s49`, Owner-only).** Single tabbed screen (Profile / Term calendar / Integrations / Rooms) — rarely accessed, so consolidated. Profile re-edits onboarding `s01`; includes Google Meet connect (FR-8) and a "re-open setup" link. *(FR-7)*
- **Analytics (`s45`–`s47`)** are shared and covered in §8.7.

### 8.3 Teacher Experience (`s06`–`s28`, `s10a`)

The teacher is the product's center of gravity. The experience is **launchpad → work queues → flow-state grading**, with authoring and grading as the differentiating surfaces (grading detailed in §9).

- **Dashboard (`s06`).** Two zones: a read-only **week-strip** (7 day columns, colored mini-events, next session inverted with amber left-border + "· NEXT") and an **action rail** of triage cards (Needs grading 19 / Unanswered questions 7 / At-risk students 7), each row avatar + name + meta tag (overdue/today/2h) + footer link ("Open grading queue →"). Explicitly a glance/launchpad — "Read-only glance · click a session or Open Schedule to manage." *(FR-52)*
- **Classes index (`s07`) & detail (`s08`/`s09`).** Index = list-table (Class / Skill / Schedule / Students / Sessions [fraction + progress bar] / Status / Target band / Actions). Detail = tabbed shell: Overview (embedded students + active-assignments tables, side cards, dashed Actions with "Save as template") + Students / Assignments / Sessions / Materials (link-cards with "viewed by 12 of 14" telemetry) / Analytics (summary deferring to full Analytics). *(FR-12–14)*
- **Student detail (`s10`) & my-students (`s10a`).** `s10` = `student-head` + 6-box stats + `perf-card` (overall band + per-criterion bars + trajectory) + assignments table (submission-pill states + inquiry-count dots) + **teacher's notes** (chronological comment log, flag/warn variants, composer). `s10a` = the teacher's own aggregated roster across classes (tabs All/At-risk/New/By class), deliberately distinct from the owner's center-wide `s42`; enrolment is class-scoped. *(FR-44, FR-45)*
- **Sessions & schedule (`s11`–`s14`).** Session list = month calendar with state-coded chips (past faded / next dark+amber / cancelled red-strikethrough) + legend. Session detail (`s12`) = recur-banner + **attendance roster** (Present/Absent/Late segmented toggle, green/red/amber) + linked docs/exercises + notes; cancel/edit branches to recurrence scope. Schedule workspace (`s13`) = two-pane (mini-month navigator + class-color legend / Day-Week-Month grid with absolutely-positioned class-colored session blocks); "click empty slot to create, click session to edit." Create/edit modal (`s14`) = one shared modal; Delete expands the "Apply to…" recurrence scope. *(FR-16–19)*
- **Exercise library (`s15`) & editor (`s16`).** Library = list-table with skill tabs + filter chips. Editor = two-panel: a fixed **metadata sidebar** (title, skill, tags, target band, assigned classes) + a **content panel** of ordered, drag-reorderable **section-blocks**, each holding an imported material link-card + dashed **question-group cards** (type badge, per-question rows, expanded options with the key tinted green + "✓ KEY"). Section type-picker = 5 skill cards + an AI "Generate section" card. Exercise-level settings as toggle switches (time limit, case-sensitive key). Autosave ("Auto-saved · 2 min ago"). Finalized exercises lock once assigned + submitted (`s66`). *(FR-20–23)*
- **AI generation dialog (`s17`).** Modal with adaptive chip-pickers (section type, topic/source — free text or a dragged Knowledge-hub doc, target band, question count, question mix). Per §6.2: **preview-before-insert** (passage name, word count, estimated band, breakdown, "est. cost 1 credit") with Regenerate / Cancel / **Insert section**, and a visible credit budget. Note: Writing & Speaking are prompt-only (AI drafts the prompt). *(FR-24–26)*
- **Anchored Q&A — teacher (`s18`).** Docs-style sticky rail (§6.3): amber-underlined anchors with orange (item) / blue (whole-exercise) pins; rail with count + "Unanswered ▾" filter + cross-exercise link; **batch bar** for similar questions (Batch reply / Resolve); per-card reply with visibility toggle. *(FR-39)*
- **Templates (`s19`–`s22`).** Template index (within Classes tabs) → template detail (ordered session blueprint: each session's title/description/documents/exercises) → edit template → create class from template (pre-filled). *(FR-15)*
- **Grading (`s23`–`s25`).** The differentiator — see §9.
- **Knowledge hub (`s26`) & file detail (`s27`).** Hub = two-pane folder-tree + tile grid (type-tinted icons, tags, **"Used in EX-R114" back-links**). Detail = type-specific preview (paged doc / waveform audio) + info + **Linked-to** list + dashed Actions; "Use in exercise" CTA. Bidirectional linking ties files to exercises/sessions. *(FR-54, FR-55, XL-3 presigned uploads)*
- **Archive (`s28`).** List-table with the two reuse verbs — **Duplicate to active** vs **Edit a copy** (§6.6). Teacher-only; rows open read-only. *(FR-60)*

### 8.4 Student Experience (`s29`–`s38`)

Read-only consumer framing, mobile-first, calm and encouraging. The student's sidebar uses possessive verbs ("My classes", "My schedule", "My performance"). **No classmate roster, no class averages, no peer comparison anywhere.**

- **Dashboard (`s29`).** Greeting + dated summary over a week-strip glance + action rail (Due soon / Recent feedback [calmer count treatment] / My questions). Footer disclaimer: "Sessions are set by your teacher · read-only." *(FR-53)*
- **My classes (`s30`) & class detail (`s31`).** Cards with personal stats ("My band," attendance, due, sessions progress) — placement, not catalog. Detail = 4-box personal stat strip + tabs; class materials as link-cards ("shared by your teacher"); **no roster**; a dashed "My progress" card ("on track toward 6.5 → View my performance"). *(read-only consumer)*
- **My schedule (`s32`).** Read-only calendar; twin disclaimers ("your teachers manage these sessions"); clicking opens detail only.
- **Exercise attempt (`s33`).** One adaptive shell, three variants: **Reading/Listening/Vocab** split-pane (passage/audio + questions, choice rows, gap inputs, Prev/Next + ⚑ Flag); **Writing** redirects to `s34`; **Speaking** recorder (prompt + circular record button, "● Recording," timer, "re-record before submitting"). Side navigator = numbered progress dots (done/current/flagged) + "This attempt" stats + dashed "Stuck? Ask a question." Incremental save-draft + timer. *(FR-28, FR-30)*
- **Writing attempt (`s34`).** Built-in Docs-style editor (not Google Docs): formatting toolbar + **"● Saved 4s ago · all changes synced"** autosave indicator + **live word count "287 / 250 min"**; stat cards (Words +37 above min / Time on task / Due in 19h). ⚑ Flag, ? Ask, Submit essay. Footnote sets expectation: feedback returns as **anchored comments on the submitted text**. This is the sole RHF-exempt surface (document-editing pattern, debounced mutations). *(FR-29, FW-8)*
- **Submission & result (`s35`).** Band hero (circular `band-ring` overall + per-criterion bars) + teacher feedback quote (attributed) + the student's submission preview. **Class average explicitly hidden.** A "Have a question?" card opens an anchored question about the result. Late/low bands framed neutrally. *(FR-32)*
- **Anchored Q&A — student (`s36`).** "? Ask about this" affordance on items; "Attach to: This item / Whole exercise" chooser; awaiting + answered cards (teacher reply with "Shared with your class" visibility note). *(FR-38)*
- **My performance (`s37`).** Two tabs only — Overview (band progression spark + per-skill bars with named focus area) and **Patterns** (softened Mistakes view): each row phrased as a coaching action ("Watch the…", "Try building longer conclusions"), shows the teacher's actual quote + inline practice links to existing materials, **interleaved with praise rows**. Dashed note: "only your own data; class averages not shown; nothing new is generated." Per §6.1: no red regression, no peer comparison. *(FR-50, UX-DR22)*
- **Profile (`s38`).** Common to all roles; here in the student shell. Target band pill, notification toggles mapping to inbox event types; footnote: "enrolment is managed by your center — contact your Admin." *(FR-68)*

### 8.5 Inbox (`s50`–`s52`) — one pattern, three lenses

A single scaffold specialized per role: page header ("N unread · M total") + horizontal **filter-chip bar** + a **flat chronological list** grouped by date dividers; each row = color-coded type icon + body (from-name + type-pill + timestamp + snippet + context links) + type-matched **quick actions** ending in Snooze/Archive. Unread rows highlighted; one row shown **expanded** with an inline composer so the most common action needs no navigation. Topbar: Mark all read + rules. Near-real-time via polling (FR-59). *(FR-56–58, UX-DR24 for loading)*

- **Teacher (`s50`):** chips All/Unread/Questions/Submissions/Late/Mentions/System. Actions: Grade now, Grade·apply-penalty / Waive, Reply inline (with **✦ AI-suggest reply**), Open in exercise. Expanded = inline reply composer beside the quoted student draft.
- **Student (`s51`):** chips All/Unread/Replies/Grades/Class. Sender role tags ("Teacher"). Actions: Read feedback / Ask a question, Open assignment / Add to calendar, Update calendar. Encouraging grade snippets; late penalties stated factually, not alarmed. Anchored comments surface as "3 anchored comments → View."
- **Admin/Owner (`s52`):** chips All/Unread/Approvals/People/System/Alerts; first divider "Today · needs action." Actions: Approve enrolment / Decline with note / Suggest alternative, Re-auth Google, Resend/Revoke invite, Upgrade plan. Expanded approval shows inline **capacity + prerequisite** context cards before the decision.

### 8.6 Billing & Limits (`s68`–`s73`, Owner-only)

Transparency is the design value — every constrained or destructive moment surfaces explicit math and named consequences before confirmation.

- **Plan picker (`s68`).** 3-up Free/Pro/Studio with Monthly/Annual toggle ("Save 2 mo"); current plan flagged + CTA neutralized; excluded features struck through; a usage-based upgrade callout. *(FR-61, FR-72)*
- **Billing dashboard (`s69`).** Sub-tabbed; current-plan card (savings vs monthly) + next-invoice card with full **tax breakdown** (subtotal / VAT 10% / total); **usage meters** for every constrained resource with `.warn` amber state + plain-language read-out. *(FR-66)*
- **Invoice history (`s70`).** Table with status pills (paid/upcoming/declined/refunded/free); filters; **Export CSV / "Email all to accountant"**; VAT line items + tax ID (accountant-oriented). *(FR-66)*
- **Upgrade modal (`s71`).** 640px modal over a dimmed+blurred dashboard (preserves context); before→after comparison; **prorated math made explicit** (new price − unused credit + VAT = "Charged today"); confirm button shows the exact amount. *(FR-63, FR-64)*
- **Soft limit (`s72`).** Non-blocking amber banner on a still-functional page; explains what happens at the cap; **two resolution paths** (Upgrade w/ prorated price vs free "Split into 2 classes"); dismissible, re-shows at threshold. *(FR-62)*
- **Grace period (`s73`).** Persistent **red strip** on every Owner page: reason + deadline + countdown + "Update payment method"; body shows a 5-node recovery timeline (declined → retries → warning → day-7 downgrade) + plain-language "what downgrade means" (center keeps running, features paused) + fix-it form. Red throughout = hard failure, vs amber soft warning. *(FR-65)*

### 8.7 Analytics (`s45`–`s47`, shared, role-scoped)

Teacher sees own classes/students; Admin/Owner see center-wide; student sees only self via `s37`.

- **Analytics home (`s45`).** Hub: cards for Class performance / Student performance, each with mini-stats; an Owner/Admin-only **Teacher-performance card rendered dimmed with a tag** ("Not visible to teachers") — role-gating shown, not hidden. *(FR-47)*
- **Class performance (`s46`).** Scope bar + 4-up stats (cohort avg band + delta, target, at-risk, on-time) + **band-over-time bar chart** + **skill × week heatmap** (cell darkness = closer to target, with plain-language read-out) + **repetitive-mistake rows** (severity, skill tags, frequency, trend arrows; a calm praise variant) + at-risk/on-track action cards + an **AI insight card** ("Apply to all 9" / Dismiss, per §6.2). *(FR-48, PERF-2 aggregate in SQL)*
- **Student performance (`s47`).** `student-head` + stats + three tabs: Overview (progression + per-skill bars) / **Mistakes** (expandable rows revealing the graded-essay quote with the error span highlighted + teacher's note + "View all N instances") / **Recommendations** (priority-ordered cards tagged by source — AI vs "From [teacher]" — linking existing exercises/materials, Assign/Edit/Dismiss; teacher advice overrides AI). Student sees the softened `s37` framing. *(FR-49, FR-50, UX-DR25 progress sharing)*
- **Progress sharing (UX-DR25).** "Share summary" on student detail + My Performance generates a clipboard-ready plain-text block (Zalo/WhatsApp-friendly: name, range, overall band, per-skill, attendance) + a one-page branded PDF export. No parent accounts in v1 — sharing is copy/paste + PDF.

---

## 9. The Grading Experience (the differentiator)

Grading is *the* reason the product exists; its UX gets disproportionate care. Three skill-specific modes share one frame: a **topbar Prev/Next-student queue navigator**, the AI-assistance pattern (§6.2), the feedback/score language (§6.1), and a final **lock/release** CTA. *(FR-33–37, UX-DR22, UX-DR23)*

### 9.1 Writing grading — anchored comments (`s23`, flagship)

Three zones: (1) top `editor-head` (assignment type, prompt, student/word-count/submission meta); (2) middle `with-rail` — the student's essay rendered as the surface they wrote on, with span highlights + numbered pins, beside a sticky **comment rail**; (3) a full-width **band-scoring strip**.

- **Essay toolbar:** comment-type tools — ✎ Suggestion (amber), ! Error (red), ★ Praise (green) — plus "Pin to criterion" and live word count.
- **Comment rail:** header with count + summary ("1 praise · 2 suggestions · 1 error"); an **AI review strip** ("AI reviewed the essay · 3 suggestions awaiting" + "Accept all praise" / "Review one by one" + "You decide each one"); cards distinguishing **teacher** (dark avatar, "You") from **AI** (gradient "AI" avatar, type tag + criterion tag + Accept/Edit/Dismiss + confidence label).
- **Band-scoring strip:** an `ai-suggestion` block ("analysed 287 words · 1.4s") with per-criterion bands + prose rationale (weakest/strongest) + Accept/Edit-before-applying/Dismiss + "teacher always decides the final band"; below it the teacher's editable **band-score grid** (four criteria as large numerals, each annotating its **pinned-comment count** to evidence the score), the oversized overall band (Fraunces 32px), an overall-feedback quote, and **"Submit grade & notify student."** *(FR-33, FR-34)*

### 9.2 Speaking grading (`s24`)

Two-column: recording + timestamped notes / scoring. **Audio player** with waveform (played bars darker), time, and speed control; tip: "click the waveform to pin a comment to that moment." AI suggestion block works "from transcript" — per-criterion bands (Fluency/Lexical/Grammar/Pronunciation) + rationale citing exact timestamps ("hesitation 1:05–1:09"), and **flagged moments** pinned to the waveform. Notes thread mixes saved teacher notes (dark time chip) with AI-suggested items (Accept/Edit/Dismiss + confidence). Side: 2×2 bands grid + overall + feedback + Submit. *(FR-35, FR-36)*

### 9.3 Auto-grade review (`s25`, Reading/Listening/Vocab)

Summary band (big fraction score + provisional band + breakdown + an **After-overrides** recomputed score) → **answer-review table** (#, student's answer, the key shown when wrong, Result ✓/✕/override, per-answer **Override** action) → before-releasing card (overrides applied + final score + "Release result & notify"). Flagged spelling variants (e.g. "hydro-electric" vs "hydroelectric") surfaced for teacher review; score recomputes live; the student sees the breakdown only after release. *(FR-37)*

### 9.4 The grading queue (`s50` → grading, UX-DR23)

The bulk-review flow that turns grading into a fast loop: queue rows (student, assignment, class, submission time, overdue flag); **Prev/Next navigation without returning to the list**; a progress indicator ("3 of 12 graded"); a quick-action bar (Accept AI grade / Skip / Flag for later); keyboard shortcuts (arrows to navigate, Enter to open, Escape to return). This is a desktop-only surface by design (`s87`); mobile offers triage and reading, with an honest "Open in desktop for grading" seam (`s83`).

---

## 10. Landing Page & Authentication

The two pre-auth surfaces, preserved from the prior specification and integrated here. They share the §5 token system exactly so the `classlite.app → my.classlite.app → dashboard` transition is seamless. Full screen detail: `ux-design-directions.html` (`LP-01`, `AUTH-01`–`AUTH-08`). *(FR-71–81, UX-DR3–DR20)*

### 10.1 The trust-to-value pipeline

The defining pre-auth experience compresses five cognitive stages into minutes: **Awareness** ("I have a problem I'm paying for") → **Recognition** ("this is for someone like me") → **Decision** ("I'll try free") → **Entry** ("I'm in," Google OAuth ~10s) → **Proof** ("it works," first AI grade ~30s). A delay at any stage loses the user. Target: **median < 5 minutes** landing → first AI grade result.

### 10.2 Landing page (`LP-01`, `classlite.app`, Astro)

Desktop-optimized for owners/teachers, responsive to 390px, SEO-first, bilingual `/vi`+`/en`. Sections top-to-bottom: sticky **Header** (transparent → solid on scroll past 400px, secondary → primary CTA) · **Hero** (Fraunces 44px on dot-grid paper; eyebrow "Nền tảng quản lý trung tâm IELTS"; pain-quantifying headline "12 phút → 3 phút"; "Bắt đầu miễn phí") · **Pain articulation** (static calculator, Geist Mono: "5 giáo viên × 3 giờ/tuần × 48 tuần = 720 giờ/năm") · **Features** (3–4 tinted cards with screenshots — show, don't list) · **Social proof** (named Vietnamese center archetypes + outcome stats, "-65%") · **Pricing** (3 VND tier cards, annual/monthly toggle, popular tier with amber border + badge, "Bắt đầu miễn phí" repeated below) · **Footer** (navy, mirrors the sidebar; legal, language toggle, Zalo support). *(FR-71–74, UX-DR3, DR4, DR11–14)*

### 10.3 Auth screens (`AUTH-01`–`AUTH-08`, `my.classlite.app`, React)

Mobile-first (students arrive on phones). Centered `AuthCard` (420px desktop / full-bleed mobile) on dot-grid paper, Fraunces wordmark above. **Google-first:** the ToS-compliant `GoogleOAuthButton` (white bg, line border, colored logo) is the largest button; the email/password form is **collapsed** behind "Đăng ký/Đăng nhập bằng email." One action per screen. Password field has eye toggle + 4-segment strength bar (`aria-live`). Screens: Register, Login, Verification pending (envelope, "Kiểm tra email," resend with 60s cooldown, Google fallback "cùng tài khoản, không cần xác nhận"), Invite acceptance (center identity foregrounded), Lockout (recovery-framed "Hãy thử lại sau," "Quên mật khẩu?" primary), Password reset (+ spam hint). *(FR-75–81, UX-DR5–DR10, DR15)*

### 10.4 Failure-state catalog (pre-auth)

Every failure has an explicit recovery path — these are where users are permanently lost. *(UX-DR16, UX-DR20)*

| Failure | Trigger | Recovery |
|---|---|---|
| **Expired invite** | Link clicked after 7 days | Center name + "Ask [inviter] to send a new one" (mailto). Not a generic error. |
| **Already-accepted invite** | Same link twice | Redirect to login/dashboard: "You've already joined [center]." |
| **Existing account invited** | Existing user gets a new-center invite | "You already have an account. Join [center] as [role]?" one-click. |
| **Google Workspace blocks OAuth** | Institutional account | "Try a personal Gmail, or sign up with email" — both one click. |
| **Verification email not received** | >60s, no email | Troubleshoot + resend (rate-limited); after 2 resends, "Try Google instead." |
| **Account lockout** | 5 fails / 10 min | 15-min lockout + countdown (from server `retry_after`); "Forgot password?" stays active. |
| **Reset link expired** | >1 hour | "Request a new one" — pre-fills email. |
| **Silent refresh failure** | Access + refresh expired/revoked | Login with "Session expired"; **preserve target URL**; in-progress work preserved via autosave. |
| **Stale hint-cookie loop** | `logged_in=1` but session dead | Clear hint, redirect to `classlite.app?session_expired=true` (loop broken in one redirect). |
| **OAuth email mismatch** | OAuth email ≠ invited/registered email | Specific screen naming expected vs used email; two paths (different Google account / email signup). Server validates match atomically (account-takeover surface). |

### 10.5 Key pre-auth journeys

Five journeys converge on the same endpoint — the first AI grade. Full flowcharts in the prior showcase; the load-bearing decisions:

1. **Owner discovery → signup → first grade.** Landing (locale-routed, logged-in redirect via hint cookie) → CTA → Google OAuth or email+verification → persona pick → center setup → first AI grade. Four screens on the happy path; < 5 min.
2. **Teacher invite → first grade** (highest-value). Invite link → token validation (6 states) → center-foregrounded accept → role dashboard with "Chấm bài đầu tiên." Invite token rides the OAuth `state` param (`nonce:inviteToken`); email match validated server-side.
3. **Student invite (mobile).** Tap → center/teacher/role shown → one-tap Google → straight into the class. No onboarding wizard. < 30s authenticated.
4. **Returning login (happy + failure).** Valid session → dashboard; expired → silent refresh (multi-tab coordinated via `navigator.locks` + `BroadcastChannel`) → on failure, login preserving target URL. Lockout/unverified branch to recovery.
5. **Email verification gate.** Poll `verify-status` every 5s (10-min cap) → auto-redirect on verify; three distinct statuses (unverified/verified/token_expired); Google escape hatch with strict email-match.

**Journey principles:** Google OAuth is the universal escape hatch; center identity foregrounds on invites; auto-detection over manual action; three-part error recovery everywhere; every path converges on the first AI grade.

---

## 11. Mobile Strategy

Mobile screens are **purpose-built for the thumb and the moment** (iPhone 390×844 reference), not responsive squishes *(UX-DR15, UX-4, FR-74)*. Bottom **tab bars replace the sidebar**, with role-specific spines: Student 5-tab (Home/Assignments/Inbox/Classes/Me), Teacher 4-tab (Home/Classes/Inbox/More), Owner 4-tab (Home/Inbox/People/More).

### 11.1 Coverage buckets (`s87`)

Every desktop surface is placed in exactly one bucket, so gaps read as intentional:
- **Mobile-first (purpose-built):** student consumption (dashboard, assignments, class, essay-write, result, Q&A, performance, inbox), teacher triage (dashboard, class-health, inbox, question-reply), owner approve-from-push.
- **Mobile-triage (responsive fallback):** read-only or one-tap surfaces — class/schedule scanning, question reading, knowledge-hub reading, billing usage check, invoice PDF, grace strip, permission-denied. Empties degrade gracefully.
- **Desktop-only by design:** the work that doesn't fit a phone — onboarding, exercise builder + anchored-comment grading, class creation, people/roles, center settings, analytics drill-down, plan picker/upgrade, creation-side errors. These show a "best viewed on desktop" hint, not a degraded screen.

### 11.2 Mobile patterns

- **Above-fold priority:** student dashboard (`s74`) leads with a single due-now hero (countdown + progress + "Continue writing"); teacher dashboard (`s82`) leads with triage ("is anyone blocked"); owner (`s86`) is a single-screen push-driven decision.
- **Gestures over hover:** swipe-to-act on inbox rows (`s75`/`s84`) replaces hover actions; horizontally-scrolling filter chips replace wrapping.
- **Detail via full-screen push, not modal** (`s76`) — phones don't carry modal context.
- **Essay write (`s78`):** maximized text area, sticky word-counter strip, formatting bar only when the keyboard is up, slide-up submit sheet confirming word count + late policy.
- **Result (`s79`):** anchored comments expand **inline under the line** (not a side rail).
- **Q&A (`s80`/`s85`):** chat-thread bubbles (student right, teacher left) with a context strip.
- **Honest seams:** `s83` shows an explicit "Open in desktop for grading" CTA — the product names the workflow boundary rather than faking parity.
- **Touch & input floor:** 44×44px minimum touch targets (buttons 48px), ≥16px input font (no iOS zoom-on-focus), keyboard-accessible nav drawer, tables reflow or horizontal-scroll (never invisible overflow). *(UX-DR15, TEST-UX-4)*

### 11.3 Mobile auth

Auth screens at 390px: full-width 48px buttons/inputs, one action per screen, primary CTA in the thumb zone, card padding `24px 20px`. Mobile token overrides: `--cl-input-height/btn-height: 48px`, `--cl-btn-font-size: 15px`, `--cl-heading-size: 28px`. Register / Verification / Invite / Expired-invite wireframes per `AUTH-02/04/06`.

---

## 12. Accessibility (WCAG 2.1 AA, product-wide) *(NFR-5)*

Consolidated reference; requirements are also stated inline in the relevant sections.

| Requirement | Standard | Implementation |
|---|---|---|
| **Color contrast** | 1.4.3 (4.5:1 / 3:1) | All token pairs verified (§5.5). `--cl-muted` `#595c66`; amber decorative-only with `-text`/`-btn` variants. |
| **Non-text contrast** | 1.4.11 | Interactive borders `--cl-line-interactive` `#a8a095` (3:1); decorative borders exempt. |
| **Color not sole signal** | 1.4.1 | Error/success/status pair color with icon + text; charts pair color with value labels; feedback decline is neutral-framed, never color-only (§6.1). |
| **Touch targets** | 2.5.5 | 44×44px min; 48px buttons on mobile. |
| **Focus indicators** | 2.4.7 | `2px solid var(--cl-accent)` + 2px offset on all interactive elements. |
| **Form labels** | 1.3.1 | Visible `<label>` always (no placeholder-only); `aria-describedby` for errors; `aria-required`. |
| **Keyboard navigation** | 2.1.1 | Full keyboard path including the **grading queue** (arrows/Enter/Escape, UX-DR23); focus traps in modals with focus-return on close; skip-to-content on every page. |
| **Screen readers** | 4.1.2 | Landmark regions, sequential headings, `aria-label` on icon-only buttons, `aria-live="polite"` for password strength, verification status, autosave, and async content (loading complete / error appeared). Page titles change on route navigation. |
| **Motion** | 2.3.3 | `prefers-reduced-motion` disables scroll transitions, skeleton pulse easing, and the 150ms fade-in. |
| **Language** | 3.1.1/3.1.2 | `lang="vi"`/`"en"` on `<html>`; IELTS terms wrapped `<span lang="en">`; both locales tested for visual + semantic (aria) parity (TEST-UX-1). |

---

## 13. Component Strategy

**Three tiers, never blurred** *(FW-7)*: `components/ui/` (shadcn primitives, generated, never hand-edited) · `components/shared/` (app-wide layout) · `components/domain/` (business-aware, reusable, e.g. `BandScoreChart`, `AnchoredCommentRail`, `AIGradeSuggestion`) · `features/<feature>/components/` (feature-local). Domain/feature components never live in `ui/`; behavioral extensions wrap a primitive in `domain/`.

- **Auth/landing components** (specified for build): `GoogleOAuthButton`, `PasswordInput` + `PasswordStrengthBar`, `AuthCard`, `VerificationPending` + `useVerificationPoller`, `InviteCard` + `useInviteToken` (6 states), `CollapsibleEmailForm` (React); `StickyHeader`, `PainCalculator`, `PricingCard`, `SocialProofCard`, `FeatureCard` (Astro). Logic hooks are extracted for isolated testing; MSW mocks the HTTP boundary (never mock TanStack Query, TEST-FE-1).
- **Cross-product domain components** (derived from §6, to be built per epic): the **anchored comment/Q&A rail** (highlight→pin→card), the **AI suggestion card** (chip + confidence + Accept/Edit/Dismiss), the **band-score grid + criterion pinning**, the **status pill / load bar / usage meter**, the **skeleton set** (one per primary layout, UX-DR24), the **empty-state** and **three-part error** shells, and the **list-table / tabbed-shell** scaffolds.
- **Shared tokens (pragmatic path):** ship one `tokens.css` committed to both repos + a no-raw-hex lint rule + visual-regression diffing; defer a monorepo `@classlite/tokens` package until a second team touches tokens independently. *(UX-DR1)*

---

## 14. Open Questions & Assumptions

### 14.1 Phase-blocking (resolve before the relevant epic)

| # | Question | Blocks |
|---|---|---|
| 1 | Go API auth endpoint contracts (request/response shapes) | Auth flows (Epic 1B/1C) |
| 2 | OAuth strategy: redirect to `/auth/google` vs `@react-oauth/google` SDK | Auth screens |
| 3 | Password strength library: `zxcvbn` vs custom tiers | Register/Login |
| 4 | Invite token URL structure: `/invite?token=` vs `/invite/:token` | Invite acceptance |
| 5 | Grading-queue keyboard-shortcut map + AI-prefill timing (does AI run on queue-open or on-demand?) | Epic 6 (grading, UX-DR23) |
| 6 | Heatmap/chart rendering approach for analytics (lib vs hand-built, perf on 4G per NFR-3) | Epic 8 |

### 14.2 Assumptions (validate; non-blocking)

- `[ASSUMPTION]` The 93-screen mockup set is the authoritative visual realization; this spec defers to it on screen detail and only overrides on principle (§1).
- `[ASSUMPTION]` Pricing/social-proof content is hardcoded in Astro for v1 (no CMS/API).
- `[ASSUMPTION]` Pain-calculator values are static (not interactive) for MVP.
- `[ASSUMPTION]` Mobile coverage buckets (`s87`) are the v1 contract; "desktop-only" surfaces ship a hint, not a degraded mobile screen.

### 14.3 Flagged for a later UX pass

- **Return-visit / re-engagement & upgrade-trigger journey.** SM-6 (>15% free→pro within 60 days) depends on day-3/day-7 re-engagement and a defined upgrade moment. Out of scope here; needs its own retention UX pass.
- **Global search palette (⌘K) UI** (FR-67) — the interaction is named in the app shell but the palette itself is not yet drawn.
- **Bulk-operation modals/drawers** — pattern defined (count → parameters → preview → confirm) but no specific bulk flows drawn yet.

---

## 15. Screen Inventory & Status

| Range | Area | Status |
|---|---|---|
| `LP-01`, `AUTH-01–08` | Landing + Auth (9) | Designed — HTML showcase (`ux-design-directions.html`) |
| `s00–s09` | Onboarding (10) | Mocked — `01-owner-onboarding.html` |
| `s06–s28`, `s10a` | Teacher (24) | Mocked — `02a–02d` |
| `s29–s38` | Student (10) | Mocked — `03-student.html` |
| `s39–s49` | Admin/Owner + cross-role (11) | Mocked — `04`, `05` |
| `s50–s67` | Inbox + empty + error states (18) | Mocked — `06a–06c` |
| `s68–s73` | Billing (6) | Mocked — `07-billing.html` |
| `s74–s87` | Mobile (14) | Mocked — `08-mobile.html` |
| **Total: 102** | **Full product** | Visual language settled; this spec is the behavioral + directional contract over it |

Together these provide complete UX coverage from first visit through authentication to every authenticated surface. The mockups own screen-level layout; this specification owns the cross-cutting principles, patterns, states, and role logic that bind them into one coherent product.
