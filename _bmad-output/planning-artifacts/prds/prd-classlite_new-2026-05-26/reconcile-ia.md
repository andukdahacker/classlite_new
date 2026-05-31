---
title: IA → PRD Reconciliation
source-ia: docs/classlite-entry/classlite-ia.md
prd: prd-classlite_new-2026-05-26/prd.md
date: 2026-05-26
---

# IA → PRD Reconciliation Report

## 1. Features / Screens With No Corresponding FR

### 1.1 Mobile — purpose-designed screens (s74–s87) are under-specified

The IA defines 14 purpose-designed mobile screens for all three roles (student s74–s81, teacher s82–s85, owner s86, coverage map s87) and explicitly states these are **not responsive squishes — they are purpose-designed**.

The PRD's §6.1 says "Responsive design (desktop + mobile breakpoints per mockup screens s74–s87)" and the Platform section says "responsive web app." There is no FR that captures the mobile-specific interaction patterns drawn in the IA:

- `s75`: swipe gestures and horizontal-scroll filter chips in student Inbox
- `s78`: phone-sized writing surface with sticky word counter
- `s79`: anchored feedback inline (not a side rail — different from desktop)
- `s80`: Q&A as chat-bubble pattern (not docs-style sidebar)
- `s85`: AI-suggest sheet on teacher question reply
- `s86`: approve enrollment from a push notification (push notifications are deferred in §6.2)

**Gap:** The PRD explicitly defers push notifications (`s86` owner mobile) yet the IA includes it as a drawn screen. No FR covers the mobile-specific interaction differences (swipe, inline feedback vs. rail, chat-bubble Q&A, AI-suggest sheet). The PRD's "responsive" framing may not faithfully reflect the IA's intent.

### 1.2 Owner mobile approve enrollment (s86) contradicts out-of-scope push notifications

`s86` is a screen for approving enrollment from a push notification. §6.2 explicitly lists push notifications as out of scope for MVP. This screen has no FR and the underlying delivery mechanism is deferred — making s86 a drawn screen with no buildable path in MVP.

### 1.3 Persona → role distinction in onboarding is partially lost

The IA dedicates a top-level section to the distinction between **persona labels** (Operator, Founder, Solo) used during onboarding versus **role labels** (Admin, Owner, Teacher) used in the rest of the product. The IA explicitly notes this forking and mapping.

FR-1 captures the mapping, but no FR captures the UX consequence: **the onboarding must use persona vocabulary (Operator/Founder/Solo) while all post-onboarding surfaces switch to role vocabulary (Admin/Owner/Teacher)**. This is a cross-cutting copy and labeling requirement with no home in the PRD.

### 1.4 Onboarding "skip this step" pattern (all steps) — partially covered

The IA states: "All screens have a quiet 'save and finish later' exit + skip-this-step pattern." FR-6 covers save/resume but does not explicitly require **every step** to have a visible skip-this-step affordance. The distinction matters: a skip option implies the step is individually optional, not just that the whole flow can be deferred.

### 1.5 App shell — topbar search ⌘K palette UI explicitly not drawn

The IA notes: `Topbar — search | "Search" with ⌘K shortcut. Palette UI not drawn.` FR-67 covers global search but marks the palette UI as following "standard patterns." The IA's note that the palette is **not drawn** is a design signal that should be an explicit open design question or assumption — not silently delegated. The PRD assumption in FR-67 is present but could be more prominent.

### 1.6 Sidebar — Resources nav and Settings group structure

The IA details the sidebar structure precisely:
- Knowledge hub + Archive appear under a "Resources nav" group (for teachers)
- Settings appears as a single sidebar item under a "Settings group" (Owner only)
- "ClassLite" wordmark with an amber dot accent is specified as the brand element

None of these shell structure details (grouping, amber dot, wordmark spec) are in any FR or NFR. While layout details can reasonably defer to the IA as the authoritative source, the sidebar grouping logic (Resources vs. Workspace nav) is a navigational architecture decision that could affect information hierarchy — worth a light FR noting that nav groups are role-gated.

### 1.7 Inbox notification badge — sidebar item only

