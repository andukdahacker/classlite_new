// Story 5.2b Task 6 (AC4/5/6) — student answer inputs. Real i18n; the matching
// keyboard/touch path (native select) is the DEFAULT and is what's asserted.
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, test, vi } from 'vitest'
import { axe } from 'vitest-axe'
import i18n from '@/lib/i18n'
import type { components } from '@/lib/api/client'
import { ChoiceOption } from '../ChoiceOption'
import { GapInput } from '../GapInput'
import { MatchingBoard, type MatchingRow } from '../MatchingBoard'

type AttemptQuestion = components['schemas']['AttemptQuestion']

function withI18n(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>)
}
function q(text: string, type: string, options: string[] = []): AttemptQuestion {
  return { text, type, options }
}

describe('ChoiceOption — TFNG (AC4)', () => {
  test('renders the true/notGiven/false triad and reports the chosen string', async () => {
    const onChange = vi.fn()
    withI18n(
      <ChoiceOption
        handle="0:0:0"
        questionNumber={1}
        question={q('The sky is blue', 'true_false_not_given')}
        groupType="true_false_not_given"
        value=""
        onChange={onChange}
      />,
    )
    expect(screen.getByText(i18n.t('attempt.tfng.true'))).toBeInTheDocument()
    expect(screen.getByText(i18n.t('attempt.tfng.notGiven'))).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('choice-0:0:0-notGiven'))
    expect(onChange).toHaveBeenCalledWith('notGiven')
  })
})

describe('ChoiceOption — MCQ (AC4)', () => {
  test('renders the options and reports the chosen option', async () => {
    const onChange = vi.fn()
    withI18n(
      <ChoiceOption
        handle="0:0:0"
        questionNumber={2}
        question={q('Pick one', 'multiple_choice', ['Alpha', 'Beta'])}
        groupType="multiple_choice"
        value=""
        onChange={onChange}
      />,
    )
    await userEvent.click(screen.getByTestId('choice-0:0:0-Beta'))
    expect(onChange).toHaveBeenCalledWith('Beta')
  })
})

describe('GapInput (AC5)', () => {
  test('is a text input that reports typed free text; no correctness logic', async () => {
    const onChange = vi.fn()
    withI18n(
      <GapInput
        handle="0:1:0"
        questionNumber={3}
        question={q('Fill the ___', 'fill_in_blank')}
        value=""
        onChange={onChange}
      />,
    )
    const input = screen.getByTestId('gap-input-0:1:0')
    await userEvent.type(input, 'x')
    expect(onChange).toHaveBeenCalledWith('x')
  })
})

describe('MatchingBoard — accessible-first (AC6)', () => {
  const rows: MatchingRow[] = [
    { handle: '0:2:0', questionNumber: 4, question: q('Paris', 'matching', ['France', 'Spain']) },
    { handle: '0:2:1', questionNumber: 5, question: q('Madrid', 'matching', ['France', 'Spain']) },
  ]
  const rowState = {
    currentHandle: null as string | null,
    flagged: new Set<string>(),
    onToggleFlag: vi.fn(),
  }

  test('the per-row native select is the keyboard/touch path and reduces to one heading', async () => {
    const onChange = vi.fn()
    withI18n(<MatchingBoard rows={rows} values={{}} onChange={onChange} {...rowState} />)
    const select = screen.getByTestId('matching-select-0:2:0') as HTMLSelectElement
    await userEvent.selectOptions(select, 'France')
    expect(onChange).toHaveBeenCalledWith('0:2:0', 'France')
  })

  test('the select never requires a pointer — options are real <option>s', () => {
    withI18n(<MatchingBoard rows={rows} values={{}} onChange={vi.fn()} {...rowState} />)
    const select = screen.getByTestId('matching-select-0:2:1')
    // placeholder + 2 headings
    expect(select.querySelectorAll('option')).toHaveLength(3)
  })

  // Review Patch #2 — every matching row is independently addressable + flaggable.
  test('each row (not just the first) has a qwrap wrapper and its own flag', async () => {
    const onToggleFlag = vi.fn()
    withI18n(
      <MatchingBoard
        rows={rows}
        values={{}}
        onChange={vi.fn()}
        currentHandle={null}
        flagged={new Set()}
        onToggleFlag={onToggleFlag}
      />,
    )
    // The SECOND row is reachable by the navigator (has its own qwrap id).
    expect(document.getElementById('qwrap-0:2:1')).not.toBeNull()
    // …and independently flaggable.
    await userEvent.click(screen.getByTestId('flag-0:2:1'))
    expect(onToggleFlag).toHaveBeenCalledWith('0:2:1')
  })

  test('no accessibility violations', async () => {
    const { container } = withI18n(
      <MatchingBoard rows={rows} values={{}} onChange={vi.fn()} {...rowState} />,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})
