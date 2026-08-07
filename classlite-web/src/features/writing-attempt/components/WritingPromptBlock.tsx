/**
 * WritingPromptBlock — Story 5.3 Task 2 (AC3, Sally S8). The task prompt renders
 * as a blockquote ABOVE the editor, carrying `lang="en"` on the WHOLE block: it is
 * English prose read to a (often Vietnamese) student, so the block-level language
 * hint lets a screen reader switch voices for the entire prompt (term-level `lang`
 * is insufficient). `white-space: pre-wrap` preserves prompt paragraph breaks.
 */
export interface WritingPromptBlockProps {
  /** The prompt text (joined from `exercise.sections[].content`). */
  prompt: string
}

export function WritingPromptBlock({ prompt }: WritingPromptBlockProps) {
  return (
    <blockquote
      lang="en"
      data-testid="writing-prompt"
      className="mb-4 border-l-2 border-[color:var(--cl-line-soft)] pl-4 text-sm whitespace-pre-wrap text-[color:var(--cl-ink-soft)]"
    >
      {prompt}
    </blockquote>
  )
}
