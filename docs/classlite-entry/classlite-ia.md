# ClassLite — Full screen inventory

**Source files (all in the final mockup set):**
`01-owner-onboarding.html` · `02a-teacher-dashboard-classes.html` · `02b-teacher-time.html` · `02c-teacher-content-grading.html` · `02d-teacher-resources.html` · `03-student.html` · `04-owner-admin.html` · `05-cross-role.html` · `06a-inbox.html` · `06b-empty-states.html` · `06c-error-states.html` · `07-billing.html` · `08-mobile.html` · `index.html`

**Total: 93 screens** — 79 desktop + 14 mobile (incl. coverage map). All have stable IDs and real routes. Cross-file anchor links all resolve.

> **Note on IDs:** Onboarding uses `s00–s09` (10 screens scoped to chapter 1). The rest of the app uses `s06–s87` plus one inserted `s10a`. The `s05–s09` ID range appears in BOTH the onboarding chapter and the teacher chapter — this is fine because hrefs are file-scoped (`01-owner-onboarding.html#s05` ≠ `02a-teacher-dashboard-classes.html#s06`). The onboarding is its own numbering scope.

---

## Role model

| Role | Sidebar destinations *(extracted from drawn sidebars)* | Bottom-pill label |
|---|---|---|
| **Owner** | Dashboard · People · Classes · Schedule · Analytics · Inbox · Knowledge hub · Archive · Settings | "Owner" |
| **Admin** | Same sidebar as Owner per mockup convention (only renders Owner perspective; Admin variations called out inline) | "Admin" *(visible on s41 invite-flow)* |
| **Teacher** | Dashboard · Classes · Schedule · Exercises · Questions · Students · Analytics · Inbox · Knowledge hub · Archive | "Teacher" |
| **Student** | Dashboard · My classes · Assignments · My schedule · Questions · My performance · Inbox | "Student" |

**Role ladder:** Teacher < Admin < Owner (fixed). Student is a separate consumer role outside the ladder.

**Scope constraints:**
- Center-wide only — no branch switcher
- Single sidebar — no top-bar workspace switcher
- Single app for all roles — role-gated
- No messaging product — communication only via submission comments (`s23` Writing grading) and student Q&A (`s18`/`s36`)
- Bulk operations live as modals or drawers when added (none drawn yet)

---

## Persona → role mapping *(onboarding only)*

Onboarding uses **persona labels** (how the user identifies). The rest of the product uses **role labels** (permissions).

| Onboarding persona | Product role | Notes |
|---|---|---|
| **Operator** | Admin | Runs the center, does not teach. |
| **Founder** | Owner | Owns the center and also teaches at least one class. |
| **Solo teacher** | Teacher *(in a single-user workspace)* | No center-management surface — just classes they teach. |

---

# Screen inventory

Columns: **ID** · **Route** · **Section** · **Primary role** · **Purpose**.

> "Primary role" = the role whose sidebar/POV the screen is drawn from. Cross-role screens (single screen serves multiple roles) tagged in the role column.

---

## Chapter 1 — Onboarding *(s00–s09, 10 screens, persona-forked)*

| ID | Route | Section | Persona | Purpose |
|---|---|---|---|---|
| `s00` | `/welcome` | Onboarding | All | **Persona pick** — Operator / Solo / Founder. Routes to one of three flows. No sidebar yet; product doesn't know the user's persona. |
| `s01` | `/setup/center` | Onboarding | Operator/Founder | **Center setup** — name & brand the center. Optional logo (defaults to letter mark). Live preview. |
| `s02` | `/setup/template` | Onboarding | Operator/Founder | **Build template** — pick a suggested IELTS template or build from scratch. Editable preview. |
| `s03` | `/setup/spawn` | Onboarding | Operator/Founder | **Spawn classes** — duplicate template into N classes. Per-class teacher (required, inline-invite) + students (optional). |
| `s04` | `/setup/done` | Onboarding | Operator/Founder | **Done — Operator/Founder.** Summary; "Open Dashboard" CTA. |
| `s05` | `/setup/first-class` | Onboarding | Solo | **Solo first class** — single class form, teacher locked to "you". No center management surface. |
| `s06` | `/setup/done` | Onboarding | Solo | **Done — Solo.** Same shape as s04, scoped to solo. |
| `s07` | `/setup/template` | Onboarding | Founder | **Founder build template** — same as s02 but pre-flags one class as self-assigned. |
| `s08` | `/setup/spawn` | Onboarding | Founder | **Founder spawn** — same as s03, first class auto-assigned to founder, subsequent classes optional. |
| `s09` | `/dashboard` | Onboarding | All *(handoff)* | **Dashboard handoff** — first real-product view after onboarding. "Finish setting up" card pinned to top with remaining tasks; per-persona task set differs. |

