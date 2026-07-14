/**
 * Story 2-4 — `checklistDefinition` red-phase acceptance tests.
 *
 * Covers Task 2.5 per AC3 per-persona enumeration + resolver purity:
 *   - Operator: 7 items [S-BLOCKER-1 mockup s09 fidelity]
 *   - Founder: 7 items (identical enumeration to Operator)
 *   - Solo Teacher: 4 items [A-STRONG-7 resolved — Solo always has session.center]
 *
 * Contract highlights:
 *   - Resolvers read `ctx.currentCenter` NOT raw `ctx.session.center` [W-BLOCKER-4]
 *   - Resolvers `?.`-chain from `ctx.templateDraft` — never throw on null
 *     [A-STRONG-13]
 *   - `enrolStudents` badge is 'comingSoon' with resolver returning false in v1
 *     [S-INFO-20 + A-STRONG-14 — permanent-red judgment eliminated]
 *   - AC10 belt: no item id contains the substring `trial`
 *
 * ATDD contract: this file WILL fail to import until Amelia lands Task 2.4
 * (`src/features/dashboard/lib/checklistDefinition.ts`) — TS2307 is RED.
 */
import { describe, expect, test } from 'vitest'

import {
  checklistDefinition,
  type ChecklistCtx,
  type ChecklistItem,
} from '@/features/dashboard/lib/checklistDefinition'
import type { CenterSummary } from '@/features/auth/api/authKeys'

const CENTER_FIXTURE: CenterSummary = {
  id: 'c-1',
  name: 'Saigon English Center',
  shortCode: 'saigon-english',
  // eslint-disable-next-line no-restricted-syntax -- brand-color wire format (FU-2-3a-C)
  brandColor: '#1e3a8a',
  logoUrl: null,
  timezone: 'Asia/Ho_Chi_Minh',
}

const CTX_FRESH: ChecklistCtx = {
  currentCenter: CENTER_FIXTURE,
  templateDraft: null,
  teachersInvitedCount: 0,
}

const CTX_POST_2_3C_OPERATOR: ChecklistCtx = {
  currentCenter: CENTER_FIXTURE,
  templateDraft: {
    selectedTemplateId: 'tpl-1',
    spawnedClassIds: ['c1', 'c2'],
    classesDraft: [
      { cohortName: 'Batch A', startDate: '2026-08-15', teacherEmail: 'bob@example.com' },
      { cohortName: 'Batch B', startDate: '2026-08-15', teacherEmail: 'alice@example.com' },
    ],
  },
  teachersInvitedCount: 2,
}