The IA specifies the Inbox has an "unread badge" on the sidebar nav item. FR-59 mentions the "unread badge on the Inbox sidebar item" in consequences. This is covered, but only as a testable consequence — not as a behavior statement — making it easy to miss in implementation.

### 1.8 Admin/Owner Dashboard (s48) — specific content not fully captured

The IA defines s48 as a "center pulse" for Admin/Owner — different from the teacher dashboard (s06). FR-51 covers this: active classes, enrolled students, staff active today, sessions, "Needs attention" card. Adequately covered.

### 1.9 Coverage map screen (s87)

`s87` is a planning artifact (a screen that categorizes all 87 desktop screens into mobile-first / mobile-triage / desktop-only buckets). It is not a product screen. No FR is needed, but the PRD makes no reference to it. Low severity — no gap.

### 1.10 Bulk operations pattern — documented in IA, explicitly deferred in PRD

The IA documents: "No specific bulk operations are drawn in the mockup. When added, appear as modals or drawers triggered from list/table views. Standard pattern: count → parameters → preview → confirm."

The PRD §6.2 lists "Bulk operations" as out of scope. This is consistent. However, the PRD does not carry the IA's interaction pattern specification (modal/drawer, count → parameters → preview → confirm) into a design note. Low risk since it is deferred, but the pattern should survive into the next planning phase.

---

## 2. Qualitative Details Dropped by the PRD's FR Structure

### 2.1 Tone and framing: "softened" language for student-facing analytics

The IA states that the student performance view uses a **"softened version of teacher's Mistakes view"** and `s37` explicitly says "Patterns (softened version of teacher's Mistakes view)." FR-50 captures the two-tab structure and says "Patterns uses neutral framing (no 'mistakes' language)." Partially captured, but the IA's original intent — that the entire framing is softened, not just label swaps — is reduced to a single label rule. The editorial/tone philosophy is not expressed as a guiding principle.

### 2.2 "Purpose-designed, not responsive squishes" — mobile design philosophy

The IA's introduction to Chapter 8 states: "iPhone 390×844. Purpose-designed, not responsive squishes." This is a design philosophy statement that the PRD converts into "responsive design (desktop + mobile breakpoints)" — which is the opposite framing. The PRD implies the mobile experience is derived from the desktop; the IA implies it is purpose-built for mobile. This is a meaningful design direction difference.

### 2.3 No messaging product — constraint is documented but rationale is thin

The IA is explicit: "No messaging product — communication only via submission comments (s23 Writing grading) and student Q&A (s18/s36)." The PRD lists "Not a messaging product" in §5 Non-Goals and FR-38/39 cover Q&A. However, the IA's precise channel inventory (only two: grading comments + Q&A) is not replicated as a constraint in any FR. If a feature team were to add submission-level comments outside of the two specified channels, nothing in the PRD would catch it.

### 2.4 Admin has no visibility on Q&A — resolved decision not surfaced as FR

The IA documents as a resolved decision: "Admin visibility on Questions: No visibility. Admin doesn't teach, doesn't see questions. Questions are teacher↔student only." FR-9 mentions "Admin cannot teach classes or see the Questions Q&A sidebar" as a testable consequence — this is covered, but only as a consequence line, not a standalone FR. Given it was an explicit design decision, it deserves FR-level prominence to avoid regression.

### 2.5 Inline invite during class spawning — interaction pattern

The IA (s03/s08) specifies that teacher assignment during spawn supports **inline invitation** — the user can invite a teacher who does not yet exist in the system without leaving the onboarding flow. FR-4 mentions "Teacher assignment supports inline invitation (email) for teachers not yet in the system." Covered. No gap — noting as adequately handled.

### 2.6 Knowledge Hub — student read access is conditional ("when shared")

The IA visibility matrix states Knowledge Hub access for students is "read (when shared)" — implying there is a per-file or per-class sharing control. FR-54 says "students can view shared files" and that publishing is gated by the editable permission (FR-10). FR-10 only covers the "Can publish to Knowledge Hub" toggle for roles, not per-file sharing granularity. It is unclear from the PRD whether individual files can be selectively shared with students or whether the toggle is coarser. The IA implies per-file sharing; the PRD implies a role-level switch.

