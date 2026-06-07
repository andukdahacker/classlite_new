---
baseline_commit: a90010732057148b3c4e930c7c7b234aa4686378
---

# Story 1d-7 (legacy): Drawers, Modals, Forms & Inline Editors

Status: deferred-to-feature-epic

> **PATH B RE-SCOPE (2026-06-07):** After party-mode review, this story is deferred. Components ship with first feature epic that needs each wrapper:
> - `Drawer`/`Sheet` ClassLite chrome wrappers → **Epic 2** Story 2.3 (onboarding uses sheet) or **Epic 3** (class creation drawer)
> - Three Modal patterns (confirmation/form/content) + RHF + Zod wrappers (`FormFieldWrapper`, `FormSection`) → **Epic 2** Story 2.3a (onboarding center setup uses canonical form modal — first consumer of the canonical RHF pattern)
> - `BrandColorPicker` → **Epic 2** Story 2.1 (center setup `s01`) or **Epic 2** Story 2.5 (center settings `s49`)
> - `AssignChip` → **Epic 2** Story 2.2 (class spawning `s03`/`s08`) — first consumer
> - `TaskChecklistItem` → **Epic 2** Story 2.4 (post-onboarding checklist `s09`/`s53`) — first consumer
> - Writing editor FW-8 RHF exemption note → ship with **Epic 5** Story 5.3 (writing attempt) as architectural decision record
>
> Note: This file is kept as an input artifact. The RHF + Zod wrapper contract is reusable scope for Epic 2 Story 2.3a.

<!-- Validation is optional. Run `validate-create-story` for a quality second pass before `dev-story`. -->

## Story

As a frontend developer,
I want the drawer, modal, and form composition patterns built and storied — `Drawer` and `Sheet` wrappers with ClassLite chrome, three canonical `Modal` patterns (confirmation, form, content), RHF + Zod composition wrappers (`FormFieldWrapper`, `FormSection`), and the three inline-editor specializations (`BrandColorPicker`, `AssignChip`, `TaskChecklistItem`) — with the writing editor's FW-8 RHF exemption explicitly documented,
so that every Epic 2–10 drawer, modal, or form surface composes against a single canonical wrapping pattern and the writing editor's document-editing pattern is unambiguous.

## Acceptance Criteria (BDD)

> **No risk-score ≥6 ACs in this story.** This is composable frontend infrastructure — no tenant boundary, no auth flow, no money-handling code, no security surface. Form-validation logic ships with consumer stories in Epics 2–10. WF-8 ATDD red-tests are NOT mandatory. The Vitest + axe + focus-trap assertions described below are written inline by the dev using the patterns from `test-design-qa.md` and TEST-UX-2.

### AC1: `Drawer` and `Sheet` wrappers with ClassLite chrome

**Given** the `Drawer` component in `src/components/domain/Drawer.tsx` and `Sheet` in `src/components/domain/Sheet.tsx`,
**When** inspecting their composition,
**Then** each wraps its shadcn primitive (`Drawer` / `Sheet` from Story 1d-2) and adds the ClassLite three-region chrome:
- **Head** — title (i18n key), optional eyebrow, close button (`aria-label={t('common.close')}`)
- **Body** — `ScrollArea` wrapping the children, with consistent inset spacing tokens
- **Foot** — primary + secondary action slots; primary on the right, secondary on the left, matching desktop convention

**And** the wrapper props are:
- `open: boolean` and `onOpenChange(open): void` — controlled
- `title: string` (i18n-resolved by the consumer), `eyebrow?: string`
- `primaryAction?: { label: string; onClick: () => void; tone?: 'default' | 'danger'; loading?: boolean; disabled?: boolean }`
- `secondaryAction?: { label: string; onClick: () => void }`
- `side?: 'right' | 'left' | 'bottom'` (Sheet only; Drawer is bottom-only)

**And** the body region exposes a `children` slot rendered inside the scrollable container so consumers can drop any form or content directly without re-implementing scroll containment.

### AC2: Focus traps tested per TEST-UX-2

