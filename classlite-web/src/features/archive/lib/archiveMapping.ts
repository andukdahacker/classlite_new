/**
 * archiveMapping — Story 10.2 (AC8/AC9). Maps a wire `ArchiveItem` to the row
 * display + reuse-verb affordances the table renders (DD4/DD6).
 *
 * The archive is READ-ONLY (DD6): the only actions are Duplicate / Edit-a-copy,
 * and those exist for EXERCISES only (Ducdo D3) — a class row exposes NO reuse
 * verb (class clone is FU-10-2-CLASS-DUPLICATE).
 *
 * `editLink` carries the AC1 contract `link` for an exercise row
 * (`/exercises/{id}/edit`, the archived ORIGINAL; empty for a read-only class).
 * It is NOT the Edit-a-copy destination — Edit-a-copy duplicates first and
 * navigates to the NEW copy's id from the 201 (see ArchiveView.runDuplicate),
 * never to this field. Kept as the discriminated wire contract (AC1); do not
 * wire a row anchor to it expecting a copy.
 *
 * Null per-type fields (a class's skill/targetBand) never throw.
 */
import type { components } from '@/lib/api/client'

/** The wire shape of one archived item (class or exercise), discriminated by `type`. */
export type ArchiveItem = components['schemas']['ArchiveItem']

/** A row's display + action affordances derived from an ArchiveItem. */
export interface ArchiveRowData {
  id: string
  type: ArchiveItem['type']
  title: string
  /** Secondary label — the exercise code for exercises, empty for classes. */
  subtitle: string
  /** Exercise skill (null for classes). */
  skill: string | null
  /** Exercise target band (null for classes / unset). */
  targetBand: number | null
  /** Class lifecycle status (null for exercises). */
  classStatus: string | null
  /** ISO archive timestamp (deleted_at for exercises, ended_at for classes). */
  archivedAt: string
  /** Exercises only (Ducdo D3): clone the item in place. */
  canDuplicate: boolean
  /** Exercises only (Ducdo D3): clone then open the copy in the editor. */
  canEditCopy: boolean
  /**
   * AC1 contract `link` for an exercise (`/exercises/{id}/edit` — the archived
   * ORIGINAL); empty for read-only classes. NOT the Edit-a-copy destination
   * (that is the 201's new copy id, resolved in ArchiveView.runDuplicate).
   */
  editLink: string
}

/** Map a wire ArchiveItem to its row display + reuse-verb affordances. */
export function toArchiveRow(item: ArchiveItem): ArchiveRowData {
  const isExercise = item.type === 'exercise'
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    subtitle: item.subtitle,
    skill: item.skill,
    targetBand: item.targetBand,
    classStatus: item.classStatus,
    archivedAt: item.archivedAt,
    canDuplicate: isExercise,
    canEditCopy: isExercise,
    editLink: isExercise ? item.link : '',
  }
}
