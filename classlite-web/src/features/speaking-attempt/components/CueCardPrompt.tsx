/**
 * CueCardPrompt — Story 5.4 Task 6 (AC3, Sally S2). The speaking cue card: an s33
 * blockquote with a RED left-border (`--cl-red`), `lang="en"` on the whole block
 * so a screen reader switches voices for the English prompt read to a (often
 * Vietnamese) student. It is BOUNDED in its own scroll region (`max-h` + overflow)
 * so a long prompt never pushes the record control below the fold (AC21).
 */
export interface CueCardPromptProps {
  /** The cue-card prompt text (joined from `exercise.sections[].content`). */
  prompt: string
}

export function CueCardPrompt({ prompt }: CueCardPromptProps) {
  return (
    <blockquote
      lang="en"
      data-testid="speaking-cue-card"
      className="max-h-48 overflow-y-auto rounded-r-md border-l-4 border-[color:var(--cl-red)] bg-[color:var(--cl-tint-red)] py-3 pr-3 pl-4 text-sm whitespace-pre-wrap text-[color:var(--cl-ink)]"
    >
      {prompt}
    </blockquote>
  )
}
