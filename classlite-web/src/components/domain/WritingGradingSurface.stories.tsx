/**
 * WritingGradingSurface — Story 1d-4 AC2 visual identity stories.
 *
 * Three-color anchor taxonomy (red error / green praise / amber suggest)
 * is driven by inline `<mark class="cl-anchor-{error|praise|suggest}">`
 * wrappers in fixture HTML — `.cl-anchor-*` classes live in src/index.css.
 * Per UX-DR22 the primary band is Geist Mono 28px.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'

import { EmptyStatePlaceholder } from '@/test/fixtures/empty-state-placeholder'
import { ErrorStatePlaceholder } from '@/test/fixtures/error-state-placeholder'

import { asSafeHtml } from '@/lib/safe-html'

import {
  WritingGradingSurface,
  type AnchoredComment,
  type BandScoreBreakdown,
} from './WritingGradingSurface'

// Fixture HTML is hand-authored in this file and reviewed alongside the
// component — it satisfies the `SafeHtml` contract by construction.
const ESSAY_HTML_EN = asSafeHtml(`
<p>The library is quieter on Thursdays. <mark class="cl-anchor-praise">I noticed this last semester</mark>, when the reading lists for our literature seminars began to overlap with the examination calendar.</p>
<p>My argument in this essay is that <mark class="cl-anchor-suggest">the rhythm of the university week is not designed around its students</mark> — it is designed around the calendar of the institution.</p>
<p>The two only <mark class="cl-anchor-error">occasionally agrees</mark>. I will examine three examples drawn from my own experience.</p>
`)

const ESSAY_HTML_VI = asSafeHtml(`
<p>Thư viện trở nên yên tĩnh hơn vào các ngày thứ Năm. <mark class="cl-anchor-praise">Tôi nhận ra điều này vào học kỳ trước</mark>, khi danh sách đọc bắt đầu chồng chéo với lịch thi.</p>
<p>Luận điểm của tôi là <mark class="cl-anchor-suggest">nhịp điệu của tuần học không được thiết kế xoay quanh người học</mark> — nó được thiết kế xoay quanh lịch của nhà trường.</p>
<p>Hai nhịp này <mark class="cl-anchor-error">chỉ thỉnh thoảng mới đồng pha</mark>. Tôi sẽ xem xét ba ví dụ từ trải nghiệm của mình.</p>
`)

const EMPTY_ESSAY_HTML = asSafeHtml('')
const PLACEHOLDER_ESSAY_HTML = asSafeHtml(
  '<p>The student has not yet submitted this response.</p>',
)

const BASELINE_COMMENTS: ReadonlyArray<AnchoredComment> = [
  {
    id: 'c1',
    type: 'praise',
    criterionKey: 'criterion.taskAchievement',
    body: 'Strong opening — anchors the reader in a concrete observation before the abstract claim.',
    anchor: { start: 30, end: 65, text: 'I noticed this last semester' },
  },
  {
    id: 'c2',
    type: 'suggest',
    criterionKey: 'criterion.coherenceCohesion',
    body: 'Consider tightening this clause — the contrast it sets up arrives a sentence later than the reader expects.',
    anchor: { start: 120, end: 200, text: 'the rhythm of the university week...' },
  },
  {
    id: 'c3',
    type: 'error',
    criterionKey: 'criterion.grammar',
    body: 'Subject-verb disagreement — "the two" takes a plural verb ("agree").',
    anchor: { start: 310, end: 330, text: 'occasionally agrees' },
  },
]

const BASELINE_SCORE: BandScoreBreakdown = {
  primary: 6.5,
  criteria: [
    { criterionKey: 'criterion.taskAchievement', score: 7 },
    { criterionKey: 'criterion.coherenceCohesion', score: 6 },
    { criterionKey: 'criterion.lexicalResource', score: 6.5 },
    { criterionKey: 'criterion.grammar', score: 6 },
  ],
}

const meta = {
  title: 'domain/WritingGradingSurface',
  component: WritingGradingSurface,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof WritingGradingSurface>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    essayHtml: ESSAY_HTML_EN,
    comments: BASELINE_COMMENTS,
    score: BASELINE_SCORE,
  },
}

export const LongRail: Story = {
  args: {
    essayHtml: ESSAY_HTML_EN,
    score: BASELINE_SCORE,
    comments: Array.from({ length: 12 }, (_, index) => ({
      id: `lr-${index}`,
      type: (['error', 'praise', 'suggest'] as const)[index % 3],
      criterionKey: [
        'criterion.taskAchievement',
        'criterion.coherenceCohesion',
        'criterion.lexicalResource',
        'criterion.grammar',
      ][index % 4],
      body: `Comment ${index + 1}: extra grading note to demonstrate the comment rail's scroll behavior under typical density.`,
      anchor: {
        start: index * 10,
        end: index * 10 + 30,
        text: `anchor-${index}`,
      },
    })),
  },
}

export const RedHeavy: Story = {
  args: {
    essayHtml: ESSAY_HTML_EN,
    score: { primary: 5.0, criteria: BASELINE_SCORE.criteria },
    comments: [
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `err-${index}`,
        type: 'error' as const,
        criterionKey: 'criterion.grammar',
        body: `Grammar issue ${index + 1}: subject-verb agreement or tense mismatch.`,
        anchor: { start: index * 20, end: index * 20 + 15, text: `err-${index}` },
      })),
      {
        id: 'pr-1',
        type: 'praise' as const,
        criterionKey: 'criterion.taskAchievement',
        body: 'Solid thesis statement.',
        anchor: { start: 0, end: 30, text: 'thesis' },
      },
      {
        id: 'sg-1',
        type: 'suggest' as const,
        criterionKey: 'criterion.coherenceCohesion',
        body: 'Consider stronger topic sentences.',
        anchor: { start: 100, end: 130, text: 'topic' },
      },
    ],
  },
}

export const Resolved: Story = {
  args: {
    essayHtml: ESSAY_HTML_EN,
    score: BASELINE_SCORE,
    comments: BASELINE_COMMENTS.map((comment, index) => ({
      ...comment,
      resolved: index < 2,
    })),
  },
}

export const Loading: Story = {
  args: {
    essayHtml: EMPTY_ESSAY_HTML,
    comments: [],
    score: BASELINE_SCORE,
  },
  render: () => (
    <div
      role="status"
      aria-label="Loading grading surface"
      className="grid grid-cols-1 gap-4 rounded-2xl border border-dashed border-border bg-muted/30 p-6 md:grid-cols-[3fr_2fr]"
    >
      <div className="space-y-3">
        <div className="h-6 w-3/4 animate-pulse rounded bg-muted" />
        <div className="h-5 w-5/6 animate-pulse rounded bg-muted/70" />
        <div className="h-5 w-4/6 animate-pulse rounded bg-muted/70" />
        <div className="h-5 w-5/6 animate-pulse rounded bg-muted/70" />
      </div>
      <div className="space-y-3">
        <div className="h-20 w-full animate-pulse rounded-lg bg-muted" />
        <div className="h-20 w-full animate-pulse rounded-lg bg-muted/80" />
        <div className="h-20 w-full animate-pulse rounded-lg bg-muted/60" />
      </div>
    </div>
  ),
}

export const Empty: Story = {
  args: {
    essayHtml: PLACEHOLDER_ESSAY_HTML,
    comments: [],
    score: { primary: 0, criteria: BASELINE_SCORE.criteria.map((c) => ({ ...c, score: 0 })) },
  },
  render: () => (
    <EmptyStatePlaceholder
      headline="Awaiting submission"
      body="This student has not yet submitted their writing response."
    />
  ),
}

export const Error: Story = {
  args: {
    essayHtml: EMPTY_ESSAY_HTML,
    comments: [],
    score: BASELINE_SCORE,
  },
  render: () => (
    <ErrorStatePlaceholder
      message="We couldn't load this submission. Try again."
      retryLabel="Reload"
      onRetry={() => {}}
    />
  ),
}

export const LocaleEn: Story = {
  globals: { locale: 'en' },
  args: {
    essayHtml: ESSAY_HTML_EN,
    comments: BASELINE_COMMENTS,
    score: BASELINE_SCORE,
  },
}

export const LocaleVi: Story = {
  globals: { locale: 'vi' },
  args: {
    essayHtml: ESSAY_HTML_VI,
    comments: BASELINE_COMMENTS.map((c) => ({
      ...c,
      body:
        c.type === 'error'
          ? 'Sai sự hòa hợp chủ–vị: "hai" đi với động từ số nhiều.'
          : c.type === 'praise'
            ? 'Mở bài tốt — neo người đọc vào quan sát cụ thể trước khi đi vào luận điểm.'
            : 'Có thể siết chặt mệnh đề này — phần đối lập đến muộn hơn so với kỳ vọng của người đọc.',
    })),
    score: BASELINE_SCORE,
  },
}
