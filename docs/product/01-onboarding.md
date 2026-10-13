# Chapter 1 — Onboarding

_Product oracle shard for Chapter 1 (`s00`–`s05`). **Fully reconciled against the shipped build** by
Story 11-3a (the Chapter-1 pilot) at `verified-sha: e4904b6` on 2026-10-13. This is the authoritative
spec for onboarding; it supersedes the archived prototype `01-owner-onboarding.html`._

> Authored against the frozen [`SCHEMA.md`](./SCHEMA.md): Purpose / Route / Roles / Controls / States
> / Behaviours / Out of scope, with `sNN/aN` assertion IDs, `must`/`should`/`may` strengths, `sNN/…`
> control slugs, and a `_vi:_` bilingual view per normative statement. VN views are **dev-drafted,
> pending native review** (DD7) — flagged inline where idiom matters.

**Source of truth read against:** `classlite-web/src/features/onboarding/**` (the shipped onboarding
wizard) + `src/routes.tsx` (routes) + `src/locales/{en,vi}.json` (strings). The onboarding **persona
→ role** mapping (Operator→Admin, Founder→Owner, Solo→Teacher) is in [`index.md`](./index.md).

### Universal Chapter-1 behaviours (apply to every screen below)

- **[s-ch1/a1 · must]** Onboarding renders in a full-bleed wizard shell with **no sidebar and no
  topbar**; the only chrome is the ClassLite wordmark (top-left) and the signed-in email + Sign-out
  (top-right). _(`OnboardingLayout.tsx` → `OnboardingChrome`.)_
  - _vi:_ Phần thiết lập hiển thị trong giao diện toàn màn hình, **không có thanh bên và không có
    thanh trên cùng**; chỉ có logo ClassLite (trên trái) và email đã đăng nhập + nút Đăng xuất (trên phải).
- **[s-ch1/a2 · must]** A quiet **"Save and finish later"** exit is available on every step that holds
  draft state (`s01`/`s02`/`s03`/`s05`); it flushes the pending auto-save, then navigates to
  `/dashboard`. _(Shared `SaveAndFinishLaterLink`, label `onboarding.wizard.saveAndFinishLater`.)_ It
  is **not** present on `s00` (a one-shot POST, no draft) or `s04` (terminal, no form).
  - _vi:_ Trên mỗi bước có lưu nháp (`s01`/`s02`/`s03`/`s05`) đều có lối thoát nhẹ nhàng **"Lưu và
    hoàn tất sau"**; nó lưu nốt bản nháp rồi chuyển đến `/dashboard`. Không có trên `s00` hay `s04`.
- **[s-ch1/a3 · should]** The "skip this step" affordance from the design intent is realised as
  **optional fields + Save-and-finish-later**, not a dedicated per-step "Skip" button: steps advance
  with their required fields only (e.g. spawn students are optional; a class row needs only a teacher).
  _(Reconciliation note — the shipped build has no literal "Skip" control; see Deviations.)_
  - _vi:_ Khả năng "bỏ qua bước này" được hiện thực bằng **trường tuỳ chọn + Lưu và hoàn tất sau**,
    không phải nút "Bỏ qua" riêng.
