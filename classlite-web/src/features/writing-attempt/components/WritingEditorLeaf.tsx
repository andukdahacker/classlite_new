/**
 * WritingEditorLeaf — Story 5.3 Task 2 (AC2/AC6, D5, Winston BLOCKER 2). The
 * distraction-free plain-text writing surface as an ISOLATED, UNCONTROLLED leaf:
 *
 *  - a plain `<textarea>` (NOT React Hook Form — FW-8; NOT rich text; no new dep),
 *  - `defaultValue` seeded ONCE from the recovered draft (uncontrolled — the value
 *    is NEVER bound to the cache draft, which would reintroduce the banned
 *    per-keystroke shell re-render + per-keystroke `JSON.stringify`/`setItem`),
 *  - `onChange` writes the live-text store (a ref-like set); the count meter
 *    subscribes to that store, so a keystroke re-renders only the meter,
 *  - the Query-cache draft + the localStorage mirror are written on a DEBOUNCE via
 *    `onCommit` (the shell wires it to `setText` + `scheduleSave`), never per
 *    keystroke,
 *  - IME-composition-safe (Sally S9): the debounced commit is deferred until
 *    `compositionend` so a Vietnamese telex/VNI half-composed value is never PUT,
 *  - ≥16px font ON THE ELEMENT itself (iOS zoom-on-focus reads the input's own
 *    computed size), auto-growing.
 */
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import type { LiveTextStore } from '../lib/liveTextStore'

/** Default debounce before a committed write to the cache draft + mirror (AC2). */
export const WRITING_COMMIT_DEBOUNCE_MS = 600

export interface WritingEditorLeafProps {
  /** The live-text store shared with the word-count meter + the autosave getContent. */
  store: LiveTextStore
  /** The recovered draft text — seeds `defaultValue` exactly once (uncontrolled). */
  initialText: string
  /** Read-only attempts disable the textarea natively (AC16 — `toBeDisabled()`). */
  disabled: boolean
  /** Debounced commit of the settled text → cache draft + mirror + scheduleSave. */
  onCommit: (text: string) => void
  /** Accessible label for the textarea. */
  ariaLabel: string
  /** Placeholder shown on the blank baseline state (AC20 — "empty" is N/A). */
  placeholder: string
  /** Debounce override for tests (default 600ms). */
  debounceMs?: number
}

/** Auto-grow the textarea to its content height (a permitted imperative DOM op). */
function autoGrow(el: HTMLTextAreaElement): void {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

export function WritingEditorLeaf({
  store,
  initialText,
  disabled,
  onCommit,
  ariaLabel,
  placeholder,
  debounceMs = WRITING_COMMIT_DEBOUNCE_MS,
}: WritingEditorLeafProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const composingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Latest-value refs so the handlers stay stable and never re-arm on prop churn.
  const onCommitRef = useRef(onCommit)
  const debounceRef = useRef(debounceMs)
  useEffect(() => {
    onCommitRef.current = onCommit
    debounceRef.current = debounceMs
  })

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    }
  }, [])

  // On (re)mount, seed the uncontrolled textarea from the LIVE store and grow it
  // to the recovered content. `defaultValue` alone reverts to the FROZEN initial
  // seed on a remount (a breakpoint flip swaps the desktop/mobile subtree, which
  // remounts this leaf) — the next keystroke would then clobber the live text with
  // the stale seed. autoGrow otherwise only runs on change, so a recovered long
  // draft would render clipped until the first keystroke.
  useEffect(() => {
    const element = textareaRef.current
    if (element === null) return
    const live = store.get()
    if (element.value !== live) element.value = live
    autoGrow(element)
  }, [store])

  const scheduleCommit = () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      onCommitRef.current(store.get())
    }, debounceRef.current)
  }

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value
    autoGrow(event.target)
    // Live count tracks every change (isolated to the meter subscriber). The
    // DEBOUNCED commit (cache + mirror + autosave) is gated on composition so a
    // half-composed IME value is never persisted / PUT (Sally S9).
    store.set(value)
    if (!composingRef.current) scheduleCommit()
  }

  return (
    <textarea
      ref={textareaRef}
      data-testid="writing-editor-leaf"
      aria-label={ariaLabel}
      placeholder={placeholder}
      defaultValue={initialText}
      disabled={disabled}
      spellCheck
      onChange={handleChange}
      onCompositionStart={() => {
        composingRef.current = true
      }}
      onCompositionEnd={(event) => {
        composingRef.current = false
        store.set(event.currentTarget.value)
        scheduleCommit()
      }}
      // ≥16px ON THE ELEMENT (AC18, Sally S9): `text-base` = 1rem = 16px on the
      // textarea itself so iOS never zoom-on-focuses this input.
      className={cn(
        'min-h-[18rem] w-full resize-none bg-transparent font-sans text-base leading-relaxed text-foreground outline-none',
        'placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-70',
      )}
    />
  )
}