**Given** the `Drawer` or `Sheet` is opened,
**When** the user interacts via keyboard,
**Then** focus moves into the first focusable element inside the body region (the title bar's close button if no body interactive element exists),
**And** `Tab` and `Shift+Tab` cycle focus inside the wrapper only — focus never escapes to the underlying page,
**And** `Escape` closes the wrapper and returns focus to the triggering element on the page,
**And** a Vitest focus-trap test (`renderHook` + `user.tab()` user-event sequence) asserts the full cycle for both `Drawer` and `Sheet` — per TEST-UX-2 (focus return on close is "skipped every time" by agents; we test it here explicitly).

**And** axe-core runs zero violations on every Drawer/Sheet story across `Default`, `WithLongScrollContent`, and `WithDangerAction` exports.

### AC3: Three canonical `Modal` patterns — confirmation, form, content

**Given** `src/components/domain/Modal/`,
**When** inspecting the directory,
**Then** three pattern components exist, each composing the shadcn `Dialog` primitive with ClassLite chrome:

1. **`ConfirmationModal.tsx`** — single-purpose confirm pattern. Props: `open`, `onOpenChange`, `title`, `description`, `confirmLabel`, `cancelLabel`, `onConfirm`, `tone?: 'default' | 'danger'`, `loading?: boolean`. Used for destructive confirmations (delete class, delete session, etc.). Storybook story exports `Default`, `Destructive`, `Loading`.

2. **`FormModal.tsx`** — wraps a child form with the ClassLite head/body/foot chrome. Props: `open`, `onOpenChange`, `title`, `eyebrow?`, `children` (the form), `submitLabel`, `onSubmit`, `loading?: boolean`, `submitDisabled?: boolean`. The submit button lives in the foot and ties to the form's `onSubmit` — wiring example in the canonical story demonstrates RHF + `zodResolver` composition (per AC4).

3. **`ContentModal.tsx`** — for read-only or richly-rendered content (info cards, deprecation notes, terms acceptance). Props: `open`, `onOpenChange`, `title`, `children`, `primaryAction?`, `secondaryAction?`. Storybook story exports `Default`, `LongScrollContent`, `WithActions`.

**And** each pattern handles focus management identically to `Drawer` / `Sheet` (AC2) — focus traps, escape close, focus return on close — verified by reusing the same focus-trap test utility.

**And** the three patterns are documented in `classlite-web/docs/storybook-conventions.md` (cross-referenced from Story 1d-1 AC7) as the canonical modal patterns; agents who reach for the raw `Dialog` primitive directly in a feature story should be flagged in PR review.

### AC4: RHF + Zod composition wrappers — `FormFieldWrapper` and `FormSection`

**Given** the `FormFieldWrapper` component in `src/components/domain/FormFieldWrapper.tsx` and `FormSection` in `src/components/domain/FormSection.tsx`,
**When** inspecting their API,
**Then** `FormFieldWrapper` accepts:
- `name: FieldPath<TFieldValues>` — typed against the consumer's RHF schema
- `label: string` — i18n-resolved
- `description?: string` — help text rendered below the input, linked via `aria-describedby` on the input
- `required?: boolean` — adds the `*` marker and `aria-required="true"`
- `children: React.ReactElement` — the input element (passed as JSX so the wrapper can inject `aria-describedby`, `aria-invalid`, and the `name` binding via `Controller` or `register`)

**And** the wrapper renders label above input, help text below, and binds error state via:
- `aria-describedby` pointing to the help-text and error-message element IDs
- `aria-invalid="true"` when the field has an RHF error
- An inline `<p role="alert">` containing the i18n-resolved error message below the input (composes `InlineFieldError` from Story 1d-5)

**And** `FormSection` accepts `title: string`, `description?: string`, and `children` — it groups related fields under a section heading with consistent spacing, used for multi-section forms like CenterSettings, ClassEditor, etc.

**And** the canonical Storybook story (`FormFieldWrapper.stories.tsx` → `WithZodSchema`) demonstrates the full TS-2 pattern:
```ts
const studentFormSchema = z.object({
  name: z.string().min(1, 'name.required'),
  email: z.string().email('email.invalid'),
  targetBand: z.number().min(0).max(9),
});
type StudentFormValues = z.infer<typeof studentFormSchema>;

const form = useForm<StudentFormValues>({
  resolver: zodResolver(studentFormSchema),
  defaultValues: { name: '', email: '', targetBand: 6.5 },
});
```
The Zod schema defines the form shape (per TS-2 — Zod schema defines form shape; never derive from generated API types). The error message keys (`'name.required'`, `'email.invalid'`) resolve via i18n in the inline error display.

### AC5: Writing editor FW-8 RHF exemption — explicitly documented

**Given** the writing editor pattern is the sole project-wide exemption from RHF + Zod (per FW-8),
**When** inspecting the `FormFieldWrapper` documentation, the `FormModal` documentation, and `classlite-web/docs/storybook-conventions.md`,
**Then** each location includes an explicit exemption paragraph:

> **Writing editor exemption (FW-8).** The Docs-style writing editor (`WriteDocSurface`, Epic 5 Story 5-3) does NOT use `FormFieldWrapper`, `FormSection`, `FormModal`, or any RHF + `zodResolver` wiring. It uses the document-editing pattern: debounced TanStack Query mutations with a "Saving..." / "Saved" indicator, no submit button, no blocking validation modals. Treat its surface as a document, not a form. Story 5-3 in Epic 5 owns the implementation; this story documents the exemption so no agent applies form patterns to it by reflex.

**And** the exemption is also documented inline in `FormFieldWrapper.tsx` as a JSDoc `@remarks` block referencing FW-8 and Epic 5 Story 5-3.

**And** the `FormModal` JSDoc explicitly states it is NOT to be used for the writing editor — any future writing-editor-like surface (note editor, anchored Q&A composer with autosave) follows the same document-editing pattern.

**And** the canonical RHF story (`FormFieldWrapper.stories.tsx` → `WithZodSchema`) includes a Storybook "Description" addon entry calling out the exemption visibly to designers browsing Storybook.

### AC6: `BrandColorPicker` (`s01`/`s49`)

**Given** the `BrandColorPicker` component in `src/components/domain/BrandColorPicker.tsx`,
**When** rendered,
**Then** the UI composes:
- **Auto letter-mark preview** — a circular preview showing the first letter of the entered brand name (or the existing brand mark), bound to the current color choice
- **Six color swatches** — design-token-driven colors from `--cl-accent`, `--cl-accent-2`, `--cl-amber`, `--cl-ink`, `--cl-paper-2`, `--cl-muted` (or the project's defined brand palette). Each swatch is a radio button with `aria-label={t('brand.color', { name: colorName })}` and a selected state visible to both sighted and assistive-tech users
- **Upload-logo affordance** — a button "Upload logo" that opens the OS file picker; the UI shows a preview placeholder. **The presigned R2 upload itself is deferred per XL-3 to the consuming story (Epic 2 Center Onboarding, Epic 4 Center Settings)** — this component surfaces the file picker UI and emits `onLogoFileSelected(file: File)` but does not call the presign API or the R2 PUT

**And** props: `value: { color: string; logoUrl?: string }`, `onChange(value): void`, `brandName?: string` (used by the auto letter-mark when no logo is present).

**And** Storybook stories: `Default` (color selected, no logo), `WithLogo` (logo uploaded and visible), `Empty` (no color, no logo, letter-mark fallback).

### AC7: `AssignChip` (`s03`/`s08`/`s41`)

**Given** the `AssignChip` component in `src/components/domain/AssignChip.tsx`,
**When** rendered with an assigned user,
**Then** the chip shows `Avatar` + name in a pill layout matching `s03`/`s08`/`s41`.

**Given** the chip is rendered in the empty variant,
**When** no user is assigned,
**Then** the chip shows the placeholder copy `t('assign.empty')` resolving to `"Assign or invite a teacher"` in English (and the Vietnamese equivalent), per `s03`/`s08`/`s41` exact copy.

**And** props: `assignee?: { id: string; name: string; avatarUrl?: string }`, `onClick(): void`, `disabled?: boolean`. The `onClick` opens a picker in consuming stories; the picker UI itself is deferred to those consumers (e.g., Epic 2 class onboarding inline-invite, Epic 4 staff assign).

**And** Storybook stories: `Default` (assigned with avatar), `Empty` (placeholder copy), `Disabled` (read-only).

### AC8: `TaskChecklistItem` inline editor (`s09`/`s53`)

**Given** the `TaskChecklistItem` component in `src/components/domain/TaskChecklistItem.tsx`,
**When** rendered in `default` state,
**Then** the row shows: icon + name + optional `ft-badge` (e.g., "Required") + chevron arrow on the right.

**Given** the row is in `done` state,
**When** rendered,
**Then** the icon swaps to a checkmark, the name renders with strike-through styling, and the arrow remains for navigation back.

**And** props: `icon: React.ReactNode`, `name: string` (i18n-resolved by the consumer), `required?: boolean`, `done?: boolean`, `onArrowClick(): void`. The component is purely presentational; the task-completion mutation lives in the consuming epic (Epic 2 onboarding handoff, dashboard day-1 wiring).

**And** Storybook stories: `Default`, `Done`, `Required`, `WithBadge`. The component is consumed in onboarding `s09` (finish-setup card) and day-1 dashboard `s53` (empty-state guided steps) — both consumers are out of scope here.

### AC9: Axe-core, focus management, and three-state coverage across all stories

**Given** the Drawer, Sheet, three Modal patterns, FormFieldWrapper, FormSection, BrandColorPicker, AssignChip, and TaskChecklistItem stories,
**When** axe-core runs against every story in CI (per TEST-FE-5 and Story 1d-1 AC4),
**Then** zero violations across all states.

**And** focus management matches the WAI-ARIA dialog pattern for every modal/drawer/sheet:
- Focus moves into the wrapper on open (first focusable element)
- `Tab` and `Shift+Tab` cycle inside the wrapper (focus trap)
- `Escape` closes the wrapper
- Focus returns to the triggering element on close
- The wrapper has `role="dialog"` and `aria-labelledby` pointing to the title

**And** every form-related story renders correctly under both `en` and `vi` locales — Vietnamese error messages are typically longer; the dev verifies the inline error display does not break layout under `vi`.

**And** the writing editor exemption (AC5) is verified by a Storybook story stub `WritingEditorExemption.stories.tsx` (in `FormFieldWrapper.stories.tsx` as a named export) that renders ONLY documentation text — no form — explaining the exemption visibly to anyone browsing Storybook.

## Tasks / Subtasks

- [ ] **Task 1 (AC1):** Build `src/components/domain/Drawer.tsx` and `src/components/domain/Sheet.tsx` wrapping the shadcn primitives with ClassLite head/body/foot chrome. Add JSDoc + props types. Author `Drawer.stories.tsx` and `Sheet.stories.tsx` with `Default`, `WithLongScrollContent`, `WithDangerAction` exports.
- [ ] **Task 2 (AC2):** Add focus-trap tests in `Drawer.test.tsx` and `Sheet.test.tsx` using `user-event` to verify Tab cycling, Escape close, and focus return to trigger. Run axe-core on each story.
- [ ] **Task 3 (AC3):** Build `src/components/domain/Modal/ConfirmationModal.tsx`, `FormModal.tsx`, `ContentModal.tsx`. Each gets a co-located `*.stories.tsx` with the exports listed in AC3. Reuse the focus-trap test utility from Task 2.
- [ ] **Task 4 (AC4):** Build `src/components/domain/FormFieldWrapper.tsx` and `src/components/domain/FormSection.tsx`. Author the canonical `WithZodSchema` story demonstrating the full RHF + `zodResolver` + Zod-schema-defines-form-type pattern (TS-2). Story uses `useForm` + a sample student form.
- [ ] **Task 5 (AC5):** Add the writing-editor exemption paragraph as JSDoc `@remarks` blocks on `FormFieldWrapper.tsx`, `FormSection.tsx`, `FormModal.tsx`. Add the corresponding section to `classlite-web/docs/storybook-conventions.md`. Add the `WritingEditorExemption` named export in `FormFieldWrapper.stories.tsx` rendering only the exemption documentation.
- [ ] **Task 6 (AC6):** Build `src/components/domain/BrandColorPicker.tsx` with auto letter-mark preview, 6 swatches, and upload-logo affordance. Author `BrandColorPicker.stories.tsx` with `Default`, `WithLogo`, `Empty` exports. Add a dev-notes comment in the source file flagging the presigned R2 upload deferral (XL-3) to consuming stories.
- [ ] **Task 7 (AC7):** Build `src/components/domain/AssignChip.tsx` with default + empty + disabled variants. Author `AssignChip.stories.tsx` with the three exports. Verify the empty-variant copy resolves to "Assign or invite a teacher" (i18n key `assign.empty`).
- [ ] **Task 8 (AC8):** Build `src/components/domain/TaskChecklistItem.tsx` with default + done states. Author `TaskChecklistItem.stories.tsx` with `Default`, `Done`, `Required`, `WithBadge` exports.
- [ ] **Task 9 (AC9):** Run `npm run storybook:test` locally — verify zero axe violations across all stories. Toggle the locale to `vi` for every story and verify no layout breakage. Run the focus-trap tests via `npm test` and confirm green.

## Dev Notes

- **Stack reminders:**
  - React 19 — refs are plain props; no `forwardRef` on any wrapper. The shadcn `Dialog` and `Sheet` primitives are React 19-ready.
  - Vite 8 (Rolldown) — RHF and `@hookform/resolvers` are pure ESM; no Rolldown plugin concerns expected.
  - TypeScript strict — `FormFieldWrapper` is generic over `TFieldValues extends FieldValues`. The `name` prop is typed via `FieldPath<TFieldValues>` — never widen to `string` to escape a type error.
  - Tailwind utility classes only — head/body/foot chrome uses spacing tokens consistently across Drawer, Sheet, and the three Modal patterns.
  - shadcn `Dialog`, `Sheet`, `Drawer`, `Form`, `Input`, `Textarea`, `Select`, `Checkbox`, `RadioGroup`, `Switch`, `Label`, `ScrollArea` primitives from Story 1d-2 are the substrate.

- **One mock seam per side (TEST-FE-1):** MSW at the HTTP boundary. None of these components call APIs themselves — the consuming page does. Stories that demonstrate form submit (e.g., `FormModal` → `WithZodSchema`) wire MSW handlers to demonstrate the success and error states.

- **FW-8 writing editor exemption (binding):** The writing editor pattern is the SOLE project-wide exemption from RHF + `zodResolver`. AC5 documents this in three places: the JSDoc of the form wrappers, the Storybook conventions doc, and a Storybook-visible exemption story. The exemption matters because agents reflexively reach for `FormFieldWrapper` + `FormModal` for any text-input UI; the writing editor's autosave pattern is fundamentally different (debounced TanStack Query mutations with a "Saved/Saving" indicator, no submit button, no validation modal). Epic 5 Story 5-3 owns the writing editor implementation; this story prevents downstream agents from applying form patterns to it.

- **TS-2 Zod schema → form type pattern (binding):** The canonical story demonstrates `type Form = z.infer<typeof schema>` — never derive form types from generated API types. The OpenAPI-generated types are for wire format; form state is a separate concern (partials, drafts, validation). Agents tempted to do `type Form = Partial<StudentDTO>` should hit the conventions doc cross-reference and the JSDoc.

- **TEST-UX-2 focus traps (binding):** Focus return to trigger on close is "skipped every time" by agents — AC2 makes it a tested concern with a shared focus-trap test utility used across Drawer, Sheet, and the three Modal patterns.

- **UX-DR16 three-part error recovery:** The inline error message via `FormFieldWrapper` follows UX-DR16's three-part recovery pattern (what happened + why + what to do next) where the Zod schema's error key resolves to a multi-part i18n message. Example: `email.invalid` → `"That doesn't look like a valid email. Check for typos or missing @ symbol."` The Zod schema author owns the recovery copy via the i18n key.

- **XL-3 file uploads (binding):** `BrandColorPicker` surfaces the OS file picker UI and emits `onLogoFileSelected(file)`. It does NOT call `/api/uploads/presign` or PUT to R2 — those steps live in the consuming story per XL-3. This separation keeps the component testable in Storybook without mocking the upload pipeline.

- **FW-3 staleTime defaults:** Not directly relevant to this story (no `useQuery` calls inside these components). Consumer pages own staleTime per FW-3.

- **i18n is co-primary (UX-2, NFR-1):** Every story renders correctly in both `en` and `vi`. Modal titles, button labels, placeholder copy, and inline error messages all resolve via i18n keys. Hardcoded English is a CI failure per TEST-FE-4.

- **WF-3 codegen note:** This story does not touch `api.yaml` or `.sql` files. `codegen.sh` does NOT need to run.

- **WF-7 service boundary:** Imports stay within `classlite-web/` — never reach into `../../classlite-api/`. Form types derive from Zod schemas (TS-2), not from generated API types directly.

- **FW-7 component placement:** All components live in `src/components/domain/` — they're business-aware (e.g., `AssignChip` knows about teachers, `BrandColorPicker` knows about brand identity) but reusable across features. Never in `ui/`.

- **Role-rendering rule (UX-3):** None of these components branch on role internally. `BrandColorPicker` is consumed by `s01`/`s49` (Owner-only in `s49`); the role gate lives at the route, not in the component.

## Definition of Done

- [ ] All 9 ACs discharged.
- [ ] All components ship with co-located `*.stories.tsx` files (FW-7).
- [ ] All stories pass `npm run storybook:test` with zero axe violations.
- [ ] Focus-trap tests for `Drawer`, `Sheet`, and all three Modal patterns pass via `npm test`.
- [ ] `tsc --noEmit` is clean against the strict-mode config.
- [ ] Both `en` and `vi` locales render every story without layout breakage; Vietnamese error messages do not break inline error display layout.
- [ ] Writing editor FW-8 exemption is documented in three places: `FormFieldWrapper.tsx` JSDoc, `FormSection.tsx` JSDoc, `FormModal.tsx` JSDoc, AND `classlite-web/docs/storybook-conventions.md` (a "Writing editor exemption" section), AND a Storybook-visible `WritingEditorExemption` named export.
- [ ] At least one other frontend dev reviews the form wrappers' API + the writing-editor exemption documentation before merge.

## Out of Scope

- The writing editor itself (`WriteDocSurface`) — Epic 5 Story 5-3.
- The filter picker popover invoked by `FilterChipBar.onAddFilter` — Story 1d-6, deferred to consuming epics.
- The teacher-picker popover invoked by `AssignChip.onClick` — consuming epics (Epic 2 onboarding inline-invite, Epic 4 staff assign).
- The presigned R2 upload pipeline triggered by `BrandColorPicker.onLogoFileSelected` — consuming epics per XL-3.
- The task-completion mutation triggered by `TaskChecklistItem.onArrowClick` — consuming epics (Epic 2 onboarding handoff, dashboard day-1 wiring).
- `SessionModal` for schedule editing — Story 1d-8 (composes the `FormModal` pattern from here).
- `InviteStaffModal` and `UpgradeModal` — these compose `FormModal` and `ContentModal` from here; the staff/billing-specific fields ship in Epics 4 and Billing stories.
- Form-level submit error display (server-validation errors rendered above the form) — pattern is documented via `FormValidationError` from Story 1d-5; specific wiring per consumer.
- Mobile-specific drawer / modal variants — Chapter 8 mobile screens reuse the desktop `Drawer` for now; purpose-designed mobile bottom-sheets (e.g., `MobileQuestionReplyComposer`) ship per Epic 5/7 mobile stories.