- **[s-ch1/a4 · must]** The auto-save state is dual-rendered as two distinct controls — a visible
  node and an `sr-only` `aria-live="polite"` announcement — on every step that holds draft state
  (`s01`/`s02`/`s03`/`s05`). This is the canonical control-slug example (see [`SCHEMA.md` §4](./SCHEMA.md#4-control-slug-rule)).
  - _vi:_ Trạng thái tự động lưu được hiển thị song song bằng hai điều khiển riêng biệt — một phần
    nhìn thấy và một thông báo `sr-only` `aria-live="polite"` — trên mọi bước có lưu nháp.

---

## s00 — Persona pick

**Purpose.** The first screen a brand-new user sees: pick how you identify (Operator / Founder / Solo
teacher), which routes you into one of three onboarding flows. The product does not yet know your
persona, so there is no sidebar.

**Route.** `/welcome`

**Roles.** all _(pre-role; persona is chosen here)_

**Controls.**
- `s00/operator-card` — the **Operator** persona tile. Radio inside a `role="radiogroup"`
  (`RadioGroupTiles`), accessible name "Operator: …lede".
- `s00/founder-card` — the **Founder** persona tile.
- `s00/solo-card` — the **Solo teacher** persona tile.
- `s00/continue` — the **Continue** button (`onboarding.persona.continueCta`); shows a spinner
  (`data-testid="persona-continue-spinner"`) while the POST+PUT is in flight.

**States.**
- **Loading** — persona-progress skeleton: three card placeholders (`data-testid="skeleton-onboarding"`,
  `aria-busy="true"`).
- **Error** — `role="alert"` card with a generic message + a retry button
  (`onboarding.persona.error.retryCta`); a verification-required variant links to `/verify-email`, a
  rate-limited variant shows a seconds countdown.
- **Empty** — n/a (the three persona cards are static; never empty).

**Behaviours.**
- **[s00/a1 · must]** On first paint **no persona is selected** and `s00/continue` is **disabled**;
  it enables only once a persona is picked. _(`submitDisabled = selected === null || …`.)_
  - _vi:_ Khi mới hiển thị **chưa chọn vai trò nào** và nút Tiếp tục **bị vô hiệu hoá**; chỉ bật khi
    đã chọn một vai trò.
- **[s00/continue/a1 · must]** Clicking Continue runs, in order, `POST /api/onboarding/persona` →
  `PUT /api/onboarding/progress` (currentStep `center`) → navigate to `/setup/center`.
  - _vi:_ Nhấn Tiếp tục sẽ chạy tuần tự: lưu vai trò → cập nhật tiến trình → chuyển đến `/setup/center`.
- **[s00/a2 · must]** On mount, if saved progress exists the screen **resumes** to the correct step
  for the persona (e.g. a returning Solo teacher mid-flow lands on `/setup/first-class`, not
  `/setup/template`); a `currentStep: done` resumes to `/dashboard`.
  - _vi:_ Khi tải, nếu đã có tiến trình đã lưu, màn hình **tiếp tục** đúng bước theo vai trò; nếu đã
    `done` thì chuyển đến `/dashboard`.
- **[s00/a3 · should]** A server persona value that fails the enum is treated as "no selection"
  (keeps Continue disabled) rather than rendering a phantom checked state. _(`isPersonaValue` guard.)_
  - _vi:_ Giá trị vai trò không hợp lệ từ máy chủ được coi như "chưa chọn", không hiển thị trạng thái
    đã chọn giả.
- **[s00/a4 · may]** The auto-save indicator is **intentionally absent** here — persona pick is a
  one-shot POST with no draft, so an idle "Auto-save on" affordance would mislead. _(R1-P29.)_
  - _vi:_ Chỉ báo tự động lưu **cố ý không xuất hiện** ở đây vì chọn vai trò là thao tác một lần, không
    có bản nháp.

**Out of scope.**
- No sidebar/nav (persona unknown). No center/class creation (that is `s01`–`s03`/`s05`).
- No "Save and finish later" (nothing to save yet).

---

## s01 — Center setup

**Purpose.** Operator/Founder names and brands their center (step 2 of 4). Produces the center the
rest of the wizard needs.

**Route.** `/setup/center`

**Roles.** operator, founder

**Controls.**
- `s01/center-name` — the center **name** text input (`id="center-name"`, placeholder
  `onboarding.center.form.namePlaceholder`). Drives the live short-code (`<shortCode>.classlite.app`)
  and letter-mark previews.
- `s01/brand-color` — the **brand color** radiogroup (`RadioGroupTiles`, labelled by
  `onboarding.center.form.brandingLabel`).
- `s01/save-continue` — the **Save & continue** submit button (`onboarding.center.form.saveContinueCta`).
- `s01/save-finish-later` — the shared **Save and finish later** link.
- `s01/auto-save-indicator` — visible auto-save status node (`data-testid="auto-save-indicator"`).
- `s01/auto-save-announcement` — `sr-only` `aria-live="polite"` auto-save announcement.

**States.**
- **Loading** — the shell skeleton while the session/progress resolves.
- **Error** — `role="alert"` with branches: `rateLimited` (seconds countdown), `alreadyHasCenter`
  (hint + "Open Dashboard" + contact-support), `verificationRequired` (link to `/verify-email`);
  shows the `requestId` when present.
- **Empty** — n/a (single form).

**Behaviours.**
- **[s01/center-name/a1 · must]** The center name is **required**; the form does not submit with an
  empty name (RHF + Zod validation surfaces the field error).
  - _vi:_ Tên trung tâm là **bắt buộc**; biểu mẫu không gửi khi tên trống.
- **[s01/a1 · should]** A live preview reflects input as the user types: the letter-mark initials and
  the `<shortCode>.classlite.app` subdomain preview update from the name and brand color.
  - _vi:_ Bản xem trước cập nhật tức thời theo nội dung nhập: chữ cái viết tắt và tên miền phụ
    `<shortCode>.classlite.app` thay đổi theo tên và màu thương hiệu.
- **[s01/save-continue/a1 · must]** Submitting creates the center then advances the wizard
  (PUT progress → next step); on a `USER_ALREADY_HAS_CENTER` 409 the screen offers a recovery path to
  `/dashboard` rather than dead-ending.
  - _vi:_ Khi gửi, hệ thống tạo trung tâm rồi chuyển bước tiếp theo; nếu gặp lỗi đã-có-trung-tâm (409),
    màn hình đưa ra lối đi đến `/dashboard` thay vì bế tắc.
- **[s01/save-finish-later/a1 · must]** Save-and-finish-later flushes the pending auto-save **before**
  navigating to `/dashboard`, so an in-flight draft is not lost. _(`await autoSave.flush()` in a
  `try/finally`.)_
  - _vi:_ "Lưu và hoàn tất sau" lưu nốt bản nháp **trước khi** chuyển đến `/dashboard`, để không mất
    bản nháp đang gửi.

**Out of scope.**
- No class/template creation (that is `s02`/`s03`). No logo upload in v1 (brand color + letter-mark
  only; `onboarding.center.form.uploadLogoCaption` describes the future affordance).

---

## s02 — Build template

**Purpose.** Operator/Founder picks a suggested IELTS template or chooses "build from scratch"
(step 3 of 4), with an editable preview before continuing.

**Route.** `/setup/template`

**Roles.** operator, founder

**Controls.**
- `s02/template-grid` — the template choice **radiogroup** (`RadioGroupTiles`, labelled by the page
  heading `template-page-heading`); one tile per suggested template.
- `s02/build-from-scratch` — the **Build from scratch** tile (radio option).
- `s02/continue` — the **Continue** button (`onboarding.template.continueCta`); disabled until a
  choice is made.
- `s02/save-finish-later` — shared Save-and-finish-later link.
- `s02/auto-save-indicator`, `s02/auto-save-announcement` — the dual-render auto-save pair.

**States.**
- **Loading** — four template skeleton tiles (`data-testid="template-skeleton-0…3"`, `aria-busy`).
- **Error** — `role="alert"`: a generic variant (with `requestId` + retry) and a `SEED_INCOMPLETE`
  variant (`onboarding.template.error.seedIncomplete`, no retry — a server-data problem).
- **Empty** — n/a (Build-from-scratch is always present even with zero suggested templates).

**Behaviours.**
- **[s02/a1 · must]** Continue is **disabled** until a template (or Build-from-scratch) is selected.
  - _vi:_ Nút Tiếp tục **bị vô hiệu hoá** cho đến khi chọn một mẫu (hoặc Tạo từ đầu).
- **[s02/a2 · should]** Selecting a template reveals an editable **preview** before Continue is taken.
  - _vi:_ Chọn một mẫu sẽ hiện bản **xem trước** có thể chỉnh sửa trước khi nhấn Tiếp tục.
- **[s02/continue/a1 · must]** Continue persists the choice (PUT progress) and advances to
  `/setup/spawn`.
  - _vi:_ Tiếp tục lưu lựa chọn và chuyển đến `/setup/spawn`.

**Out of scope.**
- No class spawning here (that is `s03`). The Founder self-assignment pre-flag is a **variant of this
  screen** (see Persona variants), not a separate screen.

---

## s03 — Spawn classes

**Purpose.** Operator/Founder duplicates the chosen template into N classes (step 3/4 continued),
each with a required teacher (inline-invite) and optional students.

**Route.** `/setup/spawn`

**Roles.** operator, founder

**Controls.**
- `s03/class-row` — a repeatable class row (`ClassRow`): cohort name, start date, and a teacher
  **assign chip** that opens an inline-invite composer (`AssignTeacherComposer`).
- `s03/add-class` — the **Add class** button (`onboarding.spawn.addClassCta`).
- `s03/save-spawn` — the **Save & spawn N** submit (`onboarding.spawn.saveAndSpawnCta`, pending form
  `…pending`).
- `s03/pick-template-instead` — in the build-from-scratch dead-end, the redirect back to
  `/setup/template` (`onboarding.spawn.pickTemplateInsteadCta`).
- `s03/save-finish-later` — shared Save-and-finish-later link.
- `s03/auto-save-indicator`, `s03/auto-save-announcement` — the dual-render auto-save pair.

**States.**
- **Loading** — spawn form skeleton (`data-testid="spawn-form-skeleton"`, `aria-busy`).
- **Resumed** — a `role="status"` draft-resumed toast (`onboarding.wizard.resumedFromDraft`).
- **Build-from-scratch dead-end** — an amber notice card explaining spawn needs a concrete template,
  with the `s03/pick-template-instead` redirect + an in-card Save-and-finish-later.
- **Error** — `role="alert"` rate-limit and generic variants; a non-blocking `role="status"`
  auto-save warning (`onboarding.spawn.error.autoSaveWarning`).

**Behaviours.**
- **[s03/class-row/a1 · must]** Each class row requires a **teacher** (required, inline-invitable);
  students are **optional**.
  - _vi:_ Mỗi lớp **bắt buộc** có một giáo viên (có thể mời trực tiếp); học viên là **tuỳ chọn**.
- **[s03/a1 · must]** At least one class row is always present (the last row cannot be removed;
  `onboarding.spawn.rowMinimum`).
  - _vi:_ Luôn có ít nhất một lớp (không thể xoá lớp cuối cùng).
- **[s03/save-spawn/a1 · must]** Save & spawn creates the N classes and advances the wizard; the CTA
  reflects the row count and shows a pending form while the request is in flight.
  - _vi:_ "Lưu & tạo lớp" tạo N lớp rồi chuyển bước; nút hiển thị số lớp và trạng thái đang xử lý.
- **[s03/a2 · should]** When the template was "build from scratch", spawn is a **dead-end** until the
  user picks a concrete template; Save-and-finish-later remains available from inside the amber card.
  - _vi:_ Khi mẫu là "tạo từ đầu", bước tạo lớp **bế tắc** cho đến khi chọn một mẫu cụ thể; vẫn có
    "Lưu và hoàn tất sau" trong thẻ màu hổ phách.

**Out of scope.**
- No billing/plan-limit enforcement in onboarding. The Founder "first class auto-assigned to me"
  behaviour is a **variant of this screen** (see Persona variants), not a separate screen.

---

## s04 — Done — Operator/Founder

**Purpose.** The terminal celebration screen: confirms the center is live, summarises what was
created, and hands off to the dashboard. **Also serves the Solo persona** (a `done` variant — see
Persona variants).

**Route.** `/setup/done`

**Roles.** operator, founder _(+ solo as a persona variant — the shipped `DoneHeroPanel` branches on
all three personas)_

**Controls.**
- `s04/open-dashboard` — the **Open Dashboard →** CTA (`onboarding.done.openDashboardCta`).
- `s04/stat-classes` — the "classes ready" stat tile (`data-testid="stat-tile-classes"`).
- `s04/stat-teachers` — the "teachers invited" stat tile (`data-testid="stat-tile-teachers"`).
- `s04/stat-subdomain` — the center-subdomain stat tile (`data-testid="stat-tile-subdomain"`).

**States.**
- **Loading** — done skeleton (`data-testid="skeleton-done"`).
- **Error** — `role="alert"` with a retry; after a threshold of consecutive refetch failures it shows
  a persistent variant (`data-testid="done-error-persistent"`) and emits a Sentry breadcrumb once.
- **Setup-incomplete** — if the progress payload has no spawned class ids, a `role="alert"
  aria-live="assertive"` alert offers Retry or Continue-to-dashboard
  (`onboarding.done.error.setupIncomplete`).

**Behaviours.**
- **[s04/a1 · must]** The hero greets by center name and renders a **persona-forked subtitle**
  (`onboarding.done.subtitle.{operator|founder|solo_teacher}`) over three stat tiles (classes ready,
  teachers invited, subdomain).
  - _vi:_ Phần tiêu đề chào theo tên trung tâm và hiển thị phụ đề **theo từng vai trò** trên ba ô thống
    kê (số lớp, số giáo viên đã mời, tên miền phụ).
- **[s04/open-dashboard/a1 · must]** Open Dashboard navigates to `/dashboard` (`replace`), leaving the
  wizard for the real product.
  - _vi:_ "Mở Bảng điều khiển" chuyển đến `/dashboard`, rời khỏi phần thiết lập để vào sản phẩm thật.
- **[s04/a2 · may]** No auto-save indicator and no Save-and-finish-later here — the screen is a pure
  consumer with no draft (R1-P29 / Task 1.3).
  - _vi:_ Không có chỉ báo tự động lưu hay "Lưu và hoàn tất sau" ở đây vì màn hình không có bản nháp.

**Out of scope.**
- No editing of what was created (that lives in the real product). Teacher/Founder/Solo wording
  differences are copy variants, not separate screens.

---

## s05 — Solo first class

**Purpose.** The Solo-teacher fast path (their only setup step): one class form with the teacher
locked to "you" and no center-management surface. On submit it hands off to the `s04` done variant.

**Route.** `/setup/first-class`

**Roles.** solo

**Controls.**
- `s05/cohort-name` — the class **cohort name** input (`onboarding.spawn.cohortName.label`/placeholder).
- `s05/start-date` — the **start date** input (`type="date"`, `onboarding.spawn.startDate.label`).
- `s05/teacher-locked` — the teacher **assign chip**, locked to self (`AssignChip lockedTo="self"`,
  `onboarding.solo.teacher.locked`); non-interactive.
- `s05/template-ribbon` — the template **ribbon** (`TemplateRibbon`, first 4 templates).
- `s05/save-spawn` — the **Save & spawn** submit (`onboarding.solo.saveAndSpawnCta`).
- `s05/save-finish-later` — shared Save-and-finish-later link.
- `s05/auto-save-indicator`, `s05/auto-save-announcement` — the dual-render auto-save pair.

**States.**
- **Loading** — solo form skeleton (`data-testid="solo-form-skeleton"`) + a template-ribbon skeleton.
- **Build-from-scratch dead-end** — amber notice + "pick a template instead" (same shape as `s03`).
- **Error** — `role="alert"` rate-limit + generic variants; non-blocking `role="status"` auto-save
  warning.

**Behaviours.**
- **[s05/teacher-locked/a1 · must]** The teacher is **locked to the current user** ("you") and cannot
  be reassigned — the Solo workspace has exactly one teacher.
  - _vi:_ Giáo viên bị **khoá là chính người dùng** ("bạn") và không thể đổi — không gian Solo chỉ có
    đúng một giáo viên.
- **[s05/a1 · must]** No center-management surface is shown (no staff/enrolment/center nav) — Solo is
  a single-user workspace.
  - _vi:_ Không hiển thị bề mặt quản lý trung tâm (không có nhân sự/ghi danh) — Solo là không gian một
    người dùng.
- **[s05/save-spawn/a1 · must]** Submitting creates the class, bumps progress to `currentStep: done`,
  and navigates to `/setup/done` (the Solo `done` variant of `s04`).
  - _vi:_ Khi gửi, hệ thống tạo lớp, đặt tiến trình `done` và chuyển đến `/setup/done` (biến thể Solo
    của `s04`).

**Out of scope.**
- No multi-class spawning (that is the Operator/Founder `s03`). No teacher invitation (teacher is
  self).

---

## Persona / state variants — the IA's `s06`–`s09` onboarding "extra" screens (NOT new IDs)

The original IA numbered onboarding `s00`–`s09` (10 screens). The frozen manifest
([`screens.yaml`](./screens.yaml)) keeps **one entry per `sNN`**, so `s06`–`s09` carry their
**teacher** meaning in Chapter 2. The IA's own wording ("same shape as s04 / same as s02 / same as
s03") shows its onboarding `s06`–`s09` were never distinct screens — they are **persona/state
variants** of canonical Chapter-1 screens, and the shipped build confirms it (one component per
canonical screen, persona-branched inside):

| IA onboarding label | Reconciled as | Evidence in the build |
|---|---|---|
| IA `s06` "Done — Solo" | **variant of `s04`** | `OnboardingDonePage` → `DoneHeroPanel` branches on `persona === 'solo_teacher'` (subtitle `onboarding.done.subtitle.solo_teacher`). |
| IA `s07` "Founder build template" | **variant of `s02`** | Same `TemplateSelectPage`; the Founder self-assignment pre-flag is a persona branch, not a new route. |
| IA `s08` "Founder spawn" | **variant of `s03`** | Same `ClassSpawnPage`; Founder's first class auto-assigned is a persona branch. |
| IA `s09` "Dashboard handoff" | **the onboarding state of the dashboard** (`s06`/`s29`/`s48`) | After onboarding the user lands on their real dashboard with a "finish setting up" card; that is a dashboard state, documented in Chapter 2/3/5, not an onboarding screen. |

No `sNN` token was renumbered anywhere in the repo to make this reconciliation; it is purely a
documentation decision (DD1) that matches both the IA's wording and the shipped components.

---

## Deviations found during reconciliation _(verified against `e4904b6`)_

1. **No literal "Skip this step" control.** The IA prose promised a "skip-this-step pattern"; the
   shipped wizard realises it as optional fields + the Save-and-finish-later exit, not a dedicated
   Skip button (see `[s-ch1/a3 · should]`). The oracle documents the shipped reality.
2. **The dual-render "Auto-save on" lives on the onboarding shell, not only `s34`/`s78`.** The epic's
   provisional `s24` was wrong (Speaking-grading); DD6 re-pointed it to the writing editor
   (`s34`/`s78`). The grep shows the **true two-node dual-render** (separate visible + `sr-only`
   nodes, literal "Auto-save on") is the onboarding `AutoSaveIndicator` on `s01`/`s02`/`s03`/`s05`
   — i.e. **this chapter**. `s34`/`s78` use a single combined node. The [`SCHEMA.md` §4](./SCHEMA.md#4-control-slug-rule)
   worked example documents both and is the canonical control-slug demonstration. _(Flagged for Ducdo.)_
3. **VN views are dev-drafted, pending native review** (DD7).