> All screens have a quiet "save and finish later" exit + skip-this-step pattern. Mismatch with by-role index numbering is intentional — onboarding is its own numbering scope per user direction.

---

## Chapter 2 — Teacher *(s06–s28 + s10a, 24 screens)*

### 2a · Dashboard, Classes & Students *(s06–s10, s10a)*

| ID | Route | Section | Role | Purpose |
|---|---|---|---|---|
| `s06` | `/dashboard` | Dashboard | Teacher | **Dashboard** — week-strip of sessions, action rail (grading/questions/at-risk students). |
| `s07` | `/classes` | Classes | Teacher | **Classes index** — all classes the teacher runs. Columns: name, students, recurrence/sessions left, active assignments, status, target band. |
| `s08` | `/classes/{id}` | Class detail | Teacher | **Class detail — Overview tab.** Name, description, students, assignments, sessions, quick analytics. |
| `s09` | `/classes/{id}` *(tabs)* | Class detail | Teacher | **Class detail — other tabs:** Students · Assignments · Sessions · Materials · Analytics. Same shell, tab-switched. |
| `s10` | `/classes/{id}/students/{sid}` | Student detail | Teacher | **Student detail** — overall + per-skill performance, attendance, submissions, teacher notes (comment log), assignments table, student work. |
| `s10a` | `/students` | Students | Teacher | **Students — top-level, across my classes.** *(NEW)* Aggregated roster for the teacher across all classes they teach. Distinct from Owner's `s42` (which is center-wide). Tabs: All / At-risk / New / By class. Row click → reuses `s10`. |

### 2b · Time *(s11–s14)*

| ID | Route | Section | Role | Purpose |
|---|---|---|---|---|
| `s11` | `/classes/{id}/sessions` | Sessions | Teacher | **Sessions list.** Calendar of sessions with status. |
| `s12` | `/classes/{id}/sessions/{ssid}` | Session detail | Teacher | **Session detail** — info, attendance, materials, linked exercises, notes, actions (with recurrence scope). |
| `s13` | `/schedule` | Schedule | Teacher | **Schedule workspace.** Day/Week/Month, mini-month navigator, filter, create/edit in place. |
| `s14` | `/schedule?session=edit` | Schedule | Teacher | **Create/edit session — modal.** Delete → "Apply to…" recurrence-scope branch expanded. |

### 2c · Content & Grading *(s15–s25)*

| ID | Route | Section | Role | Purpose |
|---|---|---|---|---|
| `s15` | `/exercises` | Exercises | Teacher | **Exercises library — table.** Columns: title, skills, tags, classes assigned, last modified, actions. |
| `s16` | `/exercises/{id}/edit` | Exercises | Teacher | **Exercise editor** — info + content (sections, question groups, settings). |
| `s17` | `/exercises/{id}/edit?ai=section` | Exercises | Teacher | **AI dialog.** Generate section / questions / option. Preview before insert. |
| `s18` | `/exercises/{id}?questions=open` | Questions | Teacher | **Anchored Q&A sidebar — teacher.** Docs-style sticky rail. Teacher answers in place or batch-handles. |
| `s19` | `/classes/templates` | Templates | Teacher | **Class templates index.** Columns: Title, Skills, Band, Sessions, Color. |
| `s20` | `/classes/templates/{id}` | Templates | Teacher | **Template detail** — class info + sessions (each session: title, description, documents, exercises). |
| `s21` | `/classes/templates/{id}/edit` | Templates | Teacher | **Edit template** — same fields as s20, editable. |
| `s22` | `/classes/new?from={tpl}` | Templates | Teacher | **Create class from template** — new-class form pre-filled. |
| `s23` | `/classes/{id}/grading/{aid}/{sid}` | Grading | Teacher | **Writing grading — anchored.** Inline span-anchored comments (error/praise/suggestion). |
| `s24` | `/classes/{id}/grading/{aid}/{sid}` | Grading | Teacher | **Speaking grading.** Audio player + speaking criteria scores + timestamp-pinned feedback. |
| `s25` | `/classes/{id}/grading/{aid}/{sid}` | Grading | Teacher | **Auto-grade review** — Reading/Listening/Vocab. Teacher reviews, overrides, releases. |

### 2d · Resources *(s26–s28)*

