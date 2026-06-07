# ClassLite Component Inventory

Generated from 93-screen mockup set on 2026-06-07. Scopes Epic 1D (Component Library Buildout).
**Re-scoped 2026-06-07 to Path B** after party-mode review — see § "Path B re-scope summary" and § "Renames & consolidations in Epic 1D" below.

## Renames & consolidations in Epic 1D (per Paige's review)

The following component renames and consolidations happened during story authoring but were not initially reflected back in the inventory tables. Recorded here so future agents reading the inventory don't search in vain:

| Inventory name | Renamed / consolidated to | Status under Path B |
|---|---|---|
| `SessionModal` (row in Chapter 2b § Time) | `ScheduleEditModal` (in legacy 1d-8) | Deferred → Epic 3 Story 3-4 / 3-5 |
| `ApplyToScopeOptions` (row in Chapter 2b § Time) | `RecurrenceScopeConfirm` (in legacy 1d-8) | Deferred → Epic 3 Story 3-5 |
| `StatBox` + `DashStat` (rows in Chapter 5 § Cross-role analytics) | `MetricBox` (consolidated single component) | Deferred → Epic 8 (Path B re-scope) |
| `BandTrendSparkline` / `BandTrendChart` (rows in Chapter 3 § Student) | (no consolidation; in-scope in Epic 8 Story 8-3) | Deferred → Epic 8 Story 8-3 (was silently dropped; now explicitly placed) |

The `BandScoreGrid → BandScoreChart` rename DID get inline-noted at the original inventory row; the four above did not. The pattern is: any future rename/consolidation should be inline-noted at the affected inventory row AND surfaced in this top section.

## Path B re-scope summary (2026-06-07)

Original Epic 1D scoped all 77 Phase 1–3 components for buildout. After party-mode review (Winston + Sally + Mary + Murat + Paige + Amelia), the epic was trimmed to **active Phase 1–3 scope: foundation + 34 primitives + 8 app-shell components + 8 Phase 4 visual bridge shells = ~50 components.** The remaining ~27 components defer to feature epics where they're first consumed:

| Component category (inventory rows) | Defer target | Why |
|---|---|---|
| `StatusPill` family (`PerfPill`, `BandPill`, `SubmissionPill`, etc.), `MetricBox`, `SkillTag`, `WeekStrip`, `ActionRail`, `ActionCard`, `DashboardHero` (role variants), `BandScoreChart`, `BandTrendChart`, `BandTrendSparkline` | Epic 8 Stories 8-1/8-2/8-3 | Dashboards + analytics own the visual identity for these |
| `PlanUsageMeter`, `BillingGraceBanner`, `PlanCard` | Epic 9 Stories 9-1/9-3 | Billing owns them |
| `OnboardingShell`, `PersonaPickCard`, `StepProgressDots`, `SetupCard`, `DoneHeroPanel`, `TaskChecklistItem`, `ImportBanner` | Epic 2 Stories 2-3a/b/c/2-4 | Onboarding owns them |
| `EmptyState` (consolidated), 3 `ErrorState` shapes, shape-semantic `LoadingSkeleton` patterns (`SkeletonListRow`, `SkeletonTableRow`, `SkeletonChartRectangle`) | Epic 10 Stories 10-3/10-4 (Epic 1D uses `EmptyStatePlaceholder` / `ErrorStatePlaceholder` from 1d-1 until then) | Universal state palette ships with polish epic |
| `AIInsightShell` | Epic 4 Story 4-3 OR Epic 6 Story 6-2 | AI-consuming epic owns the shell |
| `DataListTable` + `FilterChipBar` + `Pagination` wrapper + 5 recurring usage shells | Epic 3 Story 3-1 (first consumer) + DoD propagation | Information-architecture decision belongs with first feature |
| `GradingQueueShell` (UX-DR23 bulk-review) | Epic 6 Story 6-1 | Grading queue is feature-coupled |
| Drawer/Sheet chrome + 3 Modal patterns + RHF + Zod wrappers (`FormFieldWrapper`, `FormSection`), `BrandColorPicker`, `AssignChip`, `TaskChecklistItem` inline editor | Epic 2 Story 2-3a (canonical RHF wrapper) + Epic 2 Stories 2-1/2-2/2-4 (inline editors) | Onboarding is the first consumer of every wrapper |
| `ClassDetailTabsShell` | Epic 3 Story 3-2 | Class detail owns it |
| `SessionScheduleCalendar` + library decision spike (widened to 2 days + RRULE-fit per Winston/Murat) | Epic 3 Story 3-4 | Schedule workspace owns the library decision |
| `ScheduleEditModal` + `RecurrenceScopeConfirm` | Epic 3 Stories 3-4/3-5 | Session creation/edit owns them |

Phase 4 components remain deferred to feature epics 5/6/7 for behavior — BUT 1d-4 (Phase 4 visual bridge) ships their **static visual shells** in Epic 1D so the designer can iterate on the visual identity during the epic. The behavior (autosave, anchor persistence, audio playback, AI overlays) stays in Epics 5/6/7.

Effort under Path B: ~22–28 dev-days for Epic 1D (down from 32–42 original estimate).

## Summary

| Phase | Tier | Count | Approx. effort (dev-days, rough) |
|---|---|---|---|
| 1 | `ui/` shadcn primitives | 32 | 6–8 (mostly CLI installs + token theming + story scaffolds) |
| 2 | `domain/` visual + structural | 27 | 14–18 |
| 3 | `domain/` form + data | 18 | 12–16 |
| 4 (deferred) | `features/<area>/components/` | 19 | n/a — ships with feature epics |
| **Total catalogued** | — | **96** | **32–42 dev-days for Epic 1D** |

The 93 mockups reveal a relatively small but high-fidelity component vocabulary built on a paper-coloured editorial aesthetic (Fraunces display + Geist body, amber/blue accents). The largest complexity hotspots are the **anchored-comment surfaces** (writing grading `s23`, speaking grading `s24`, anchored Q&A sidebar `s18`/`s36`) and the **adaptive student attempt shell** (`s33`/`s34`) — all four are span- or timestamp-anchored interactions that emerge from real-time autosave, selection tracking, and AI-suggested overlays. These are correctly deferred to feature epics 5–7.

