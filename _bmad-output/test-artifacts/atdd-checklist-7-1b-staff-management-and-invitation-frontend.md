---
stepsCompleted:
  - step-01-preflight-and-context
  - step-02-generation-mode
  - step-03-test-strategy
  - step-04-generate-tests
  - step-05-validate-and-complete
lastStep: step-05-validate-and-complete
lastSaved: '2026-08-30'
storyId: '7.1b'
storyKey: '7-1b-staff-management-and-invitation-frontend'
storyFile: '_bmad-output/implementation-artifacts/7-1b-staff-management-and-invitation-frontend.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-7-1b-staff-management-and-invitation-frontend.md'
generatedTestFiles:
  - classlite-web/src/features/people/api/__tests__/handlers.ts
  - classlite-web/src/features/people/__tests__/StaffListPage.test.tsx
  - classlite-web/src/features/people/__tests__/StaffDetailPage.test.tsx
  - classlite-web/src/features/people/__tests__/StaffRoutesGate.test.tsx
  - classlite-web/src/features/people/components/__tests__/InviteStaffModal.test.tsx
  - classlite-web/src/features/people/components/__tests__/OwnerActionsCard.test.tsx
inputDocuments:
  - _bmad-output/implementation-artifacts/7-1b-staff-management-and-invitation-frontend.md
  - _bmad-output/implementation-artifacts/7-1a-staff-management-and-invitation-backend.md
  - classlite-web/src/lib/api/client.ts
  - classlite-web/src/features/classes/__tests__/ClassesPage.test.tsx
  - classlite-web/src/features/classes/api/__tests__/handlers.ts
  - classlite-web/src/features/classes/components/__tests__/ClassFormDialog.test.tsx
  - classlite-web/src/features/settings/__tests__/ProfileTab.test.tsx
  - docs/project-context.md
---

# ATDD Red-Phase Checklist — Story 7.1b (Staff Management & Invitation — Frontend)

**Test Architect:** Murat · **Date:** 2026-08-30 · **Stack:** frontend (Vitest + Testing Library + MSW) · **Story risk:** 4

## 1. Preflight & Context

- **Detected stack:** `frontend` — the story is a UI slice over a backend fully shipped in 7-1a. Framework configured: `vitest.config.ts` + `@testing-library/react` + `msw` (component seam); `playwright.config.ts` (e2e, not exercised here).
- **Prerequisites:** ✅ Story is `ready-for-dev` with 22 explicit ACs. ✅ Generated 7-1a wire types present in `src/lib/api/client.ts`. ✅ Harness precedents present (`ClassesPage.test.tsx`, `ClassFormDialog.test.tsx`, `ProfileTab.test.tsx`).
- **Risk posture (from the story + WF-8):** 7-1b maps to **NO** handoff risk ≥6 → **NOT a WF-8 hard ATDD gate** (R15 discharged in 7-1a; R17=7.3; R25/R26=7.4). ATDD is *recommended, not required* here. **However**, the one security-adjacent assertion — TEST-FE-6 "an Admin's s40 has NO Owner-actions card in the DOM" — is a **mandatory DoD test** and is red-covered below.

## 2. Generation Mode

**AI generation** (ACs crisp; scenarios are standard component-test shapes over the MSW seam). No live-browser recording: this is a pure component-test story. The single e2e concern (route-bundle chunk boundaries) is covered by the **existing** `e2e/route-bundle-boundaries.spec.ts`, which dev extends with the two new `/people/*` chunks — not a red scaffold authored here.

## 3. Red-Phase Convention (deviation from the generic skill scaffold — deliberate)

The generic ATDD workflow emits `test.skip()` API+E2E scaffolds. **This repo has a stronger, documented convention** ([[reference_atdd_red_convention]] + the shipped Story 3.1 `ClassesPage.test.tsx` precedent): FE red-phase = **real, un-skipped tests whose RED signal is a missing page/component module** (`tsc -b` + Vitest import failure). Per [[feedback_pragmatic_interpretation_of_spec_absolutes]] the repo convention wins over the generic scaffold. No `test.skip()` was emitted.

**Verified red surface (`npx tsc -b`) — exactly 6 intended errors, zero accidental:**

| Error | File | Drives |
|---|---|---|
| TS2307 `@/features/people/StaffListPage` | StaffListPage.test.tsx, StaffRoutesGate.test.tsx | Task 4 (s39 page) |
| TS2307 `@/features/people/StaffDetailPage` | StaffDetailPage.test.tsx | Task 5 (s40 page) |
| TS2307 `@/features/people/components/InviteStaffModal` | InviteStaffModal.test.tsx | Task 7 (s41 modal) |
| TS2307 `@/features/people/components/OwnerActionsCard` | OwnerActionsCard.test.tsx | Task 6 (owner actions) |
| TS2322 `"people"` ∉ `SectionNameKey` | StaffRoutesGate.test.tsx | Task 1 (union + `app.permissionDenied.section.people.*` i18n) |

