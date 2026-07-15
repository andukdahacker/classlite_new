/**
 * checklistDefinition — per-persona ordered list of "Finish setting up"
 * items rendered by `<FinishSetupCard>`.
 *
 * Story 2-4 AC3. Contract highlights:
 *   - Closed literal `Record<Persona, ChecklistItem[]>` — no dynamic
 *     construction; the shape is grep-stable across the codebase.
 *   - Enumeration counts: Operator 7 / Founder 7 / Solo Teacher 4 [mockup
 *     s09 fidelity per S-BLOCKER-1 / A-STRONG-7].
 *   - Resolvers read `ctx.currentCenter` — NOT raw `ctx.session.center`
 *     [W-BLOCKER-4]. AC1 selector and per-item completion agree on the
 *     same snapshot.
 *   - Resolvers `?.`-chain from `ctx.templateDraft` [A-STRONG-13] — Solo
 *     Teacher's null `templateDraft` (never touched a template) must not
 *     throw.
 *   - `enrolStudents` badge is `comingSoon` [S-INFO-20 + A-STRONG-14] with
 *     resolver returning `false` in v1 — Story 2.7 makes it completable.
 *   - `createMoreClasses` and `addResources` badge is `optional` with
 *     resolver returning `false` in v1 (no dashboard signal for these yet;
 *     Story 3.1 / Story 4.4 wire them).
 *   - NO_TRIAL_MECHANIC_V1 — AC10 belt: no item id contains the substring `trial`; no targetPath routes to `/upgrade` or `/trial`.
 */
import type { CenterSummary } from '@/features/auth/api/authKeys'
import type { TemplateDraftPayload } from '@/lib/onboardingPayload'

export type Persona = 'operator' | 'founder' | 'solo_teacher'

export type ChecklistBadge =
  | 'done'
  | 'required'
  | 'optional'
  | 'comingSoon'

export type ChecklistTargetSurface =
  | 'settings'
  | 'billing'
  | 'students'
  | 'classes'
  | 'templates'
  | 'resources'
  | 'people'
  | 'grading'

export interface ChecklistCtx {
  currentCenter: CenterSummary | null
  templateDraft: TemplateDraftPayload | null
  teachersInvitedCount: number
}

export interface ChecklistItem {
  id: string
  i18nKey: string
  // Optional "short subtitle" key per AC2 mockup fidelity — omitted on v1
  // items; kept on the interface so FinishSetupCard can wire subtitles
  // without a downstream type touch.
  subtitleKey?: string
  badge: Exclude<ChecklistBadge, 'done'>
  isDone: (ctx: ChecklistCtx) => boolean
  targetPath: string
  targetSurface: ChecklistTargetSurface
  epicNum: number
  // Story 2-5a AC12 — when true, FinishSetupCard renders a real `<button
  // onClick={() => navigate(targetPath)}>` instead of `<DeadLinkTrigger>`.
  // Only `centerCreated` (target `/settings`) graduates in 2-5a; other
  // dead-link targets stay unresolved until their owning stories ship.
  targetShipped?: boolean
}

// ---------------------------------------------------------------------------
// Shared item defs — Operator and Founder enumerations are identical.
// ---------------------------------------------------------------------------
const centerCreated: ChecklistItem = {
  id: 'centerCreated',
  i18nKey: 'dashboard.checklist.item.centerCreated.name',
  badge: 'required',
  isDone: (ctx) => ctx.currentCenter != null,
  targetPath: '/settings',
  targetSurface: 'settings',
  epicNum: 2,
  // Story 2-5a AC12 — /settings ships in this story, so FinishSetupCard
  // navigates instead of firing the DeadLinkTrigger placeholder.
  targetShipped: true,
}

const templatePicked: ChecklistItem = {
  id: 'templatePicked',
  i18nKey: 'dashboard.checklist.item.templatePicked.name',
  badge: 'required',
  isDone: (ctx) =>
    ctx.templateDraft?.selectedTemplateId != null ||
    ctx.templateDraft?.buildFromScratch === true,
  targetPath: '/templates',
  targetSurface: 'templates',
  epicNum: 3,
}