The shadcn primitive set is conventional (Table, Tabs, Dialog, Drawer, Form, Badge, Tooltip, ScrollArea, Command, Avatar, Skeleton, Progress, etc.) — Phase 1 is mostly install-and-theme work. Phase 2 is dominated by the **app-shell stack** (sidebar with role-variant nav, breadcrumb topbar, week strip, action rail) and **status-rich data primitives** (PerfPill, BandPill, SubmissionPill, SkillTag, MetricBox) that appear on every operator surface. Phase 3 is where novel data composites live: the **`DataListTable`** that recurs across Classes/Students/Staff/Exercises/Invoices indexes, **`ClassDetailTabsShell`** with five interchangeable tab payloads, and the **`SessionScheduleCalendar`** (Day/Week/Month + mini-month) which has no shadcn equivalent.

Role variants concentrate in the **`SidebarShell`** (Owner/Admin/Teacher/Student nav sets differ), the **`AppShell`** itself (mobile uses bottom tab bar not sidebar), **`DashboardHero`** (Owner/Teacher/Student each render different KPIs), **`AnalyticsScope`** (teacher = own; admin/owner = center-wide), and the **`InboxRowList`** (per-role row types & filter chips). Plan-limit and billing components (`PlanUsageMeter`, `PlanCard`, `BillingGraceBanner`) are Owner-only. Mobile is purpose-designed: at least 6 components in Chapter 8 need dedicated mobile variants rather than responsive squish, especially the writing surface, anchored Q&A (chat-bubble pattern), and tab-bar navigation.

Empty states (`s53`–`s62`) consolidate well into a single `EmptyState` variant with role decorator. Error states (`s63`–`s67`) split into 3 distinct shapes: form-validation (banner + inline), locked-content (read-only strip + unlock paths), and permission-denied (full-page).

---

## Chapter 1 — Onboarding (s00-s09)

| Component | Tier | Phase | Complexity | First seen | Reused in | States | Role variants | Notes |
|---|---|---|---|---|---|---|---|---|
| OnboardingShell | domain | 2 | M | s00 | s01-s08 | default | none | Centered hero layout, top bar with brand + autosave indicator, no sidebar yet — distinct from `AppShell` |
| PersonaPickCard | domain | 2 | M | s00 | — | default | none | 3-up illustrated card pick (Operator/Solo/Founder); SVG illustrations + selected hover state |
| StepProgressDots | domain | 2 | S | s01 | s02, s03, s05 | default | none | "Step 2 of 4" with done/active/pending dots — persona-aware total |
| SetupCard | domain | 2 | M | s01 | s02, s03, s05, s07, s08 | default | none | Standard sheet container with head (eyebrow + title + sub), body, foot (back/skip/save → next caption) |
| BrandColorPicker | domain | 3 | M | s01 | s49 | default | none | Auto letter-mark preview + 6 color swatches + "upload logo" affordance |
| TemplateStarterCard | features | 4 | M | s02 | s07 | default | none | DEFER → epic-2 classes: starter template tile, IELTS-skill-tagged, picks suggested templates |
| ClassRowEditor | features | 4 | L | s03 | s08 | default | none | DEFER → epic-2 onboarding spawn: inline class-creation row with cohort name + start date + teacher (with inline-invite chip) + student emails |
| AssignChip | domain | 3 | S | s03 | s08, s41 | default, empty | none | Avatar + name pill; empty variant = "Assign or invite a teacher" |
| ImportBanner | domain | 2 | S | s02 | s07 | default | none | "Have existing data?" banner with action link |
| DoneHeroPanel | domain | 2 | M | s04 | s06 (solo) | default | none | Big checkmark + name-em headline + summary stat tiles + primary CTA |
| FinishSetupCard | features | 4 | L | s09 | — | default, progress | persona | DEFER → epic-2 dashboard handoff: pinned dashboard card with progress meter + task list (done/required/optional) + snooze/dismiss |
| TaskChecklistItem | domain | 3 | M | s09 | s53 | default, done | none | Icon + name + ft-badge + arrow row used in finish-setup and day-1 empty dashboards |

---

## Chapter 2 — Teacher (s06-s28, s10a)