describe('checklistDefinition — Task 2.5 per-persona enumeration + purity (AC3)', () => {
  // ---------------------------------------------------------------------
  // Enumeration count contracts
  // ---------------------------------------------------------------------
  test('Operator enumeration = 7 items (mockup s09 fidelity per S-BLOCKER-1)', () => {
    expect(checklistDefinition.operator).toHaveLength(7)
  })

  test('Founder enumeration = 7 items (identical to Operator)', () => {
    expect(checklistDefinition.founder).toHaveLength(7)
  })

  test('Solo Teacher enumeration = 4 items (drops templatePicked/teachersInvited/createMoreClasses)', () => {
    expect(checklistDefinition.solo_teacher).toHaveLength(4)
  })

  // ---------------------------------------------------------------------
  // Item id set contracts
  // ---------------------------------------------------------------------
  test('Operator item ids = [centerCreated, templatePicked, firstClassesSpawned, teachersInvited, enrolStudents, createMoreClasses, addResources]', () => {
    const ids = checklistDefinition.operator.map((i) => i.id)
    expect(ids).toEqual([
      'centerCreated',
      'templatePicked',
      'firstClassesSpawned',
      'teachersInvited',
      'enrolStudents',
      'createMoreClasses',
      'addResources',
    ])
  })

  test('Solo Teacher item ids = [centerCreated, firstClassSpawned, enrolStudents, addResources]', () => {
    const ids = checklistDefinition.solo_teacher.map((i) => i.id)
    expect(ids).toEqual([
      'centerCreated',
      'firstClassSpawned',
      'enrolStudents',
      'addResources',
    ])
  })

  // ---------------------------------------------------------------------
  // AC10 no-trial belt
  // ---------------------------------------------------------------------
  test('AC10 belt: no item id contains the substring "trial"', () => {
    const allItems: ChecklistItem[] = [
      ...checklistDefinition.operator,
      ...checklistDefinition.founder,
      ...checklistDefinition.solo_teacher,
    ]
    for (const item of allItems) {
      expect(item.id.toLowerCase()).not.toMatch(/\btrial\b/)
      expect(item.targetPath.toLowerCase()).not.toMatch(/\btrial\b/)
    }
  })

  // ---------------------------------------------------------------------
  // AC3 badge contracts (S-INFO-20 + A-STRONG-14)
  // ---------------------------------------------------------------------
  test('`enrolStudents` badge is "comingSoon" for Operator (S-INFO-20 permanent-red elimination)', () => {
    const item = checklistDefinition.operator.find((i) => i.id === 'enrolStudents')
    expect(item?.badge).toBe('comingSoon')
  })

  test('`enrolStudents` badge is "comingSoon" for Solo Teacher (same rationale)', () => {
    const item = checklistDefinition.solo_teacher.find((i) => i.id === 'enrolStudents')
    expect(item?.badge).toBe('comingSoon')
  })

  test('`centerCreated` badge is "required" (auto-done on landing)', () => {
    const item = checklistDefinition.operator.find((i) => i.id === 'centerCreated')
    expect(item?.badge).toBe('required')
  })

  test('`addResources` badge is "optional" (mockup s09:7669)', () => {
    const item = checklistDefinition.operator.find((i) => i.id === 'addResources')
    expect(item?.badge).toBe('optional')
  })

  // ---------------------------------------------------------------------
  // Resolver purity — Solo edge with null templateDraft (A-STRONG-13)
  // ---------------------------------------------------------------------
  test('Solo Teacher with null templateDraft — no resolver throws (A-STRONG-13)', () => {
    for (const item of checklistDefinition.solo_teacher) {
      expect(() => item.isDone(CTX_FRESH)).not.toThrow()
    }
  })

  test('Operator with null templateDraft — no resolver throws', () => {
    for (const item of checklistDefinition.operator) {
      expect(() => item.isDone(CTX_FRESH)).not.toThrow()
    }
  })

  // ---------------------------------------------------------------------
  // Resolver correctness — fresh state (only centerCreated done)
  // ---------------------------------------------------------------------
  test('Operator fresh state (only centerCreated resolves true) → 1/7', () => {
    const doneCount = checklistDefinition.operator.filter((i) => i.isDone(CTX_FRESH)).length
    expect(doneCount).toBe(1)
  })

  // ---------------------------------------------------------------------
  // Resolver correctness — post-2-3c state
  // ---------------------------------------------------------------------
  test('Operator post-2-3c state (center + template + spawned + 2 teachers) → 4 required done + 3 optional-permanently-false = 4/7', () => {
    const done = checklistDefinition.operator.filter((i) => i.isDone(CTX_POST_2_3C_OPERATOR))
    const doneIds = done.map((i) => i.id).sort()
    expect(doneIds).toEqual(
      ['centerCreated', 'firstClassesSpawned', 'teachersInvited', 'templatePicked'].sort(),
    )
  })

  test('`enrolStudents` resolver returns false in v1 regardless of ctx (no data source)', () => {
    const item = checklistDefinition.operator.find((i) => i.id === 'enrolStudents')
    expect(item?.isDone(CTX_POST_2_3C_OPERATOR)).toBe(false)
  })

  test('`createMoreClasses` resolver returns false in v1 (no dashboard signal)', () => {
    const item = checklistDefinition.operator.find((i) => i.id === 'createMoreClasses')
    expect(item?.isDone(CTX_POST_2_3C_OPERATOR)).toBe(false)
  })

  test('`addResources` resolver returns false in v1', () => {
    const item = checklistDefinition.operator.find((i) => i.id === 'addResources')
    expect(item?.isDone(CTX_POST_2_3C_OPERATOR)).toBe(false)
  })

  // ---------------------------------------------------------------------
  // W-BLOCKER-4 — resolver source-of-truth
  // ---------------------------------------------------------------------
  test('`centerCreated` resolver reads ctx.currentCenter (NOT raw session.center)', () => {
    const item = checklistDefinition.operator.find((i) => i.id === 'centerCreated')
    // With currentCenter set → true
    expect(item?.isDone(CTX_FRESH)).toBe(true)
    // With currentCenter cleared → false
    expect(item?.isDone({ ...CTX_FRESH, currentCenter: null as never })).toBe(false)
  })

  test('`templatePicked` resolver honors `buildFromScratch === true` OR `selectedTemplateId != null`', () => {
    const item = checklistDefinition.operator.find((i) => i.id === 'templatePicked')
    expect(item?.isDone({
      ...CTX_FRESH,
      templateDraft: { selectedTemplateId: 'tpl-1' },
    })).toBe(true)
    expect(item?.isDone({
      ...CTX_FRESH,
      templateDraft: { selectedTemplateId: null, buildFromScratch: true },
    })).toBe(true)
    expect(item?.isDone({
      ...CTX_FRESH,
      templateDraft: { selectedTemplateId: null },
    })).toBe(false)
  })

  test('`firstClassesSpawned` resolver: length > 0 → true; empty/undefined → false', () => {
    const item = checklistDefinition.operator.find((i) => i.id === 'firstClassesSpawned')
    expect(item?.isDone({
      ...CTX_FRESH,
      templateDraft: { selectedTemplateId: 'tpl-1', spawnedClassIds: ['c1'] },
    })).toBe(true)
    expect(item?.isDone({
      ...CTX_FRESH,
      templateDraft: { selectedTemplateId: 'tpl-1', spawnedClassIds: [] },
    })).toBe(false)
    expect(item?.isDone({
      ...CTX_FRESH,
      templateDraft: { selectedTemplateId: 'tpl-1' },
    })).toBe(false)
  })

  test('`teachersInvited` resolver: reads ctx.teachersInvitedCount, not raw classesDraft', () => {
    const item = checklistDefinition.operator.find((i) => i.id === 'teachersInvited')
    expect(item?.isDone({ ...CTX_FRESH, teachersInvitedCount: 3 })).toBe(true)
    expect(item?.isDone({ ...CTX_FRESH, teachersInvitedCount: 0 })).toBe(false)
  })
})