### 2.7 Recurrence delete scope — "Apply to…" branch expanded in modal

The IA (s14) specifies: "Delete → 'Apply to…' recurrence-scope branch expanded." FR-17 captures the scope branch (this session only / this and future / all sessions) but only for editing. The delete-specific scope branch for recurring sessions is not explicitly called out in FR-17's consequences. Minor but testable.

### 2.8 Grading queue — "Prev student / Next student" navigation

FR-33 captures this as a consequence: "Prev student / Next student navigation enables queue-based grading." Adequately covered.

### 2.9 Student Inbox — "My questions" card on dashboard

FR-53 (student dashboard) consequences include: "My questions card shows open Q&A threads awaiting teacher reply." Adequately covered.

---

## 3. Contradictions Between the Two Documents

### 3.1 Mobile design philosophy: "purpose-designed" vs. "responsive"

- **IA (Chapter 8 intro):** "iPhone 390×844. Purpose-designed, not responsive squishes."
- **PRD (§6.1, Platform section):** "Responsive design (desktop + mobile breakpoints per mockup screens s74–s87)" and "Single responsive web app serving all roles."

These are contradictory design stances. The IA treats mobile as a distinct design surface; the PRD treats it as a responsive adaptation. The implementation team will have to choose — and the wrong choice will violate one of these documents.

**Recommendation:** Clarify whether mobile screens (s74–s87) are implemented as purpose-built layouts (possibly via dedicated mobile routes or media-query breakpoint overrides) or as fluid responsive adaptations of the desktop layout. The IA's language suggests the former.

### 3.2 Push notification for owner enrollment approval (s86 vs. §6.2)

- **IA (s86):** Drawn screen for "Approve enrollment from push notification."
- **PRD (§6.2):** "Push notifications (mobile web) — deferred."

`s86` has no delivery mechanism in MVP. Either the screen should be removed from the IA's MVP scope or the PRD should add a note that s86 is a post-MVP placeholder screen.

### 3.3 Admin sidebar scope

- **IA (Role model):** "Admin: Same sidebar as Owner per mockup convention."
- **PRD (FR-9):** "Admin sees the same sidebar as Owner minus center settings and billing."

Minor inconsistency in phrasing. The IA says "same sidebar" (with a parenthetical "Admin variations called out inline"); the PRD is more precise. The PRD is likely correct but the IA's "same sidebar" could mislead implementers into treating the two sidebars as identical.

### 3.4 Invite modal — "Owner role chip hidden" phrasing

- **IA (s41):** "Role chips (Teacher/Admin; Owner only when sender is Owner)."
- **PRD (FR-11):** "The 'Owner' role chip is hidden in the invite modal when the sender is Admin."

Consistent in meaning, but the IA says the Owner chip appears when the sender IS an Owner; the PRD says it is hidden when the sender is Admin. These are equivalent but phrased from opposite directions. Low risk but worth aligning the language to avoid implementation confusion.

---

## 4. Summary of Priority Gaps

| Priority | Gap | IA Reference | PRD Gap |
|---|---|---|---|
| High | Mobile design philosophy contradiction ("purpose-designed" vs. "responsive") | Chapter 8 intro | §6.1, Platform |
| High | s86 push notification screen contradicts deferred push notifications | `s86` | §6.2 |
| High | Mobile-specific interaction patterns (swipe, chat-bubble Q&A, AI-suggest sheet, inline feedback) have no FR | `s74–s85` | No FR |
| Medium | Per-file vs. role-level Knowledge Hub sharing granularity for students | Visibility matrix | FR-10, FR-54 |
| Medium | Persona/role vocabulary distinction (onboarding uses persona labels, product uses role labels) is a copy requirement with no FR | Persona→role section | FR-1 only |
| Medium | "Not a messaging product" — precise channel inventory (only grading comments + Q&A) not captured as a constraint | Scope constraints | §5 Non-Goals |
| Low | Delete recurrence scope branch for sessions not explicitly called out | `s14` | FR-17 |
| Low | Sidebar grouping (Resources nav, Settings group, amber dot wordmark) — no FR | App shell elements | No FR |
| Low | Onboarding "skip this step" required on every step, not just flow-level | Chapter 1 note | FR-6 |