| ID | Route | Section | Role | Purpose |
|---|---|---|---|---|
| `s26` | `/knowledge-hub` | Knowledge hub | Teacher | **Knowledge hub** — foldered document & file repository. |
| `s27` | `/knowledge-hub/files/{slug}` | Knowledge hub | Teacher | **Document detail** — preview, info, where linked, actions. Adapts by file type. |
| `s28` | `/archive` | Archive | Teacher | **Archive** — past classes/sessions/exercises. Duplicate or edit a copy. |

---

## Chapter 3 — Student *(s29–s38, 10 screens)*

| ID | Route | Section | Role | Purpose |
|---|---|---|---|---|
| `s29` | `/dashboard` | Dashboard | Student | **Student dashboard** — upcoming sessions, work due, recent feedback. Read-only. |
| `s30` | `/my-classes` | Classes | Student | **My classes** — only classes the student is placed in. |
| `s31` | `/my-classes/{id}` | Class detail | Student | **Class detail — student view.** Own sessions, materials, own assignments. No classmate roster. |
| `s32` | `/my-schedule` | Schedule | Student | **My schedule** — own sessions across all classes. Read-only. |
| `s33` | `/exercises/{id}/attempt` | Exercises | Student | **Exercise attempt — adaptive.** Three variants: question answering, writing canvas, speaking recorder. |
| `s34` | `/assignments/{id}/write` | Assignments | Student | **Writing attempt — Docs-style editor.** Built-in, not Google Docs. Autosave. |
| `s35` | `/assignments/{id}/result` | Assignments | Student | **Submission & result.** Band, criterion breakdown, teacher feedback. |
| `s36` | `/exercises/{id}/attempt?questions=open` | Questions | Student | **Anchored Q&A sidebar — student.** Highlight an item to ask. Thread stays anchored. |
| `s37` | `/my-performance` | Analytics | Student | **My performance** — two tabs: Overview, Patterns (softened version of teacher's Mistakes view). |
| `s38` | `/profile` | Profile | Student | **Profile & settings.** Common to all roles; shown here in student shell. |

---

## Chapter 4 — Admin & Owner *(s39–s44, 6 screens)*

> All drawn from **Owner** perspective. Admin sees same screens minus the "Owner" role chip on `s41` invite, minus `s44` Roles & permissions.

| ID | Route | Section | Role | Purpose |
|---|---|---|---|---|
| `s39` | `/people/staff` | People | Admin/Owner | **Staff list** — teachers and admins (Owner excluded). Columns: role, classes, load, status, last active. |
| `s40` | `/people/staff/{id}` | People | Admin/Owner | **Staff detail** — profile, role, classes, schedule glance, load, activity. |
| `s41` | `/people/staff?invite=new` | People | Admin/Owner | **Invite staff modal.** Role chips (Teacher/Admin; Owner only when sender is Owner). |
| `s42` | `/people/students` | People | Admin/Owner | **Students — center-wide.** Every student across all classes/teachers. Click → reuses `s10`. Distinct from teacher's `s10a`. |
| `s43` | `/people/enrolment` | People | Admin/Owner | **Enrolment** — add/transfer/withdraw. Compose row + history. |
| `s44` | `/people/permissions` | People | Owner-only | **Roles & permissions** matrix. Most rows read-only; a few capabilities editable. |

---

## Chapter 5 — Across roles *(s45–s49, 5 screens)*

| ID | Route | Section | Role | Purpose |
|---|---|---|---|---|
| `s45` | `/analytics` | Analytics | All *(scoped)* | **Analytics home** — branches to Class / Student performance. Teacher: own. Admin/Owner: center-wide. |
| `s46` | `/analytics/class/{id}` | Analytics | All *(scoped)* | **Class performance** — cohort band over time, skill×week heatmap, repetitive mistakes, at-risk split. |
| `s47` | `/analytics/student/{id}` | Analytics | All *(scoped)* | **Student performance — three tabs:** Overview, Mistakes, Recommendations. Student sees softened framing per `s37`. |
| `s48` | `/dashboard` | Dashboard | Admin/Owner | **Admin/Owner Dashboard** — center pulse. Different from `s06` teacher dashboard. |
| `s49` | `/settings` | Settings | Owner-only | **Center settings** — profile, term calendar, integrations, rooms, re-open setup link. |

---

## Chapter 6 — Inbox · Empty states · Error states *(s50–s67, 18 screens)*

### 6a · Inbox *(s50–s52)*

| ID | Route | Role | Purpose |
|---|---|---|---|
| `s50` | `/inbox` | Teacher | Central queue: unanswered questions, ungraded submissions, late subs, mentions. Per-row Grade/Reply/Archive. |
| `s51` | `/inbox` | Student | Teacher replies, posted grades, comments on submissions, new assignments, schedule changes. |
| `s52` | `/inbox` | Admin/Owner | Operational signals: enrolment requests, new staff, integration health, billing events. |

### 6b · Empty states *(s53–s62)*

| ID | Companion to | Role | Purpose |
|---|---|---|---|
| `s53` | `s06` | Teacher | Dashboard day-one. Guided three-step start. |
| `s54` | `s07` | Teacher | Classes empty. Three paths to create. |
| `s55` | `s09` Students tab | Teacher | Class roster empty. Three invite paths. |
| `s56` | `s50/s51/s52` | All three | Inbox empty per role — three variants side by side. |
| `s57` | `s37` | Student | My performance empty. Ghosted chart frames. |
| `s58` | `s18` | Teacher | Questions empty. Explains Q&A vs Inbox. |
| `s59` | `s26` | Teacher | Knowledge hub empty. Three add paths. |
| `s60` | `s28` | Teacher | Archive empty. |
| `s61` | `s45` | Teacher | Analytics no-data. Ghosted frames. |
| `s62` | `s29` | Student | Student dashboard first login. |

### 6c · Error states *(s63–s67)*

| ID | Section | Role | Purpose |
|---|---|---|---|
| `s63` | Assignments | Student | **Late-with-penalty graded view** — 6.0 + −0.5 = 5.5. Breakdown explains. |
| `s64` | Assignments | Student | **Submission past deadline.** Locked, read-only. Only path: request extension. |
| `s65` | Classes | Teacher | **Form validation** — name conflict + invalid dates + capacity exceeds plan limit. |
| `s66` | Exercises | Teacher | **Locked finalized assignment.** Read-only. Unlock: clone, or unfinalize. |
| `s67` | Settings | Teacher *(denied)* | **Permission denied** — teacher deep-links to Center settings. |

---

## Chapter 7 — Billing & limits *(s68–s73, 6 screens)* · Owner-only · IN SCOPE

| ID | Route | Section | Role | Purpose |
|---|---|---|---|---|
| `s68` | `/settings/billing/plans` | Billing | Owner | **Plan picker** — Free / Pro / Studio. Annual toggle. |
| `s69` | `/settings/billing` | Billing | Owner | **Billing dashboard** — current plan, next invoice, live usage meters, payment method. |
| `s70` | `/settings/billing/invoices` | Billing | Owner | **Invoice history** — filter, download PDF, retry payment. |
| `s71` | `/settings/billing` *(modal)* | Billing | Owner | **Upgrade modal** — Pro → Studio. Prorated math visible. Triggers from s68, s65, s69. |
| `s72` | `/people/students` *(banner)* | Billing | Owner | **Plan limit soft warning** — non-blocking yellow banner. |
| `s73` | `/settings/billing` *(strip)* | Billing | Owner | **Payment declined · grace** — 7-day window, red top strip on every page. |

---

## Chapter 8 — Mobile *(s74–s87, 14 screens)*

iPhone 390×844. Purpose-designed, not responsive squishes.

### Student mobile *(s74–s81)*

| ID | Purpose |
|---|---|
| `s74` | Dashboard — above-fold "what do I need to do?" with countdown card |
| `s75` | Inbox — flat chronological, swipe gestures, horizontal-scroll filter chips |
| `s76` | Assignments — list grouped by status + detail deep-link |
| `s77` | Class detail — identity, schedule, own progress |
| `s78` | Essay write — phone-sized writing surface, sticky word counter |
| `s79` | Result + feedback — band hero, anchored comments inline (not side rail) |
| `s80` | Q&A thread — chat-bubble pattern |
| `s81` | My performance — glance not work |

### Teacher mobile *(s82–s85)*

| ID | Purpose |
|---|---|
| `s82` | Dashboard — triage view between sessions |
| `s83` | Class detail — class health (attendance, on-time, avg band) |
| `s84` | Inbox — two-line rows, Questions filter prominent |
| `s85` | Question reply — inline composer + AI-suggest sheet |

### Owner mobile *(s86)*

| ID | Purpose |
|---|---|
| `s86` | Approve enrolment from push notification |

### Coverage map *(s87)*

| ID | Purpose |
|---|---|
| `s87` | Every desktop screen placed into Mobile-first / Mobile triage / Desktop-only buckets |

---

# Section summary

| Chapter | File | Screens | Range |
|---|---|---|---|
| 1 — Onboarding *(persona-forked)* | `01-owner-onboarding.html` | 10 | `s00–s09` |
| 2a — Teacher · dashboard, classes & students | `02a-teacher-dashboard-classes.html` | 6 | `s06–s10, s10a` |
| 2b — Teacher · time | `02b-teacher-time.html` | 4 | `s11–s14` |
| 2c — Teacher · content & grading | `02c-teacher-content-grading.html` | 11 | `s15–s25` |
| 2d — Teacher · resources | `02d-teacher-resources.html` | 3 | `s26–s28` |
| 3 — Student | `03-student.html` | 10 | `s29–s38` |
| 4 — Admin & Owner | `04-owner-admin.html` | 6 | `s39–s44` |
| 5 — Across roles | `05-cross-role.html` | 5 | `s45–s49` |
| 6a — Inbox | `06a-inbox.html` | 3 | `s50–s52` |
| 6b — Empty states | `06b-empty-states.html` | 10 | `s53–s62` |
| 6c — Error states | `06c-error-states.html` | 5 | `s63–s67` |
| 7 — Billing & limits | `07-billing.html` | 6 | `s68–s73` |
| 8 — Mobile | `08-mobile.html` | 14 | `s74–s87` |
| **Total** | | **93** | |

---

# Per-role visibility matrix

**A** = full access · **scoped** = same screen, role-scoped data · **—** = not visible

| Section | Teacher | Student | Admin | Owner |
|---|---|---|---|---|
| Dashboard | own `s06` | own `s29` | center `s48` | center `s48` |
| Classes — index/detail (s07–s09) | own | — *(uses s30)* | A center-wide | A center-wide |
| My classes (s30–s31) | — | own | — | — |
| Student detail (s10) | own students | — | scoped, all | scoped, all |
| Students top-level | own roster `s10a` | — | center `s42` | center `s42` |
| Sessions (s11–s12) | own | — | A | A |
| Schedule (s13–s14) | own | — *(uses s32)* | center | center |
| My schedule (s32) | — | own | — | — |
| Exercises (s15–s17) | own bank | — | A | A |
| Exercise attempt (s33–s34) | — | own | — | — |
| Submission & result (s35) | — *(grades it)* | own | — | — |
| Questions (s18 / s36) | own (answer) | own (ask) | **— no visibility** | own (answer; if teaches) |
| Templates (s19–s22) | A | — | A | A |
| Grading (s23–s25) | A | — | — | A (if teaches) |
| Knowledge hub (s26–s27) | shared | read (when shared) | curate | curate |
| Archive (s28) | own | — | center-wide | center-wide |
| My performance (s37) | — | own | — | — |
| Profile (s38) | own | own | own | own |
| People · Staff (s39–s41) | — | — | A *(no Owner invite)* | A |
| People · Students (s42) | — | — | A | A |
| People · Enrolment (s43) | — | — | A | A |
| Roles & permissions (s44) | — | — | — | A |
| Analytics (s45–s47) | own classes/students | own self via `s37` | center-wide | center-wide |
| Center settings (s49) | — *(returns s67)* | — | — | A |
| Inbox (s50–s52) | own role | own role | own role | own role |
| Billing (s68–s73) | — | — | — | A |

---

# App shell elements

| Element | Position | Notes |
|---|---|---|
| Sidebar — brand | top-left | "ClassLite" wordmark with amber dot accent |
| Sidebar — Workspace nav | left | Varies by role |
| Sidebar — Resources nav | left | Knowledge hub + Archive (teacher) / Knowledge hub (owner) |
| Sidebar — Settings group | left (Owner only) | Single Settings item |
| Sidebar — user pill | bottom-left | Avatar + name + role label |
| Topbar — breadcrumbs | top-left | Workspace / section / *current* |
| Topbar — search | top-right | "Search" with ⌘K shortcut. Palette UI not drawn. |
| Topbar — primary CTA | top-right | Section-dependent: "+ New class", "+ New assignment", "Invite staff", etc. |
| Inbox notification | sidebar nav item | "Inbox" with unread badge |

---

# Bulk operations

No specific bulk operations are drawn in the mockup. When added, appear as **modals or drawers** triggered from list/table views. Standard pattern: count → parameters → preview → confirm.

---

# Resolved decisions *(closed in this thread)*

1. ✅ **Onboarding canonical form:** Template+Spawn persona-forked (s00–s09) — replaces older Owner-only checklist. 
2. ✅ **Billing in scope:** Chapter 7 (s68–s73) stays.
3. ✅ **Admin visibility on Questions:** No visibility. Admin doesn't teach, doesn't see questions. Questions are teacher↔student only.
4. ✅ **Teacher top-level Students screen:** Added as `s10a` — aggregated roster across teacher's own classes (distinct from Owner's center-wide `s42`).