`api/__tests__/handlers.ts` compiles **clean** — it is typed against the *generated* 7-1a `components['schemas'][…]`, so any codegen drift under D16 fails the fixture compile. That is the contract co-finalization guard operating as a test.

## 4. AC → Test Strategy (levels + priorities)

Levels: **Component** (behavior over the MSW HTTP seam, TEST-FE-1). No API/E2E-level red scaffolds (backend done; e2e chunking is pre-existing).

| AC | Scenario | Level | Priority | Red test |
|---|---|---|---|---|
| 1 | Owner/Admin allowed; Teacher/Student denied w/ `people` section copy (en+vi) | Component | **P0** | StaffRoutesGate.test.tsx |
| 2 | `/people/staff/:userId` resolves for staff (deep-import) | Component + existing e2e | P1 | StaffDetailPage (render) + existing route-bundle e2e (dev extends) |
| 3 | s39 columns incl. LoadMeter "N/cap"; amber ← server `load.heavy` (no client threshold) | Component | P1 | StaffListPage.test.tsx |
| 4 | All/Active/Pending/Archived tabs; client counts; Pending dimmed `??`; default tab | Component | P1 | StaffListPage.test.tsx |
| 5 | Trilogy: skeleton rows / role-appropriate empty + CTA / inline `alert`+retry | Component | **P0** | StaffListPage.test.tsx |
| 6 | Owner excluded from roster + explanatory note; admin rows present | Component | P1 | StaffListPage.test.tsx |
| 7 | Member row → detail nav; pending row inert | Component | **P0** | StaffListPage.test.tsx |
| 8 | s40 head + tabs; 404 STAFF_NOT_FOUND → not-found state (no crash); trilogy | Component | **P0** | StaffDetailPage.test.tsx |
| 9 | Overview (email+LoadMeter+null-lastActive token); per-tab empty states | Component | P1 | StaffDetailPage.test.tsx |
| 10 | **Owner sees actions card; Admin s40 read-only, card ABSENT from DOM (TEST-FE-6)** | Component | **P0** | StaffDetailPage.test.tsx |
| 11 | Assign-to-class picker (← GET /api/classes) → POST → toast; 404 → error | Component | **P0** | OwnerActionsCard.test.tsx |
| 12 | Archive ghost warning (count); success toast; 409 self / already → distinct copy | Component | **P0** | OwnerActionsCard.test.tsx |
| 13 | Reset-password confirm → 204 → "reset email sent" toast | Component | P1 | OwnerActionsCard.test.tsx |
| 14 | Force-logout confirm → 200 → "N sessions revoked" (reuses shipped endpoint) | Component | P1 | OwnerActionsCard.test.tsx |
| 15 | In-flight guard: confirm control disabled while `isPending` | Component | P1 | OwnerActionsCard.test.tsx |
| 16 | Invite modal fields (email req + name + welcomeNote + expiry footer) | Component | P1 | InviteStaffModal.test.tsx |
| 17 | Submit → POST; classId ONLY when teacher; centerId from session cache; 201→close | Component | **P0** | InviteStaffModal.test.tsx |
| 18 | 409 emailTaken (email field) / 403 roleAssignmentForbidden → i18n copy | Component | P1 | InviteStaffModal.test.tsx |
| 19 | **D12: exactly Teacher+Admin chips; NO owner chip for any sender** | Component | **P0** | InviteStaffModal.test.tsx |
| 20 | i18n parity en+vi; keys via i18n (no hardcoded English) | Component + `npm run i18n-parity` | P1 | StaffRoutesGate (people key existence) + i18n-parity script (post-dev) |
| 21 | D16 strip PROVISIONAL markers; codegen additive; `tsc -b`=0 | Build/contract | P1 | handlers.ts compile-guard (drift → red); dev runs codegen (Task 10) |
| 22 | Trilogy + TEST-FE-6 negative + invite RHF/axe + i18n key existence | Component | **P0** | all five suites (axe in InviteStaffModal) |

## 5. SEAMS — the observable contract dev implements to turn red → green

These testids / roles / i18n keys are asserted by the red tests; implementing them is the green path.

