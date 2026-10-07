/**
 * archiveMapping.golden.test.ts — Story 10-2 · AC8/AC9 (archive item → row mapper,
 * red-first compile seam).
 *
 * RED (compile): imports `../archiveMapping`, which does NOT exist yet, so `tsc -b`
 * FAILS on exactly this one module path (the single FE compile seam, mirroring
 * 10-1c's teacherQueueMapping.golden). The `ArchiveItem` input type is imported
 * from the SAME module so the red stays isolated to one seam (no second
 * not-yet-generated client-type import).
 *
 * GREEN SEAM: `src/features/archive/lib/archiveMapping.ts` exports
 *   - type ArchiveItem   (re-exported from the generated client, or a local alias)
 *   - toArchiveRow(item: ArchiveItem): ArchiveRowData
 * where ArchiveRowData carries at least { id, type, canDuplicate, canEditCopy,
 * editLink }. Behavioral contract (Ducdo D3/DD4/DD6):
 *   - exercise items expose BOTH reuse verbs (canDuplicate && canEditCopy) and an
 *     editLink of `/exercises/{id}/edit`;
 *   - class items are READ-ONLY (no reuse verbs);
 *   - null per-type fields (a class has null skill/targetBand) never throw.
 */
import { describe, it, expect } from 'vitest'

import { toArchiveRow, type ArchiveItem } from '../archiveMapping'

const exerciseItem: ArchiveItem = {
  type: 'exercise',
  id: 'ex-123',
  title: 'IELTS Task 2 — Environment',
  subtitle: 'Writing',
  archivedAt: '2026-08-01T10:00:00Z',
  classStatus: null,
  skill: 'writing',
  targetBand: 6,
  link: '/exercises/ex-123/edit',
}

const classItem: ArchiveItem = {
  type: 'class',
  id: 'cl-456',
  title: 'Evening IELTS — Spring 2026',
  subtitle: '',
  archivedAt: '2026-06-01T10:00:00Z',
  classStatus: 'ended',
  skill: null,
  targetBand: null,
  link: '',
}

describe('toArchiveRow (Story 10-2 archive mapper)', () => {
  it('maps an exercise item to a row with BOTH reuse verbs and the edit-copy link', () => {
    const row = toArchiveRow(exerciseItem)
    expect(row.type).toBe('exercise')
    expect(row.canDuplicate).toBe(true)
    expect(row.canEditCopy).toBe(true)
    expect(row.editLink).toBe('/exercises/ex-123/edit')
  })

  it('maps a class item to a READ-ONLY row — no reuse verbs (Ducdo D3)', () => {
    const row = toArchiveRow(classItem)
    expect(row.type).toBe('class')
    expect(row.canDuplicate).toBe(false)
    expect(row.canEditCopy).toBe(false)
  })

  it('is null-safe for a class with null skill/targetBand', () => {
    expect(() => toArchiveRow(classItem)).not.toThrow()
  })
})
