/**
 * fragmentMerge — Story 4.3b (AC3). Pure, immutable merges of a generated
 * `ExerciseContent` fragment into the editor working document, one per mode.
 * Insertion is the teacher's explicit Accept — 4.3a's worker never touches the
 * exercise; here the fragment lands in `content` and 4.2's autosave persists it
 * (no new write path). Order IS array position (mirrors 4.2 / template_crud.go).
 *
 * The generated result is always a whole `ExerciseContent` (the 4.3a mapper wraps
 * every mode in a carrier section so the structural validator can vet it), so
 * each merge lifts the mode-relevant slice:
 *   - section     → append the generated section(s) verbatim
 *   - questions   → append the carrier section's groups to the TARGET section
 *   - distractors → lift the carrier MCQ's options onto the TARGET question
 */
import type { EditorDocument, ExerciseContent } from './editorTypes'
import { replaceSection } from './editorDocument'

/** Where an accepted fragment should land. `section` appends; the others target
 * an existing array position (the id-less content model has no real ids). */
export type InsertTarget =
  | { kind: 'section' }
  | { kind: 'questions'; sectionIndex: number }
  | { kind: 'distractors'; sectionIndex: number; groupIndex: number; questionIndex: number }

function appendGeneratedSections(
  doc: EditorDocument,
  fragment: ExerciseContent,
): EditorDocument {
  // No-op on an empty fragment (mirrors `appendGeneratedGroups`) so a degenerate
  // result doesn't schedule an autosave PATCH that writes identical content.
  if (fragment.sections.length === 0) return doc
  return {
    ...doc,
    content: {
      ...doc.content,
      sections: [...doc.content.sections, ...fragment.sections],
    },
  }
}

function appendGeneratedGroups(
  doc: EditorDocument,
  sectionIndex: number,
  fragment: ExerciseContent,
): EditorDocument {
  const target = doc.content.sections[sectionIndex]
  if (!target) return doc
  const generatedGroups = fragment.sections.flatMap((section) => section.questionGroups)
  if (generatedGroups.length === 0) return doc
  return replaceSection(doc, sectionIndex, {
    ...target,
    questionGroups: [...target.questionGroups, ...generatedGroups],
  })
}

function applyGeneratedDistractors(
  doc: EditorDocument,
  sectionIndex: number,
  groupIndex: number,
  questionIndex: number,
  fragment: ExerciseContent,
): EditorDocument {
  const generated = fragment.sections[0]?.questionGroups[0]?.questions[0]
  if (!generated) return doc
  const target = doc.content.sections[sectionIndex]
  const group = target?.questionGroups[groupIndex]
  const question = group?.questions[questionIndex]
  if (!target || !group || !question) return doc

  // Keep `correctAnswer` pointing at an option that exists in the NEW set
  // (options are replaced wholesale): prefer the generated key, else the
  // teacher's existing key if it survived, else clamp to the first option — so
  // we never orphan the answer onto a value no option holds.
  const nextOptions = generated.options
  const nextCorrectAnswer = nextOptions.includes(generated.correctAnswer)
    ? generated.correctAnswer
    : nextOptions.includes(question.correctAnswer)
      ? question.correctAnswer
      : (nextOptions[0] ?? '')
  const nextQuestion = {
    ...question,
    options: nextOptions,
    correctAnswer: nextCorrectAnswer,
  }
  const nextGroup = {
    ...group,
    questions: group.questions.map((q, i) => (i === questionIndex ? nextQuestion : q)),
  }
  return replaceSection(doc, sectionIndex, {
    ...target,
    questionGroups: target.questionGroups.map((g, i) => (i === groupIndex ? nextGroup : g)),
  })
}

/**
 * mergeGeneratedFragment — dispatch an accepted fragment to the right merge for
 * its target. Returns the same doc reference untouched when the target position
 * no longer exists (a defensive no-op — the editor's normal validity rules then
 * apply to whatever did land).
 */
export function mergeGeneratedFragment(
  doc: EditorDocument,
  target: InsertTarget,
  fragment: ExerciseContent,
): EditorDocument {
  switch (target.kind) {
    case 'section':
      return appendGeneratedSections(doc, fragment)
    case 'questions':
      return appendGeneratedGroups(doc, target.sectionIndex, fragment)
    case 'distractors':
      return applyGeneratedDistractors(
        doc,
        target.sectionIndex,
        target.groupIndex,
        target.questionIndex,
        fragment,
      )
  }
}
