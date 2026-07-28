/**
 * editorDocument — Story 4.2. Pure, immutable edit operations on the working
 * document at the SECTION level (the page's concern). Group/question edits are
 * composed inside the section/group cards, which hand a fully-formed next slice
 * back up (controlled-component composition). Order IS array position — there
 * is no `position` field (mirrors template_crud.go array-index ordering).
 */
import type {
  EditorDocument,
  ExerciseSection,
  ExerciseSectionType,
  ExerciseSettings,
} from './editorTypes'
import { newSection } from './sectionTypes'

/** Immutably moves items[from] to index `to`. Out-of-range or no-op returns the
 * same array reference (so a bounced drag never dirties the document). */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || to < 0 || to >= items.length || from < 0 || from >= items.length) {
    return items
  }
  const next = items.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

function withSections(doc: EditorDocument, sections: ExerciseSection[]): EditorDocument {
  return { ...doc, content: { ...doc.content, sections } }
}

export function addSection(doc: EditorDocument, type: ExerciseSectionType): EditorDocument {
  return withSections(doc, [...doc.content.sections, newSection(type)])
}

export function replaceSection(
  doc: EditorDocument,
  index: number,
  section: ExerciseSection,
): EditorDocument {
  return withSections(
    doc,
    doc.content.sections.map((s, i) => (i === index ? section : s)),
  )
}

export function deleteSection(doc: EditorDocument, index: number): EditorDocument {
  return withSections(
    doc,
    doc.content.sections.filter((_, i) => i !== index),
  )
}

export function moveSection(doc: EditorDocument, from: number, to: number): EditorDocument {
  const moved = moveItem(doc.content.sections, from, to)
  if (moved === doc.content.sections) return doc
  return withSections(doc, moved)
}

export function updateSettings(
  doc: EditorDocument,
  patch: Partial<ExerciseSettings>,
): EditorDocument {
  return { ...doc, content: { ...doc.content, settings: { ...doc.content.settings, ...patch } } }
}
