# Story 3.1 — Party-Mode Review Punch List

**Source:** roundtable review of `3-1-class-crud-lifecycle-and-creation-ui.md` (status: ready-for-dev)
**Reviewers:** 🏗️ Winston (arch) · 💻 Amelia (dev) · 🧪 Murat (test) · 📋 John (PM) · 🎨 Sally (UX)
**Date:** 2026-07-19
**Baseline:** dfa65f0

> Legend — **[BLOCK]** resolve before dev pickup · **[DECIDE]** Ducdo/product call, reverses or amends the spec · **[TIGHTEN]** spec clarification, dev can proceed once written · **[TEST]** test-plan change · **[UX]** design change.

---

## A. Blockers — lock before a dev starts (spec has no answer, or answers conflict)

1. **[BLOCK] Concurrent status-transition race (read-check-write).** *(Winston + Murat — both named it their #1.)*
   `TransitionStatus` validates current status, then issues a separate `UpdateClassStatus`. Two concurrent legal moves (`active→paused` and `active→ended`) both read `active`, both pass, second write wins silently and the audit trail shows an illegal-in-hindsight sequence.
   **Fix:** fold the guard into the write — `UPDATE ... WHERE id=$1 AND status=$expected`, `rowcount = 0` → `INVALID_STATUS_TRANSITION` (or 409); OR `SELECT ... FOR UPDATE` the row inside the same tx before validating. Affects Task 2 (`UpdateClassStatus` query) + Task 4 (`TransitionStatus`).
   Ripple: the same row lock gives `class.updated`'s before-image for the audit diff — decide the lock once, use it for both.

2. **[BLOCK] RLS 404-vs-403 authz conflict on `POST /classes/{id}/status` and `PATCH /classes/{id}`.** *(Amelia #7.)*
   AC6 + Testing assert a teacher editing another teacher's class gets **403 FORBIDDEN**. But RLS is tenant-only and a teacher's role-scoped read of another teacher's row returns **zero rows → `CLASS_NOT_FOUND` (404)** *before* the `ForbiddenError` path is reached. The 403 assertion may be **untestable as specified**.
   **Decide one:**
   - (a) Service does an explicit owner-check read (admin-scoped/`GetClassByID` unfiltered-by-teacher) *before* the authz gate → genuine **403**; or
   - (b) Accept **404** as the teacher-sees-nothing contract and rewrite AC6 + the "teacher-edits-others 403" tests to expect 404.
   This must be settled **before** the ATDD red tests are written (see §D).

3. **[BLOCK] `capacity` clearability vs COALESCE partial-update.** *(Amelia #1, Winston gap #1.)*
   `capacity` is nullable (Spawn passes `nil`) and `UpdateClass` uses `sqlc.narg`/COALESCE — which cannot distinguish "clear to NULL" from "leave unchanged" (null = keep). So there is **no way to null-out capacity** after create.
   **Decide:** is capacity clearable post-create? If yes → that field needs a sentinel / explicit-clear path (not plain COALESCE). If no → state it. Also add `CHECK (capacity IS NULL OR capacity > 0)` (Winston) so the API boundary — not just Zod — enforces the bound. Affects Task 1 (migration CHECK) + Task 2 (`UpdateClass` query shape).

4. **[BLOCK] Template-toggle wire semantics "null vs omit" (only if toggles survive §B-2).** *(Amelia #2.)*
   Excluded field → sent `null` or key omitted? COALESCE treats null as no-op, so a toggle sending `null` to *clear* will instead *preserve*. Create-path and update-path need opposite null semantics; the spec conflates them. If per-field toggles are cut (see §B-2) this collapses to "empty → null at the data layer." If kept, the `CreateClassRequest` vs `UpdateClassRequest` null contract must be written explicitly.

---

## B. Decisions for Ducdo — these reverse or amend a spec decision already made

1. **[DECIDE] paused → ended.** *(John: allow · Winston: escalate to product · spec: disallowed per epic-AC exact arrows.)*
   Real teacher flow: a class paused for 6 weeks doesn't come back — forcing `resume→end` makes the user flip to `active` (a false state) to reach `ended`, and writes two audit rows for one intent. No data-integrity cost to allowing it; nothing downstream depends on it yet.
   **Options:** (a) add `paused→ended` to `classTransitions` + amend the epic AC (do NOT sweep silently — the story's Open-Q1 says so); (b) keep disallowed as shipped. Open Question 1 in the story.

2. **[DECIDE] Per-field template include/exclude Switch wall (AC2).** *(Sally: cut from 3.1 · John: premature — templates CRUD is 3.3 · this reverses your 2026-07-18 scoping that ADDED it.)*
   Concern: a switch on every prefilled field is a micro-decision checklist before the teacher creates a single class; granular field control belongs with template authoring (3.3). "Editing a prefilled field *is* the exclude — type over it or clear it."
   **Options:** (a) cut the per-field Switches for 3.1 → template prefills scalars, user edits normally, empty→null at data layer, session plan stays read-only (also shrinks test + dialog surface); (b) keep AC2 as scoped. If cut, resolves §A-4 automatically.

3. **[DECIDE] Row dimming (AC7 / UX §5.6).** *(Sally: dim Ended only.)*
   Spec dims **Ended AND Upcoming** to 0.7. Sally: upcoming is the most action-adjacent row (the one she's about to activate) — dimming reads "expired/irrelevant." Blue pill already signals "future."
   **Options:** (a) dim Ended only, Upcoming full opacity; (b) keep both dimmed per UX-spec as written. Overrides UX §5.6 → needs your sign-off.

4. **[DECIDE] Due-dates default OFF.** *(Sally + Winston-adjacent: keep off · John: confirm the modal user.)*
   Sally defends OFF hard (a deadline is a commitment; off = feature appears only when reached for; on = every class silently inherits unwanted deadline scaffolding). John wants it confirmed against the real teacher population, not a coin flip.
   **Default:** keep OFF (AC3 unchanged) unless you have data that most classes are scheduled. Low-stakes — flagging only because John asked "which is the modal user?"

---

## C. Backend spec tightenings (write into the story; dev proceeds once stated)

1. **[TIGHTEN] `updated_at` is set by whom?** *(Winston, Amelia #5.)* `DEFAULT now()` fires on INSERT only. Every `UpdateClass`/`UpdateClassStatus` query MUST `SET updated_at = now()` explicitly (preferred — greppable, matches no-magic posture), OR add a `BEFORE UPDATE` trigger (first in codebase → needs a convention note like the state machine got). State the choice.
2. **[TIGHTEN] Define what `class.updated` audit means.** *(Winston.)* "What changed" (needs before-image via the §A-1 row lock) vs "an update happened" (noisy no-op rows on identical PUTs). Pick before choosing the query shape.
3. **[TIGHTEN] `end_date` invariants.** *(Winston gap #2.)* Any relationship to start date / `due_dates_enabled`? Even if the answer is "no validation in 3.1," say so explicitly so the reviewer doesn't flag the omission.
4. **[TIGHTEN] State enum next to the transition-map task.** *(Amelia #6.)* `ClassStatus = upcoming|active|paused|ended` is in the envelope section but not beside Task 4's `classTransitions`. Pin it inline so the map + matrix can be written without cross-referencing.
5. **[TIGHTEN] `classSchema.ts` — copy, not move.** *(Amelia #4.)* Lifting validators out of shipped `onboarding/classSpawnSchema.ts` risks touching a shipped feature. Copy + note the debt; don't re-point onboarding's import.
6. **[TIGHTEN] Grep all class-row readers, not just the create path.** *(Winston.)* Extending `CreateClass` regenerates sqlc models; any `SELECT *`/hand-scan of the classes row shipped by 2.2 gets six new columns. Verify every consumer, not only `Spawn`.
7. **[TIGHTEN] Optimistic cache-key hierarchy for the role-split list.** *(Amelia #3.)* Owner list vs teacher-scoped list may live under different query keys; `useTransitionClassStatus` optimistic patch must update every cached list a class appears in. `useMutateRoom` precedent is single-audience — it does NOT cover the role split. Specify the `classesKeys` hierarchy explicitly.

---

## D. Test plan — additions & cuts *(Murat)*

**Change the ATDD gate:**
- **[TEST] Make AC4 + AC5 MANDATORY red-phase AT, unconditionally.** AC4 is the first state machine in the codebase (novelty = risk multiplier, ≥6 by construction); AC5 is a cross-teacher data-isolation boundary (a miss is an incident, not a bug). Keep the "if risk ≥6 register" clause only for AC1–AC3. (Task 0.)

**Add (ranked by risk):**
- **[TEST] Concurrency:** store-level concurrent `UpdateClassStatus` — assert one rejected/serialized (the §A-1 fix). Highest-regret if skipped.
- **[TEST] Terminal-state audit-not-written:** every illegal transition asserts **audit-row-count unchanged**, not just the error code (reject that still logs = audit poisoning).
- **[TEST] Unknown/garbage status** (`"deleted"`, wrong case, `""`, null) rejected at the Zod/handler boundary as validation-422 — distinct shape from `INVALID_STATUS_TRANSITION` — and never reaches the store.
- **[TEST] Write-scope isolation:** teacher `UpdateClassStatus` on another teacher's class → Forbidden at service AND RLS `WITH CHECK` blocks it on the 0-rows path (where a bypass hides as silent success). Pair reparent-WITH-CHECK with "teacher reparents to a center they don't belong to."
- **[TEST] `pendingTeacherEmail` ⇄ `teacher_id` mutex on update:** setting `teacher_id` clears `pendingTeacherEmail` and vice versa; "teacher-edits-unassigned → ForbiddenError" fires when the editing teacher's email == `pendingTeacherEmail` while `teacher_id` is still null (the invited-but-not-assigned seam — currently unspecified).
- **[TEST] `updated_at` monotonicity:** advances on update, `created_at` untouched (canary for trigger/ORM mistakes).
- **[TEST] Optimistic rollback = 3 named FE tests:** apply→200 settles · apply→**422 rolls back to the *specific* prior status** + surfaces via `role="alert"` inline · illegal blocked client-side but 422 handled if forced.
- **[TEST] Migration down-path:** up→down→up idempotent; down drops the new columns cleanly. (Medium priority.)
- **[TEST] Audit assertions are content, not existence:** actor_id, from_status, to_status, class_id on every legal transition.

**Cut as over-testing:**
- **axe** on both index AND dialog → full axe on index; dialog gets a focused focus-trap/label smoke check (modals fail on focus, not contrast twice).
- Don't re-assert the **full envelope shape** on all six legal transitions — assert shape once (create→upcoming), status-code + error-shape for the rest.
- **i18n** en+vi: keep key-existence; do NOT assert rendered Vietnamese strings (turns the test into a copy-freshness tripwire).
- **due_dates default:** keep the store DB-default assertion (source of truth) + FE Switch-off; cut the redundant service-layer re-assertion unless the service transforms the value.

---

## E. UX edits *(Sally)*

1. **[UX] Lifecycle lives in the status pill.** Make `ClassStatusPill` the transition trigger: pill + subtle caret + hover/focus affordance → `DropdownMenu` of **legal next states only** (current state absent, not disabled-and-listed). Solves "where do transitions live without a 3.2 detail page" AND kills the active→active 422 at the affordance level (Winston). Lifecycle does NOT hide in the kebab — the row Actions menu holds Edit/(later Delete) only. Affects AC7/AC8, Task 6 (`ClassStatusPill.tsx`).
2. **[UX] Inert row-click → omit the affordance entirely.** No `cursor:pointer`, no hover-elevation, no click handler. Class name is plain text this story; it becomes the link in 3.2 when the destination exists. (Resolves the AC7 "no-op vs omit" open choice → **omit**.)
3. **[UX] Deferred Students/Sessions columns:** a bare `—` reads as "failed to load." Render as visibly *dormant* (muted/low-contrast + "coming soon" affordance) OR collapse the two placeholder-only columns to a single muted cue. Design the dormancy — don't ship naked dashes. Affects AC7.
4. **[UX] Optimistic status rollback (pairs with §D):** on server reject, pill snaps back to the *literal* prior color/state and `role="alert"` fires **inline near the row**, not a floating toast.
5. **[UX] Per-tab empty states:** scope the big `s54` "No classes *yet*" hero to the truly-zero-classes case; a filtered tab with zero rows (e.g. "paused") gets a quiet inline "Nothing paused right now," not the create-CTA hero (which would lie). Keep the Fraunces "yet" copy for the true-empty case. Affects AC7.
6. **[UX] (= §B-3) Dim Ended only, not Upcoming.**
7. **[UX] (= §B-2) Sally would drop the per-field template Switch wall for 3.1.**

---

## F. Sequencing *(Amelia)*

1. **[TIGHTEN] Split the codegen runs.** Chunk 1 = `CreateClass` extension + Spawn callsite (`class.go:~387`) + **green `class_atdd_test.go`** ONLY. New queries (`ListClasses`/`ListClassesByTeacher`/`UpdateClass`/`UpdateClassStatus`) get a *separate* codegen run — the spec's WF-3 "after any .sql touch" invites one mega-codegen with a wider blast radius. (Task 2.)
2. **[TIGHTEN] Decide form factor (Dialog vs `/classes/new` route) BEFORE the e2e chunk.** The choice cascades into `route-bundle-boundaries.spec.ts` and the `PermissionDenied` `SectionNameKey` — it is not an independent parallel track. (Task 7/8.)

---

## G. Open product questions the ACs still owe an answer *(John)*

- **Teacherless class:** owner/admin creates a class — teacherless, or auto-assigned to the owner? A teacherless class is visible to *no* teacher under "own classes only." Intended? The ACs are silent. *(Note: AC1 says teacher-created defaults `teacher_id`=caller, but the owner/admin-created case is unspecified.)*
- **Ship-alone value:** create/edit/lifecycle spine is load-bearing, but a class list with `—` roster/sessions + inert rows is "a label, not a workspace." John's call: internally sequence 3.1→3.2 fine; **do not release the `—` list to paying teachers ahead of 3.2.**

---

## Quick triage summary

| Must resolve before dev | Owner |
|---|---|
| A-1 concurrency race (fold guard into UPDATE WHERE) | dev/arch |
| A-2 RLS 404-vs-403 (pick 403-via-explicit-read or accept 404) | Ducdo + dev |
| A-3 capacity clearable? + CHECK>0 | Ducdo |
| B-1 paused→ended allow? | Ducdo/product |
| B-2 keep or cut per-field template toggles | Ducdo |
| D ATDD gate → AC4+AC5 mandatory | test |

Everything in C/E/F is "write it down / adjust and go" once A + B are decided.
