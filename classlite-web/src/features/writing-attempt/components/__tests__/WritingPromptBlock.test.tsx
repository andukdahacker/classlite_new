// Story 5.3 Task 2 (AC3, Sally S8) — the prompt renders as a blockquote carrying
// lang="en" on the WHOLE block, with pre-wrap so paragraph breaks survive.
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { WritingPromptBlock } from '../WritingPromptBlock'

describe('WritingPromptBlock (AC3)', () => {
  test('renders the prompt in a lang="en" blockquote', () => {
    render(<WritingPromptBlock prompt={'Describe a chart.\n\nWrite at least 150 words.'} />)
    const block = screen.getByTestId('writing-prompt')
    expect(block.tagName).toBe('BLOCKQUOTE')
    expect(block).toHaveAttribute('lang', 'en')
    expect(block).toHaveTextContent('Describe a chart.')
  })

  test('preserves paragraph breaks via pre-wrap', () => {
    render(<WritingPromptBlock prompt="line one\nline two" />)
    expect(screen.getByTestId('writing-prompt')).toHaveClass('whitespace-pre-wrap')
  })
})