| Component | Tier | Phase | Complexity | First seen | Reused in | States | Role variants | Notes |
|---|---|---|---|---|---|---|---|---|
| AppShell | domain | 2 | M | s06 | every desktop screen | default, loading | yes | Sidebar (220px) + main grid; persistent across all post-onboarding screens |
| SidebarShell | domain | 2 | L | s06 | every desktop screen | default | **yes — owner/admin/teacher/student** | Brand, nav groups (Workspace/Resources/Center settings), nav items with badge counts, user pill at bottom; nav set + groups vary per role |
| SidebarNavItem | domain | 2 | S | s06 | every screen | default, active, with-badge | none | Icon + label + optional unread/count badge |
| UserPill | domain | 2 | S | s06 | every desktop screen | default | none (role label data-driven) | Avatar + name + role label at sidebar foot |
| TopbarShell | domain | 2 | M | s06 | every desktop screen | default | none | Crumbs (left) + actions (right: search + section CTAs) |
| BreadcrumbBar | domain | 2 | S | s06 | every screen | default | none | `Workspace / Section / current` with `sep` separator |
| SearchPill | domain | 2 | S | s06 | every desktop screen | default | none | "Search" + ⌘K kbd hint (palette UI lives in Command primitive) |
| PageHead | domain | 2 | S | s06 | every screen | default | none | H1 + count + sub line layout |
| DashboardHero | domain | 2 | M | s06 | s29, s48 | default, loading, empty | **yes — owner/teacher/student** | "Good morning, X" + day/session sub; per-role copy & metrics |
| WeekStrip | domain | 2 | L | s06 | s82 (mobile) | default, loading, empty | none | 7-day glance card; today/next/cancelled/amber session pills; read-only — distinct from full `SessionScheduleCalendar` |
| ActionRail | domain | 2 | M | s06 | s09, s46, s48 | default, empty | none | Stack of `ActionCard`s for grading/questions/at-risk lists |
| ActionCard | domain | 2 | M | s06 | s09, s46, s48 | default, empty | none | Head with title + count + foot link; rows = avatar + main + meta |
| ActionRow | domain | 2 | S | s06 | s09, s46, s48 | default | none | Compact list row: avatar + name/sub + meta tag |
| AvatarStack | ui | 1 | S | s06 | s06, s09, s10, etc. | default | none | shadcn Avatar primitive — colored a1..a6 variants |
| PerfPill | domain | 2 | S | s07 | s08, s09, s10, s42, s50 | default | none | Status pill: Good/Normal/At-risk/Paused/Active/Upcoming/Ended; semantic colors |
| BandPill | domain | 2 | S | s01 | s07, s08, s35, s46, s47 | default | none | "Band **6.5**" — used for class target, student current/target, assignment band |
| SkillTag | domain | 2 | S | s07 | s09, s15, s26, s37, s46 | default | none | Writing/Reading/Listening/Speaking/Vocab/Grammar/General colored tags |
| SubmissionPill | domain | 2 | S | s08 | s09, s50, s35 | default | none | "3 pending", "All in", "Graded", "1 missed", "Next", "Upcoming", "Completed" |
| StatusPill | domain | 2 | S | s08 | s11, s12, s39 | default | none | Active/Paused/Upcoming/Ended/Present/Absent base status pill |
| StatBox | domain | 2 | S | s08 | s10, s12, s46, s47 | default, loading | none | Label + value + delta (▲/▼/neutral); KPI tile |
| DashStat | domain | 2 | S | s09 | s46, s47, s48 | default, loading | none | Larger variant for top-of-page stat bar (ds-label + ds-value + ds-flag) |
| DataListTable | domain | 3 | L | s07 | s09, s10, s12, s15, s19, s26, s28, s39, s42, s50, s70 | default, loading, empty, error | none | Generic table shell: filter row (tabs + chips) + thead + tbody + row actions; the workhorse list pattern |
| FilterRow | domain | 3 | M | s07 | s09, s15, s26, s28, s39, s42, s50 | default | none | Tabs (with count) + filter chips with carets + sort chip + right-side CTAs |
| TableTabs | domain | 3 | M | s07 | s08, s09, s11, s28, s39 | default | none | Inline tab strip with count badges (All/Active/At-risk/etc.) |
| TabStrip | domain | 2 | M | s08 | s09, s11, s37, s47, s69 | default | none | Detail-page tab strip with optional badge-num; wraps shadcn Tabs |
| RowActionsCluster | domain | 3 | S | s07 | s15, s19, s28, s39, s70 | default | none | Edit/Duplicate/More icon button cluster in last column |
| EntityCell | domain | 3 | S | s07 | s15, s19, s28, s39 | default | none | Icon tile + name + meta sub stacked cell (ex-cell pattern) |
| StudentCell | domain | 3 | S | s08 | s09, s10, s12, s42 | default | none | Avatar + name + email cell |
| ProgressBar | ui | 1 | S | s07 | s09, s33, s35, s37, s46, s69, s74 | default | none | Plain shadcn Progress primitive (used for sessions, AI usage, plan limits) |
| ClassDetailShell | domain | 2 | M | s08 | s09, s11 | default | none | Detail-head (crumb back + h1 + icon + meta-line + stats) + tab strip + body-grid (main + side); reused across class/session/student detail |
| DetailHead | domain | 2 | M | s08 | s10, s12, s27, s40, s47 | default | none | Crumb-back + h1 with icon-lg + status pill + meta-line + stat-box row |
| SideCard | domain | 2 | S | s08 | s10, s12, s47 | default | none | Info-row stack pattern in right rail (label + value rows) |
| NoteBox | domain | 2 | S | s08 | s12 | default | none | Bordered prose block for class info or session notes |
| SkillPerfBars | domain | 2 | M | s08 | s37, s47 | default, loading | none | Stack of label + bar + value rows for "Avg band by skill" |
| AssignmentNameCell | domain | 3 | S | s08 | s09, s35, s50 | default | none | Bold name + assignment-type sub |
| MonthCalendar | domain | 2 | L | s11 | s32 (student variant) | default, loading, empty | none | Mon-Sun grid with mc-cells, today highlight, sess-chip overlays; smaller than full Schedule |
| SessionChip | domain | 2 | S | s11 | s13, s14, s32 | default, past, next, cancelled | none | Inline session badge with time + name; states drive border-left color |
| RecurrenceBanner | domain | 2 | S | s12 | s14 | default | none | "Wed/Sat recurring · edits prompt scope" advisory strip |
| ApplyToScopeOptions | domain | 3 | M | s14 | — | default | none | Radio group for "this / following / all" recurrence delete scope |
| AttendanceToggle | domain | 3 | S | s12 | — | default | none | Present/Absent/Late segmented control per roster row |
| RosterTable | domain | 3 | M | s12 | s55 (empty) | default, loading, empty | none | Specialized DataListTable for participants + attendance |
| LinkCard | domain | 2 | S | s09 | s12, s27 | default | none | File/exercise/lesson link card with icon + name + meta + tag |
| SessionScheduleCalendar | domain | 2 | XL | s13 | — | default, loading, empty | none | Full Day/Week/Month workspace: mini-month nav, legend, all-day strip, week-grid w/ hour rows, wk-session blocks; novel — no shadcn equivalent |
| MiniMonthNavigator | domain | 2 | M | s13 | — | default | none | Compact month grid w/ dow-headers + day cells (muted/has/sel/today states) |
| CalendarLegend | domain | 2 | S | s13 | — | default | none | "My classes" colored swatches + counts |
| ViewToggle | domain | 2 | S | s13 | s11, s69 | default | none | Day/Week/Month segmented toggle (wraps shadcn ToggleGroup) |
| ScheduleToolbar | domain | 2 | M | s13 | — | default | none | Arrow nav + Today + period + filters + view toggle |
| WeekGridSession | domain | 2 | M | s13 | — | default | yes (next/amber/green/crimson) | Positioned session block w/ time + name; color-by-class |
| SessionModal | domain | 3 | L | s14 | — | default, error | none | Edit-session modal: name/type/date-time/participants/location/recurrence/color + delete-scope expander; uses shadcn Dialog |
| ExerciseEditorShell | features | 4 | XL | s16 | s17 | — | none | DEFER → epic-3 exercises: section/question-group editor with inline AI affordances, drag/drop ordering |
| AIDialog | domain | 3 | L | s17 | — | default, loading, error | none | Generate-with-AI modal: type chips + topic textarea + parameter chips + preview + credits foot; same shell, different fields per trigger |
| AICredits | domain | 2 | S | s17 | s69 | default | none | "3 of 50 monthly AI credits used" mono inline indicator |
| AnchoredQuestionsRailShell | domain | 2 | L | s18 | s36 | default, empty | yes (teacher/student) | Sticky right rail container with rail-head (count + filter) and inner stack; layout-only |
| AnchoredQuestionCard | features | 4 | XL | s18 | s36, s80 | default, focused, resolved, ai-suggested, compose | yes (teacher answer / student ask) | DEFER → epic-7 anchored-qa: anchor pill (item/whole-exercise), avatar+who+time, body, reply-box, visibility toggle, batch-select, AI suggestion variant — anchor logic is feature-coupled |
| QuestionAnchorPin | features | 4 | M | s18 | s23, s33, s36 | default, focused | none | DEFER → epic-7: orange/blue dot anchored to text span/item; clicking focuses card in rail |
| QuestionAnchorHighlight | features | 4 | M | s18 | s23, s33, s36 | default, active | none | DEFER → epic-7: yellow/red/green/blue text-highlight applied to anchored span |
| AIRailStrip | domain | 2 | M | s18 | s23, s24 | default | none | Top-of-rail summary with AI mark + counts + "Accept all praise / Review one by one" CTAs |
| BatchActionBar | domain | 3 | M | s18 | — | default | none | "N selected · similar Q3" batch reply / resolve action strip |
| ExerciseSectionCard | features | 4 | L | s16 | — | — | none | DEFER → epic-3 exercises: section card w/ ordered question groups + section actions |
| TemplateDetailShell | features | 4 | L | s20 | s21 | — | none | DEFER → epic-2 templates: class-info head + sessions list (each session w/ title/desc/documents/exercises) |
| WritingGradingSurface | features | 4 | XL | s23 | — | — | none | DEFER → epic-6 grading: Docs-style annotated essay w/ span-anchored comments (error/praise/suggestion), AI per-comment review strip, band-score grid pinned-to-criterion, overall feedback rail |
| WriteDocSurface | features | 4 | XL | s23 | s34, s78 | default, autosaving, error | none | DEFER → epic-5 writing attempt: WYSIWYG editor w/ toolbar (B/I/U/lists/undo/redo), wd-page paragraphs, autosave status, word counter, paragraph + reading-level meta |
| BandScoreGrid | domain | 2 | M | s23 | s24, s35 | default | none | 4-criterion band cells (Task response/Coherence/Lexical/Grammar OR Fluency/Lexical/Grammar/Pronunciation) with "N pinned" annotation + overall band aggregate; **named BandScoreChart in project convention** |
| AIGradingSuggestion | domain | 3 | L | s23 | s24, s25 | default, loading | none | Full-width AI suggestion strip: AI mark + bands + freeform feedback + accept/edit/dismiss actions + disclaimer |
| FeedbackQuoteBox | domain | 2 | S | s23 | s24, s35 | default | none | Editorial italic block for overall feedback text |
| SpeakingGradingSurface | features | 4 | XL | s24 | — | — | none | DEFER → epic-6 grading: AudioPlayer + timestamped-notes thread (timestamps pinned to waveform clicks) + AI flagged moments + speaking-bands grid |
| AudioPlayer | features | 4 | L | s24 | s27, s33 (listening), s79 | default, playing, loading | none | DEFER → epic-6 grading: play btn + waveform (played/unplayed bars) + time read-out + speed; click-to-pin gesture |
| TimestampedNote | features | 4 | M | s24 | s79 | default, ai-suggested | none | DEFER → epic-6 grading: timestamp pill + criterion tags + body; pinned to audio moment |
| AutoGradeReviewShell | features | 4 | L | s25 | — | — | none | DEFER → epic-6 grading: question-by-question correct/incorrect review w/ override + release controls |
| TemplateStarterGrid | features | 4 | M | s02 | s07 | — | none | DEFER → epic-2 templates: 2x3 starter card grid w/ "+ Build from scratch" tile |
| KnowledgeHubBrowser | domain | 2 | L | s26 | s59 (empty) | default, loading, empty | none | Folder tree (left) + hub-grid (right) of folder/file tiles; folder-crumb path bar above |
| FolderTreeItem | domain | 2 | S | s26 | — | default, active, with-count | none | Folder tree row (▸/▾ + name + count); supports child/child2 nesting |
| FolderCrumb | domain | 2 | S | s26 | — | default | none | Inline folder breadcrumb (Knowledge hub / Reading / Environment) |
| HubFileTile | domain | 2 | M | s26 | — | default | none | File card: type-iconed top + tags + foot (linked-status + modified date); folder variant |
| DocumentPreview | features | 4 | L | s27 | — | — | none | DEFER → epic-4 knowledge-hub: file-type-adaptive preview (PDF page render / audio player / passage prose); not built ahead |
| ArchiveBrowser | domain | 3 | M | s28 | s60 (empty) | default, empty | none | DataListTable + tabs (Classes/Sessions/Exercises/Templates) + duplicate/edit-copy row actions |