**StaffListPage (s39):** `staff-row-skeleton` · `staff-row-{userId}` · `pending-invite-row-{inviteId}` (dimmed `??`) · `role="tab"` × {all,active,pending,archived} (i18n `people.staff.tabs.*`, active tab `aria-current`/`aria-selected`) · `staff-empty` + CTA `people.staff.list.inviteCta` · `role="alert"` + retry `people.staff.list.retry` · `owner-excluded-note` · `load-meter` (text "N/cap", attr `data-heavy="true|false"`) · member name `link` → `/people/staff/{userId}`.

**StaffDetailPage (s40):** `staff-detail-skeleton` · name `<h1>` · `role="tab"` × {overview,classes,schedule,activity} (`people.staff.detail.tabs.*`) · `staff-not-found` · `role="alert"` · **`owner-actions`** (present iff owner, else absent) · `staff-classes-empty` (+ schedule/activity empties) · `load-meter` · null-lastActive token `people.staff.lastActive.never`.

**InviteStaffModal (s41):** email/name/welcomeNote `textbox`es (`people.invite.fields.*`) · footer `people.invite.footer.expiry` · `role-chip-teacher` + `role-chip-admin` ONLY (never `role-chip-owner`) · `invite-field-classId` (present iff teacher) · submit `people.invite.submit` · validation `people.invite.error.emailRequired` · errors `people.invite.error.{emailTaken,roleAssignmentForbidden}` · POST `/api/centers/{centerId}/invites`, classId omitted when admin, centerId from session cache.

**OwnerActionsCard:** action buttons `people.staff.actions.{assignClass,resetPassword,archive,forceLogout}` · confirm primary `owner-action-confirm` · `assign-class-picker` (← GET /api/classes) · archive ghost `people.staff.archive.ghostWarning` (count) · toasts (sonner) `people.staff.{resetPassword.success,forceLogout.success(count),archive.success,assignClass.success}` + errors `people.staff.archive.error.{cannotArchiveSelf,alreadyArchived}` / `people.staff.assignClass.error.classNotFound` · confirm disabled while pending.

**Route wiring (Task 1):** add `people` to the `SectionNameKey` union (`PermissionDenied.tsx`) and `app.permissionDenied.section.people.header` to en + vi.

## 6. Mock-seam compliance

- ✅ **TEST-FE-1** — MSW at the HTTP boundary; `useQuery`/`useMutation` never mocked. One `QueryClient` per test; role seeded on the module-singleton `queryClient`, page renders under a separate `createTestQueryClient()` provider (exact `ClassesPage.test.tsx` idiom).
- ✅ **Sonner** mocked at the module level in OwnerActionsCard (shipped `ProfileTab.test.tsx` convention). This is a notification-lib stub, not a second HTTP seam — MSW still owns every network call.
- ✅ **TEST-FE-6** negative (Admin no owner-actions in DOM) + route-denial negative both present.
- ✅ **TEST-FE-4** i18n asserted via `i18n.t`/`i18n.exists` (no hardcoded English); `people` denial key existence checked for en+vi.
- ✅ **TEST-FE-5** axe on the invite modal.

## 7. Validation & cleanup

- [x] Test files created at convention paths; red surface verified (`tsc -b` = 6 intended errors only).
- [x] Fixtures typed against generated schemas (D16 guard); `handlers.ts` compiles clean.
- [x] No `test.skip()` (repo compile-fail-red convention).
- [x] No orphaned browser/CLI sessions (no recording used).
- [x] Artifacts under `_bmad-output/test-artifacts/` + `classlite-web/src/features/people/**`.

## 8. Key risks & assumptions handed to dev

- **A1** — s40 tab addressability (URL vs local): tests are agnostic (role/testid queries), matching either `/classes/:id`-style URL tabs or local state. Dev picks per the precedent.
- **A2** — LoadMeter exposes `data-heavy` reflecting server `load.heavy`; if dev prefers a class-based amber, swap the two `data-heavy` assertions for the class assertion (keep the "no client threshold" invariant).
- **A3** — `owner-action-confirm` is a single shared confirm-primary testid across all four actions; if dev builds per-action dialogs, keep the same testid on each primary control.
- **A4** — Invite `classId` picker interaction is modeled as click-to-select inside `invite-field-classId`; if a native `<select>` is used, adjust to `selectOptions` (payload assertion is the durable part).
- **A5** — D12 is RULED (Ducdo 2026-08-30): Teacher/Admin only. The "no owner chip" negative is load-bearing — do not add an owner chip.

## 9. Next workflow

→ **`/bmad-dev-story`** (implement 7-1b; turn the 5 suites green + add inline unit/component tests per TEST-FE-*).
→ Post-dev: **`/bmad-tea TA`** (expand P2/P3, fault injection, role-negative breadth) then **`/bmad-tea RV`** (flake/quality review).
→ Epic boundary: **TR** (trace) + **NR** (NFR) + **GATE**.