const firstClassesSpawned: ChecklistItem = {
  id: 'firstClassesSpawned',
  i18nKey: 'dashboard.checklist.item.firstClassesSpawned.name',
  badge: 'required',
  // Guard non-array wire drift — a string `spawnedClassIds` would report
  // `.length` as its char count and mark this item done spuriously.
  isDone: (ctx) => {
    const ids = ctx.templateDraft?.spawnedClassIds
    return Array.isArray(ids) && ids.length > 0
  },
  targetPath: '/classes',
  targetSurface: 'classes',
  epicNum: 3,
}

const teachersInvited: ChecklistItem = {
  id: 'teachersInvited',
  i18nKey: 'dashboard.checklist.item.teachersInvited.name',
  badge: 'required',
  isDone: (ctx) => ctx.teachersInvitedCount > 0,
  targetPath: '/people/staff',
  targetSurface: 'people',
  epicNum: 2,
}

const enrolStudents: ChecklistItem = {
  id: 'enrolStudents',
  i18nKey: 'dashboard.checklist.item.enrolStudents.name',
  badge: 'comingSoon',
  // v1: no student-enrolment data source on the FE — permanently pending.
  // Story 2.7 makes this completable. NO_TRIAL_MECHANIC_V1
  isDone: () => false,
  targetPath: '/students',
  targetSurface: 'students',
  epicNum: 2,
}

const createMoreClasses: ChecklistItem = {
  id: 'createMoreClasses',
  i18nKey: 'dashboard.checklist.item.createMoreClasses.name',
  badge: 'optional',
  // v1: no dashboard signal for "spawned a class after landing".
  // Story 3.1 wires this. NO_TRIAL_MECHANIC_V1
  isDone: () => false,
  targetPath: '/classes',
  targetSurface: 'classes',
  epicNum: 3,
}

const addResources: ChecklistItem = {
  id: 'addResources',
  i18nKey: 'dashboard.checklist.item.addResources.name',
  badge: 'optional',
  // v1: no signal. Story 4.4 wires knowledge hub. NO_TRIAL_MECHANIC_V1
  isDone: () => false,
  targetPath: '/knowledge-hub',
  targetSurface: 'resources',
  epicNum: 4,
}

const soloFirstClassSpawned: ChecklistItem = {
  // Solo Teacher's "first class" item — same resolver as Operator's
  // `firstClassesSpawned` (Solo lands on `/setup/first-class` which
  // populates the same `spawnedClassIds` field). Copy uses the SINGULAR
  // key (Solo only ever creates one class); shipped plural key stays
  // owned by Operator/Founder.
  id: 'firstClassSpawned',
  i18nKey: 'dashboard.checklist.item.firstClassSpawned.name',
  badge: 'required',
  isDone: (ctx) => {
    const ids = ctx.templateDraft?.spawnedClassIds
    return Array.isArray(ids) && ids.length > 0
  },
  targetPath: '/classes',
  targetSurface: 'classes',
  epicNum: 3,
}

// ---------------------------------------------------------------------------
// Per-persona ordered enumerations — the closed literal AC3 spec pins.
// ---------------------------------------------------------------------------
export const checklistDefinition: Record<Persona, ChecklistItem[]> = {
  operator: [
    centerCreated,
    templatePicked,
    firstClassesSpawned,
    teachersInvited,
    enrolStudents,
    createMoreClasses,
    addResources,
  ],
  founder: [
    centerCreated,
    templatePicked,
    firstClassesSpawned,
    teachersInvited,
    enrolStudents,
    createMoreClasses,
    addResources,
  ],
  solo_teacher: [
    // Solo drops templatePicked (implicit in single-class flow),
    // teachersInvited (Solo is the lone teacher — no invite loop), and
    // createMoreClasses (Solo v1 is single-class scope).
    centerCreated,
    soloFirstClassSpawned,
    enrolStudents,
    addResources,
  ],
}