---

## Chapter 3 — Student (s29-s38)

| Component | Tier | Phase | Complexity | First seen | Reused in | States | Role variants | Notes |
|---|---|---|---|---|---|---|---|---|
| StudentSidebarShell | domain | 2 | M | s29 | s30-s38 | default | data-driven variant of `SidebarShell` | Student nav set; fewer items, no Resources group |
| StudentDashboardHero | domain | 2 | M | s29 | s62 (empty) | default, empty | none | "Hi Duc" + due-now card + recent activity + band trajectory peek |
| DueNowCard | domain | 2 | M | s29 | s74 (mobile variant) | default | none | Red-bordered hero card w/ countdown pill + assignment title + progress bar + Continue-writing CTA |
| StudentClassCard | domain | 2 | M | s30 | s77 (mobile) | default | none | Class card w/ identity + schedule + own progress (sessions left, assignments due, band) |
| ExerciseAttemptShell | features | 4 | XL | s33 | — | default, autosaving | none | DEFER → epic-5 attempts: question navigator side rail + adaptive variant body (A: Q answering, B: writing, C: speaking) + time-left meter |
| QuestionNavigatorRail | features | 4 | M | s33 | — | default | none | DEFER → epic-5: numbered dots (done/current/flagged/pending) for jumping between exercise items |
| ChoiceOption | features | 4 | S | s33 | — | default, picked | none | DEFER → epic-5: MCQ choice row w/ key letter + label |
| GapInput | features | 4 | S | s33 | — | default, filled | none | DEFER → epic-5: inline gap-fill text input |
| RecordingButton | features | 4 | L | s33 | s85 (mobile) | default, recording, paused, stopped | none | DEFER → epic-5: large round record button + state label + timer |
| SubmissionResultShell | domain | 2 | L | s35 | s79 (mobile) | default | none | Band-hero (overall band + target + delta) + per-criterion breakdown + anchored teacher feedback inline |
| StudentPerformanceDashboard | features | 4 | L | s37 | s57 (empty), s81 (mobile) | default, empty | none | DEFER → epic-8 analytics: Overview + Patterns tabs; softened framing per IA |
| ProfileSettingsShell | domain | 3 | M | s38 | — | default | none | Common to all roles, drawn in student shell: account / notifications / preferences sections |

