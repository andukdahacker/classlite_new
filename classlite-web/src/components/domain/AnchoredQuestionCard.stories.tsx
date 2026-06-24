/**
 * AnchoredQuestionCard — Story 1d-4 AC4 visual identity stories.
 *
 * Covers `s18` (teacher answer) and `s36` (student ask) chrome with both
 * `awaiting` and `answered` states. ISO timestamps fixture-pinned (no
 * `new Date()` per TS-6). The locale-specific story renders Vietnamese
 * diacritics in question + reply text and the role badge resolves via
 * existing `userPill.role.*` keys.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'

import { EmptyStatePlaceholder } from '@/test/fixtures/empty-state-placeholder'
import { ErrorStatePlaceholder } from '@/test/fixtures/error-state-placeholder'

import { AnchoredQuestionCard, type AnchoredQuestion } from './AnchoredQuestionCard'

const BASE_QUESTION: AnchoredQuestion = {
  id: 'q-teacher-awaiting',
  variant: 'teacher-answer',
  state: 'awaiting',
  asker: {
    name: 'Lan Pham',
    role: 'student',
    avatarUrl: null,
  },
  questionText: 'Could you clarify what the author means by "the wisdom of crowds" here? I struggled to connect it to the rest of the paragraph.',
  anchoredExcerpt: {
    text: 'Wisdom of crowds — a small minority can sway the median answer of an entire group.',
    location: 'Question 3, span "wisdom of crowds"',
  },
  askedAt: '2026-06-22T07:42:00Z',
  askedAtLabel: '2h ago',
}

const meta = {
  title: 'domain/AnchoredQuestionCard',
  component: AnchoredQuestionCard,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof AnchoredQuestionCard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { question: BASE_QUESTION },
}

export const TeacherAnswer_Awaiting: Story = {
  args: { question: BASE_QUESTION },
}

export const TeacherAnswer_Answered: Story = {
  args: {
    question: {
      ...BASE_QUESTION,
      id: 'q-teacher-answered',
      state: 'answered',
      teacherReply: {
        name: 'Mr. Hoang',
        avatarUrl: null,
        text: 'Good question. The phrase refers to a group of independent voices outperforming a single expert on average — the connection to the paragraph is that the author argues for collective judgement over individual authority.',
        timestamp: '2026-06-22T08:11:00Z',
      },
    },
  },
}

export const StudentAsk_Awaiting: Story = {
  args: {
    question: {
      ...BASE_QUESTION,
      id: 'q-student-awaiting',
      variant: 'student-ask',
      state: 'awaiting',
      teacherReply: undefined,
    },
  },
}

export const StudentAsk_Answered: Story = {
  args: {
    question: {
      ...BASE_QUESTION,
      id: 'q-student-answered',
      variant: 'student-ask',
      state: 'answered',
      teacherReply: {
        name: 'Mr. Hoang',
        avatarUrl: null,
        text: 'Good question — the phrase refers to a group of independent voices outperforming a single expert. The paragraph is making a case for collective judgement.',
        timestamp: '2026-06-22T08:11:00Z',
      },
    },
  },
}

export const LongQuestion: Story = {
  args: {
    question: {
      ...BASE_QUESTION,
      id: 'q-long',
      questionText: `I'm trying to understand the author's argument here. They begin by saying that the wisdom of crowds applies under three conditions — diversity, independence, and aggregation — but then they pivot to a case study of a financial market that has none of those conditions and still produces useful pricing. How are these reconciled?

Is the author saying that the conditions are sufficient but not necessary? Or that markets have a different mechanism altogether? I went back and re-read the passage three times and I can't tell.`,
    },
  },
}

export const LocaleVi: Story = {
  globals: { locale: 'vi' },
  args: {
    question: {
      ...BASE_QUESTION,
      id: 'q-vi',
      variant: 'student-ask',
      state: 'answered',
      questionText: 'Thầy có thể giải thích rõ hơn ý "trí tuệ đám đông" trong đoạn này không? Em chưa kết nối được nó với phần còn lại của đoạn văn.',
      anchoredExcerpt: {
        text: 'Trí tuệ đám đông — một thiểu số nhỏ có thể tác động đến đáp án trung bình của cả nhóm.',
        location: 'Câu hỏi 3, đoạn "trí tuệ đám đông"',
      },
      teacherReply: {
        name: 'Thầy Hoàng',
        avatarUrl: null,
        text: 'Câu hỏi hay. Cụm từ này chỉ một nhóm các tiếng nói độc lập đưa ra đánh giá tốt hơn một chuyên gia đơn lẻ. Liên hệ với đoạn văn là tác giả đang lập luận cho phán quyết tập thể.',
        timestamp: '2026-06-22T08:11:00Z',
      },
    },
  },
}

export const Loading: Story = {
  args: { question: BASE_QUESTION },
  render: () => (
    <div
      role="status"
      aria-label="Loading question card"
      className="flex flex-col gap-3 rounded-xl border border-dashed border-border bg-muted/30 p-4"
    >
      <div className="flex items-center gap-3">
        <div className="size-8 animate-pulse rounded-full bg-muted" />
        <div className="flex-1 space-y-1">
          <div className="h-3 w-1/3 animate-pulse rounded bg-muted/80" />
          <div className="h-2 w-1/4 animate-pulse rounded bg-muted/60" />
        </div>
      </div>
      <div className="h-4 w-5/6 animate-pulse rounded bg-muted/70" />
      <div className="h-4 w-2/3 animate-pulse rounded bg-muted/70" />
      <div className="h-16 w-full animate-pulse rounded bg-muted/60" />
    </div>
  ),
}

export const Empty: Story = {
  args: { question: BASE_QUESTION },
  render: () => (
    <EmptyStatePlaceholder
      headline="No questions yet"
      body="This student hasn't asked any anchored questions on this exercise."
    />
  ),
}

export const Error: Story = {
  args: { question: BASE_QUESTION },
  render: () => (
    <ErrorStatePlaceholder
      message="Could not load this question. Try again."
      retryLabel="Reload"
      onRetry={() => {}}
    />
  ),
}
