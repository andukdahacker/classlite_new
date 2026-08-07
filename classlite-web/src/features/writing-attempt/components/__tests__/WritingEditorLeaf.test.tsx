// Story 5.3 Task 2 (AC2/AC6/AC16/AC18) — the isolated uncontrolled editor leaf.
// Verifies: uncontrolled (defaultValue seeded once, value NOT bound to a prop);
// keystrokes update the live store; the cache/mirror commit is DEBOUNCED (N
// keystrokes → one commit, FW-4); IME composition defers the commit until
// compositionend (Sally S9); disabled = native read-only (AC16, toBeDisabled).
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createLiveTextStore } from '../../lib/liveTextStore'
import { WritingEditorLeaf } from '../WritingEditorLeaf'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function setup(
  overrides: Partial<React.ComponentProps<typeof WritingEditorLeaf>> = {},
) {
  const store = overrides.store ?? createLiveTextStore(overrides.initialText ?? '')
  const onCommit = vi.fn()
  render(
    <WritingEditorLeaf
      initialText=""
      disabled={false}
      ariaLabel="Your response"
      placeholder="Start writing…"
      debounceMs={500}
      {...overrides}
      store={store}
      onCommit={overrides.onCommit ?? onCommit}
    />,
  )
  return { store, onCommit: overrides.onCommit ?? onCommit }
}

describe('WritingEditorLeaf — uncontrolled + isolated (AC2)', () => {
  test('seeds defaultValue once from the recovered draft', () => {
    setup({ initialText: 'recovered essay' })
    const textarea = screen.getByTestId<HTMLTextAreaElement>('writing-editor-leaf')
    expect(textarea.value).toBe('recovered essay')
  })

  test('on mount, re-seeds the textarea from the LIVE store (survives a breakpoint remount)', () => {
    // A breakpoint flip remounts the leaf: `defaultValue` alone would revert to
    // the frozen initial seed while the shared store holds newer text. The mount
    // effect must re-seed from the live store so the next keystroke can't clobber.
    const store = createLiveTextStore('live-newer-text')
    setup({ initialText: 'stale-frozen-seed', store })
    const textarea = screen.getByTestId<HTMLTextAreaElement>('writing-editor-leaf')
    expect(textarea.value).toBe('live-newer-text')
  })

  test('a keystroke updates the live store immediately (count tracks live)', () => {
    const { store } = setup()
    const textarea = screen.getByTestId('writing-editor-leaf')
    fireEvent.change(textarea, { target: { value: 'hello world' } })
    expect(store.get()).toBe('hello world')
  })

  test('N keystrokes produce exactly ONE debounced commit (FW-4)', () => {
    const { onCommit } = setup()
    const textarea = screen.getByTestId('writing-editor-leaf')
    fireEvent.change(textarea, { target: { value: 'a' } })
    fireEvent.change(textarea, { target: { value: 'ab' } })
    fireEvent.change(textarea, { target: { value: 'abc' } })
    expect(onCommit).not.toHaveBeenCalled() // still within the debounce window
    vi.advanceTimersByTime(500)
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenLastCalledWith('abc') // the LATEST settled text
  })

  test('IME composition defers the commit until compositionend (Sally S9)', () => {
    const { store, onCommit } = setup()
    const textarea = screen.getByTestId('writing-editor-leaf')
    fireEvent.compositionStart(textarea)
    fireEvent.change(textarea, { target: { value: 'chao' } }) // mid-composition
    // Live store tracks it (count can update) but NO commit is scheduled yet.
    expect(store.get()).toBe('chao')
    vi.advanceTimersByTime(500)
    expect(onCommit).not.toHaveBeenCalled()
    // Composition settles to the diacritic form → commit fires.
    fireEvent.compositionEnd(textarea, { target: { value: 'chào' } })
    vi.advanceTimersByTime(500)
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenLastCalledWith('chào')
  })
})

describe('WritingEditorLeaf — read-only (AC16)', () => {
  test('disabled renders a natively disabled textarea', () => {
    setup({ disabled: true })
    expect(screen.getByTestId('writing-editor-leaf')).toBeDisabled()
  })
})