---

## Chapter 4 — Admin & Owner (s39-s44)

| Component | Tier | Phase | Complexity | First seen | Reused in | States | Role variants | Notes |
|---|---|---|---|---|---|---|---|---|
| OwnerSidebarShell | domain | 2 | M | s39 | s40-s44, s48, s49, s68-s73 | default | data-driven variant of `SidebarShell` | Adds "Center settings" group + Settings nav item |
| StaffDataTable | domain | 3 | M | s39 | — | default, loading, empty | none | DataListTable specialization: columns role/classes/load/status/last active + invite CTA |
| LoadMeter | domain | 2 | S | s39 | s40, s69 | default | none | Inline load bar (% of teacher capacity); also reused as plan-usage variant |
| StaffDetailShell | domain | 3 | M | s40 | — | default | none | DetailHead + profile / role / classes / schedule glance / load / activity sections |
| InviteStaffModal | domain | 3 | M | s41 | — | default, error | yes (Owner sees Owner chip; Admin doesn't) | shadcn Dialog: email field + role chips (Teacher/Admin/Owner) + send CTA |
| RoleChipGroup | domain | 3 | S | s41 | s44 | default, disabled | yes | Selectable role chips with permission-driven enable state |
| EnrolmentComposer | features | 4 | L | s43 | — | — | none | DEFER → epic-4 people: add/transfer/withdraw compose row + history list |
| PermissionsMatrix | features | 4 | L | s44 | — | — | owner-only | DEFER → epic-4 people: role × capability matrix w/ read-only and editable cells |

---

## Chapter 5 — Across roles (s45-s49)

| Component | Tier | Phase | Complexity | First seen | Reused in | States | Role variants | Notes |
|---|---|---|---|---|---|---|---|---|
| AnalyticsHomeShell | domain | 2 | M | s45 | — | default, empty | yes (teacher = own; admin/owner = center-wide) | Two-card branch: Class performance / Student performance |
| ScopeBar | domain | 2 | S | s46 | s47 | default | yes (role-scoped chips) | Inline scope filters: class/student/time-window chips + right-side count summary |
| BandTrendSparkline | domain | 2 | M | s08 | s37, s46, s47, s74 (mobile) | default, loading, empty | none | Bar-spark "Cohort band — last 8 weeks" w/ week labels and delta footer; **`BandTrendChart`** in code |
| SkillWeekHeatmap | domain | 2 | L | s46 | — | default, loading, empty | none | Skill × week grid w/ v1..v5 intensity cells; ~32+ cells, accessible color scale |
| MistakeRow | domain | 3 | M | s46 | s47 (mistakes tab) | default | none | Icon + name + tags + sub + frequency + trend (▲/▼/→) row |
| AICohortInsight | domain | 3 | M | s46 | s23, s24 | default | none | AI suggestion variant: cohort-scope insight w/ "Apply to all N" CTA |
| StudentMistakesList | features | 4 | M | s47 | — | — | none | DEFER → epic-8 analytics: errors/praise tabs w/ comment quotes |
| RecommendationsList | features | 4 | M | s47 | — | — | none | DEFER → epic-8 analytics: linked exercises + Knowledge hub materials based on student patterns |
| OwnerDashboardHero | domain | 2 | M | s48 | — | default, loading | yes | Center-pulse dashboard differs from teacher's `s06` — KPIs include teachers/students/revenue/inbox |
| CenterSettingsShell | domain | 3 | M | s49 | — | default | owner-only | Tabbed settings page: profile/term calendar/integrations/rooms/re-open-setup link |
| TermCalendarEditor | features | 4 | M | s49 | — | — | owner-only | DEFER → epic-4 settings: term boundary editor; specialized form |

---

## Chapter 6 — Inbox · Empty · Error (s50-s67)

| Component | Tier | Phase | Complexity | First seen | Reused in | States | Role variants | Notes |
|---|---|---|---|---|---|---|---|---|
| InboxListShell | domain | 3 | L | s50 | s51, s52, s56, s75, s84 | default, loading, empty | **yes — teacher / student / admin-owner** | Per-row row-type tabs (Questions/Submissions/Late/Mentions vs Replies/Grades/Class vs Enrolment/Staff/Integration/Billing); row actions differ per role |
| InboxRow | domain | 3 | M | s50 | s51, s52, s56, s75, s84 | default, unread, archived | yes (action set per role) | Avatar + main(title/sub) + meta(time) + per-row actions (Grade/Reply/Archive) |
| EmptyState | domain | 2 | M | s53 | s54-s62, all 0-data states | default | yes (role tone) | Icon + em-titled headline + paragraph + actions; small generic variant (s54) and rich-guided variant (s53 day-one 3-step start) |
| EmptyDashboardSteps | domain | 2 | M | s53 | s62 | default | yes (teacher / student) | 3-step card row: Done / Active / Pending — day-one welcome |
| GhostedChartFrame | domain | 2 | S | s57 | s61 | empty | none | Dashed-line chart frame placeholder for "no data yet" analytics empties |
| ErrorState | domain | 2 | M | s63 | s64, s67 | default | none | Generic error layout: icon + headline + human message + primary recovery action |
| LatePenaltyBreakdown | features | 4 | M | s63 | — | — | none | DEFER → epic-5 assignments: graded band - penalty = final, with explainer |
| LockedSubmissionState | features | 4 | M | s64 | — | — | none | DEFER → epic-5 assignments: read-only essay view + "request extension" CTA |
| FormValidationBanner | domain | 3 | M | s65 | — | default | none | Top-of-form summary banner w/ enumerated issues |
| InlineFieldError | domain | 3 | S | s65 | every form | default | none | Per-field inline error message + red-bordered input state |
| ReadOnlyStrip | domain | 3 | M | s66 | — | default | none | "Locked because grades finalized" + unlock-path explainer strip |
| UnlockPathsCard | features | 4 | M | s66 | — | — | none | DEFER → epic-3 exercises: clone-and-edit vs unfinalize-cohort two-up |
| PermissionDeniedState | domain | 2 | M | s67 | — | default | yes (which role hit it) | Full-page denial: icon + "Permission denied" + explainer + back-to-allowed-page CTA |

---

## Chapter 7 — Billing (s68-s73)

| Component | Tier | Phase | Complexity | First seen | Reused in | States | Role variants | Notes |
|---|---|---|---|---|---|---|---|---|
| PlanCard | domain | 2 | M | s68 | s71 | default, current, recommended | owner-only | Plan tier card: name + sub + price + cta + feature list (with disabled rows); flags for "Current plan" / "For growing centers" |
| BillingPeriodToggle | domain | 3 | S | s68 | — | default | owner-only | Monthly/Annual segmented toggle w/ "Save 2 mo" pill |
| BillingDashboardShell | domain | 2 | L | s69 | — | default, loading | owner-only | Top row (plan card + next invoice) + usage meters + recent invoices; tabbed (Overview/Plans/Invoices/Payment/Tax) |
| NextInvoiceCard | domain | 2 | M | s69 | — | default | owner-only | Date + amount + line items + payment method strip |
| PlanUsageMeter | domain | 2 | M | s69 | s72 | default, warn, critical | owner-only | Label + value (`N of M · X%`) + bar + optional warning sub; named in project conventions |
| UsageMetersGrid | domain | 2 | M | s69 | — | default | owner-only | 2-col grid of PlanUsageMeter w/ updated-meta header and roll-up commentary |
| InvoiceTable | domain | 3 | M | s69 | s70 | default, empty | owner-only | DataListTable variant: date/description/amount/status/payment/actions columns |
| InvoiceStatusPill | domain | 2 | S | s70 | — | default (paid/declined/refunded/upcoming) | owner-only | Specialized StatusPill for invoice states |
| UpgradeModal | domain | 3 | L | s71 | — | default, loading | owner-only | shadcn Dialog: Pro→Studio diff + prorated math + confirm CTA; triggers from s68/s65/s69 |
| PlanLimitSoftBanner | domain | 2 | S | s72 | — | default | owner-only | Non-blocking yellow banner: "approaching N students" + upgrade link |
| BillingGraceBanner | domain | 2 | M | s73 | every page when active | default | owner-only | Red top strip on every page during 7-day grace; payment-declined messaging + Update CTA |

---

## Chapter 8 — Mobile (s74-s87)

| Component | Tier | Phase | Complexity | First seen | Reused in | States | Role variants | Notes |
|---|---|---|---|---|---|---|---|---|
| MobileAppShell | domain | 2 | M | s74 | s75-s86 | default | yes (student / teacher / owner) | Phone-status + m-topbar + phone-body + m-tabbar — replaces desktop SidebarShell |
| MobileTopbar | domain | 2 | S | s74 | every mobile screen | default | none | Day eyebrow + title + right icons (search + inbox w/ red dot) |
| MobileTabBar | domain | 2 | M | s74 | every mobile screen | default | yes (5-tab set varies per role) | Bottom tab bar: Home/Assignments/Inbox/Classes/Me (student) — different set per role |
| MobileTab | domain | 2 | S | s74 | every mobile screen | default, active, with-badge | none | Icon + label + optional red-dot badge |
| MobileSectionHead | domain | 2 | S | s74 | every mobile screen | default | none | "This week / Recent activity" header + see-all link |
| MobileListRow | domain | 2 | S | s74 | s75, s76, s84 | default, unread | none | Icon + body(title/sub) + when/pill |
| MobilePill | domain | 2 | S | s74 | s75-s86 | default, due, soon, draft, urgent | none | Compact pill: "Due in 14h", "Due Fri", "Not started" |
| MobileDueNowHero | domain | 2 | M | s74 | — | default | student | Red-bordered hero card w/ pill + class label + title + sub + progress + CTA |
| MobileSwipeRow | features | 4 | L | s75 | — | default, swiping, revealed | none | DEFER → epic-9 mobile: gesture-driven row that reveals Archive on swipe |
| MobileFilterChipScroll | domain | 2 | S | s75 | — | default | none | Horizontal-scroll filter chip row (vs wrap on desktop) |
| MobileWritingSurface | features | 4 | XL | s78 | — | default, autosaving | none | DEFER → epic-5 writing attempt: phone-sized writing canvas + sticky bottom word-counter bar; distinct from desktop WriteDocSurface |
| MobileResultHero | features | 4 | L | s79 | — | — | none | DEFER → epic-5 result: band hero (giant overall) + per-criterion grid + anchored comments INLINE (not side rail) |
| MobileQAThread | features | 4 | L | s80 | — | — | none | DEFER → epic-7 anchored-qa: chat-bubble pattern (vs Docs rail on desktop); inline composer at bottom |
| MobilePerformanceGlance | domain | 2 | M | s81 | — | default, empty | student | Glance-not-work performance view: band hero + sparkline + 2-3 pattern cards |
| MobileTeacherDashboard | domain | 2 | M | s82 | — | default | teacher | Triage view: next session card + needs-grading count + at-risk list |
| MobileClassHealthCard | domain | 2 | M | s83 | — | default | teacher | Attendance/on-time/avg-band three-metric card for class health |
| MobileInboxQuestionsFilter | domain | 2 | S | s84 | — | default | teacher | Prominent Questions filter chip in teacher mobile inbox |
| MobileQuestionReplyComposer | features | 4 | L | s85 | — | — | none | DEFER → epic-7 anchored-qa: inline composer + AI-suggest bottom sheet |
| MobilePushApproveCard | features | 4 | M | s86 | — | — | owner | DEFER → epic-4 people: enrolment approve from push notification — deep-link landing surface |
| MobileCoverageMap | n/a | n/a | n/a | s87 | — | — | none | Documentation/meta screen — not a runtime component |

---

## Deferred to feature epics

| Component | Defer target | Reason |
|---|---|---|
| WriteDocSurface (Docs-style editor, autosave, draft recovery) | epic-5 (5-3 writing attempt) | Behavior emerges from real-time autosave + selection tracking + draft recovery; the surface only works once paired with the persistence layer |
| WritingGradingSurface (span-anchored comments) | epic-6 (6-1 writing grading) | Span-anchor logic requires the submitted-essay data model; AI per-comment review is feature-coupled |
| SpeakingGradingSurface (timestamp-pinned feedback) | epic-6 (6-3 speaking grading) | Click-waveform-to-pin gesture and timestamp-anchored thread are unique to the audio data model |
| AudioPlayer (waveform + click-to-pin) | epic-6 grading (shared w/ s33 listening) | Waveform rendering + pin-emit behaviour is shared but lives near grading; consume via shared subpackage |
| TimestampedNote | epic-6 grading | Coupled to AudioPlayer timeline; same epic |
| AutoGradeReviewShell | epic-6 grading (6-2 auto grade review) | Question-by-question override + release is bound to the auto-grading data model |
| ExerciseAttemptShell (3 variants A/B/C) | epic-5 (5-2/5-3/5-4 attempts) | Adaptive routing between MCQ/writing/speaking is an attempt-domain concern, not a generic shell |
| QuestionNavigatorRail / ChoiceOption / GapInput / RecordingButton | epic-5 attempts | Specific to attempt interaction model |
| AnchoredQuestionCard | epic-7 (7-4 anchored Q&A) | Anchor target (item / span / whole-exercise), visibility toggle, batch handling — all feature-coupled |
| QuestionAnchorPin / QuestionAnchorHighlight | epic-7 anchored-qa | Selection-tracking + scroll-into-view behavior owned by Q&A feature |
| ExerciseEditorShell / ExerciseSectionCard | epic-3 (3-1 exercises editor) | Drag/drop section ordering, AI-insert flows, publish/draft states — editor is feature-locked |
| TemplateStarterGrid / TemplateStarterCard | epic-2 (2-1 templates) | Starter templates are seeded data + class-builder logic |
| ClassRowEditor (onboarding inline spawn) | epic-2 (2-2 onboarding handoff) | Inline-invite chip + class-from-template generation = feature behavior |
| FinishSetupCard | epic-2 onboarding handoff | Task list + progress + snooze/dismiss + persona-task-set — feature-coupled |
| TemplateDetailShell | epic-2 templates | Session-list-of-{title, desc, documents, exercises} editor |
| DocumentPreview | epic-4 (4-2 knowledge-hub) | File-type-adaptive preview is per-mime renderer code |
| EnrolmentComposer | epic-4 (4-3 enrolment) | Add/transfer/withdraw is enrolment-domain state machine |
| PermissionsMatrix | epic-4 (4-4 roles & permissions) | Matrix data + edit rules = permissions feature |
| TermCalendarEditor | epic-4 settings | Term boundary semantics |
| StudentMistakesList / RecommendationsList | epic-8 analytics | Pattern engine + recommendation engine — backend-driven |
| StudentPerformanceDashboard | epic-8 analytics | Patterns view aggregates from mistakes service |
| LatePenaltyBreakdown / LockedSubmissionState | epic-5 assignments | Both depend on submission state machine |
| UnlockPathsCard | epic-3 exercises | Clone-vs-unfinalize is an exercise lifecycle action |
| MobileSwipeRow | epic-9 mobile (or per-feature mobile variant) | Gesture system is cross-cutting and ships with mobile epic |
| MobileWritingSurface | epic-5 writing attempt (mobile variant) | Phone-sized writing canvas paired with desktop counterpart |
| MobileResultHero | epic-5 result (mobile variant) | Anchored-comments-inline (not rail) variant of submission result |
| MobileQAThread / MobileQuestionReplyComposer | epic-7 anchored-qa (mobile variant) | Chat-bubble pattern + AI-suggest sheet = feature-coupled mobile surfaces |
| MobilePushApproveCard | epic-4 people (mobile entry) | Push-notification deep-link landing |

---

## Cross-cutting observations

### Shadcn primitives needed (Phase 1 install list)

Button, Input, Textarea, Select, Checkbox, RadioGroup, Switch, Label, Form (RHF), Dialog, AlertDialog, Drawer, Sheet, Popover, Tooltip, HoverCard, DropdownMenu, ContextMenu, Command (⌘K palette), Tabs, ToggleGroup, Toggle, Accordion, Collapsible, Avatar, Badge, Skeleton, Progress, Separator, ScrollArea, Table, Card, Sonner (toast), NavigationMenu (sidebar primitives optional), Pagination, Calendar, Slider. **~32 primitives**, all stock; Phase 1 work is mainly token theming (the editorial paper/ink palette + Fraunces/Geist font stack from the mockups must override default shadcn neutrals).

### Novel domain components without a shadcn equivalent

- **`SessionScheduleCalendar`** (s13) — Day/Week/Month workspace with mini-month nav, all-day strip, hour-grid + positioned session blocks. No shadcn primitive; will need a calendar library decision (or hand-built).
- **`MonthCalendar`** (s11) — Simpler month grid w/ session chips inside cells.
- **`WeekStrip`** (s06) — 7-day glance card w/ next-session highlight; lighter than the full calendar.
- **`BandScoreGrid` / `BandTrendSparkline` / `SkillWeekHeatmap`** — IELTS-specific scoring visualizations.
- **`AnchoredQuestionsRailShell`** (s18) — Docs-style sticky rail with anchored cards; layout shell is reusable even if the inner cards defer.
- **`AIRailStrip` / `AIGradingSuggestion` / `AICohortInsight`** — The AI-companion strips appear on grading + analytics + Q&A; consistent shell worth abstracting.
- **`PlanUsageMeter`** + **`UsageMetersGrid`** — Billing-specific but visually distinct from generic ProgressBar.
- **`KnowledgeHubBrowser`** (s26) — Folder-tree + file-tile pattern that no shadcn primitive covers.

### Components with role variants (need RoleGate or role decorator)

- `SidebarShell` — Owner/Admin/Teacher/Student nav set + group differences (Owner adds "Center settings"; Student drops "Resources" + "Analytics")
- `AppShell` — Mobile uses `MobileTabBar` not sidebar
- `DashboardHero` — Owner=center pulse (`s48`), Teacher=triage (`s06`), Student=due-now (`s29`)
- `AnalyticsHomeShell` / `ScopeBar` — Teacher = own classes; Admin/Owner = center-wide
- `InboxListShell` / `InboxRow` — Per-role row types + filter chips + row actions (teacher Grade/Reply, student see-grade, owner Approve)
- `InviteStaffModal` — Owner sees Owner chip; Admin doesn't
- `MobileAppShell` / `MobileTabBar` — Student/Teacher/Owner each have a different 5-tab set
- `PermissionsMatrix` — Owner-only
- All billing components (`PlanCard`, `BillingDashboardShell`, `BillingGraceBanner`, etc.) — Owner-only
- `OwnerSidebarShell` includes "Center settings" group not present in Teacher

**Recommendation:** Implement as data-driven (single component, role-aware props/config) rather than separate per-role components, with a Storybook `withRole` decorator. Exceptions where the layout fundamentally differs (mobile vs desktop) ship as separate components.

### Empty state consolidation

`s53–s62` cluster into **3 patterns**:
1. **Day-one guided start** (`s53` teacher dash, `s62` student dash) — 3-step card row; needs role variants → `EmptyDashboardSteps`
2. **Generic empty-with-action** (`s54` classes, `s55` students-in-class, `s58` questions, `s59` knowledge hub, `s60` archive) — icon + headline + 1-3 CTAs → single `EmptyState` component with variants
3. **No-data analytics** (`s57` my-performance, `s61` analytics) — ghosted chart frames overlaying real layout → `GhostedChartFrame` companion
4. **Per-role empty inbox** (`s56`) — 3 variants side-by-side documenting the pattern; ships as `InboxListShell` empty state with role decorator

### Error state shapes

`s63–s67` are NOT all the same shape:
1. **Form validation** (`s65`) — top banner + inline field errors + disabled save → `FormValidationBanner` + `InlineFieldError`
2. **Locked/finalized content** (`s66`) — readonly strip + unlock paths cards + greyed form → `ReadOnlyStrip` + feature-specific `UnlockPathsCard`
3. **Submission-state errors** (`s63` late-with-penalty, `s64` past-deadline) — assignment-specific, defer to epic-5
4. **Permission denied** (`s67`) — full-page → generic `PermissionDeniedState`

Expect **3 distinct `ErrorState`-family shapes** + 2 feature-coupled ones.

### Mobile — purpose-designed vs responsive

The 14 mobile screens are explicitly NOT responsive squishes. The following must ship as **dedicated mobile components**, not breakpoint variants:
- `MobileAppShell` + `MobileTabBar` (whole shell topology differs)
- `MobileQAThread` (chat bubbles vs Docs rail)
- `MobileResultHero` (inline anchored comments vs side rail)
- `MobileWritingSurface` (phone-sized canvas + sticky word counter)
- `MobileSwipeRow` (gesture-driven, no desktop analog)
- `MobileDueNowHero` (above-the-fold "what do I need to do?" framing)

The following CAN be responsive variants of their desktop counterpart (drive by Tailwind breakpoint + container query):
- `MobileListRow` ← responsive `InboxRow` / list cells
- `MobileSectionHead` ← responsive section title
- `MobilePill` ← responsive `Badge`
- `MobileFilterChipScroll` ← responsive `FilterRow` (horizontal scroll instead of wrap)
- `MobileTopbar` ← responsive `TopbarShell`
- `MobilePerformanceGlance` ← responsive student-perf component
- `MobileClassHealthCard` ← responsive class-detail summary

### Ambiguities & calls

- **`AppShell` vs `OnboardingShell`** — split as separate components since onboarding has no sidebar / different top-bar pattern.
- **`BandScoreGrid` vs `BandTrendSparkline` vs `SkillWeekHeatmap`** — three distinct chart components, not one. Project naming convention is `BandScoreChart` for the grid; renamed in this inventory for clarity.
- **`StatusPill` family** is sprawling — there is one base + at least 6 specialized children (`PerfPill`, `BandPill`, `SubmissionPill`, `InvoiceStatusPill`, plus inline attendance and session-chip status). Recommend a single composable `StatusPill` with `tone` + `variant` props, not 6 separate components.
- **`Sidebar` vs `SidebarShell`** — listed as `SidebarShell` here to match project conventions; this is the layout shell that wraps shadcn's sidebar primitives + the role-variant nav config.
- **AI strips** (`AIRailStrip`, `AIGradingSuggestion`, `AICohortInsight`) share visual DNA (gradient AI mark, accept/edit/dismiss, disclaimer). Consider unified `AISuggestionShell` w/ slot for body & action set — saves ~3 components if extracted well.
- **`MobileCoverageMap` (s87)** is a documentation surface, not a runtime component — excluded from the count.
