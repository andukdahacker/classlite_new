/**
 * WriteDocSurface — Story 1d-4 AC1 visual identity stories.
 *
 * Static-shells discipline: every callback prop defaults to a no-op; no
 * MSW handler, no `useState`, no `useEffect`. Empty / Error / Loading
 * states reuse 1d-1's `EmptyStatePlaceholder` / `ErrorStatePlaceholder`
 * until Epic 10 ships the canonical shape. Loading is a skeleton — the
 * three-state lint rule from 1d-1 expects this file to export Default +
 * Loading + Empty + Error.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'

import { EmptyStatePlaceholder } from '@/test/fixtures/empty-state-placeholder'
import { ErrorStatePlaceholder } from '@/test/fixtures/error-state-placeholder'

import { WriteDocSurface } from './WriteDocSurface'

const SAMPLE_ESSAY_EN = (
  <>
    <p>
      The library is quieter on Thursdays. I noticed this last semester, when
      the reading lists for our literature seminars began to overlap with the
      examination calendar. Students stopped lingering in the atrium and the
      study carrels filled up by mid-morning.
    </p>
    <p>
      My argument in this essay is that the rhythm of the university week is
      not designed around its students — it is designed around the calendar of
      the institution. The two only occasionally agree. I will examine three
      examples drawn from my own experience.
    </p>
  </>
)

const SAMPLE_ESSAY_VI = (
  <>
    <p>
      Thư viện trở nên yên tĩnh hơn vào các ngày thứ Năm. Tôi nhận ra điều này
      vào học kỳ trước, khi danh sách đọc của các lớp văn học bắt đầu chồng
      chéo với lịch thi. Học viên không còn nán lại ở sảnh và các phòng học
      cá nhân kín chỗ từ giữa buổi sáng.
    </p>
    <p>
      Luận điểm trong bài này của tôi là: nhịp điệu của tuần học không được
      thiết kế xoay quanh người học — nó được thiết kế xoay quanh lịch của
      nhà trường. Hai nhịp này chỉ thỉnh thoảng mới đồng pha. Tôi sẽ xem xét
      ba ví dụ rút ra từ chính trải nghiệm của mình.
    </p>
  </>
)

const meta = {
  title: 'domain/WriteDocSurface',
  component: WriteDocSurface,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof WriteDocSurface>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    // AC1 spec line 60 — Default uses realistic Vietnamese sample text so
    // diacritic-rendering + line-height integrity is the first thing the
    // designer sees in the canvas. Locale-pinned English variant lives in
    // `LocaleEn`.
    title: 'Nhịp điệu của một tuần học đại học',
    content: SAMPLE_ESSAY_VI,
    saveState: 'saved',
    savedAt: '2026-06-22T08:42:00Z',
    savedAtLabel: 'Đã lưu 2 phút trước',
    wordCount: 380,
    timeOnTaskSec: 1830,
  },
}

export const Saving: Story = {
  args: {
    title: 'How the university week is built',
    content: SAMPLE_ESSAY_EN,
    saveState: 'saving',
    wordCount: 415,
    timeOnTaskSec: 1834,
  },
}

export const Offline: Story = {
  args: {
    title: 'How the university week is built',
    content: SAMPLE_ESSAY_EN,
    saveState: 'offline',
    wordCount: 415,
    timeOnTaskSec: 1834,
  },
}

export const Loading: Story = {
  args: {
    title: 'How the university week is built',
    content: SAMPLE_ESSAY_EN,
    saveState: 'saving',
    wordCount: 0,
    timeOnTaskSec: 0,
  },
  render: () => (
    <div
      role="status"
      aria-label="Loading writing canvas"
      className="mx-auto flex w-full max-w-3xl flex-col gap-3 rounded-2xl border border-dashed border-border bg-muted/30 p-6"
    >
      <div className="h-8 w-2/3 animate-pulse rounded bg-muted" />
      <div className="h-6 w-1/2 animate-pulse rounded bg-muted/70" />
      <div className="h-40 w-full animate-pulse rounded bg-muted/60" />
    </div>
  ),
}

export const Empty: Story = {
  args: {
    title: 'Untitled essay',
    content: (
      <EmptyStatePlaceholder
        headline="Start writing your response"
        body="Your draft will save automatically as you type."
      />
    ),
    saveState: 'saved',
    wordCount: 0,
    timeOnTaskSec: 0,
  },
}

export const Error: Story = {
  args: {
    title: 'How the university week is built',
    content: (
      <ErrorStatePlaceholder
        message="We couldn't load this draft. Try again."
        retryLabel="Reload draft"
        onRetry={() => {}}
      />
    ),
    saveState: 'error',
    wordCount: 0,
    timeOnTaskSec: 0,
  },
}

export const LocaleEn: Story = {
  globals: { locale: 'en' },
  args: {
    title: 'How the university week is built',
    content: SAMPLE_ESSAY_EN,
    saveState: 'saved',
    savedAt: '2026-06-22T08:42:00Z',
    savedAtLabel: 'Saved 2 mins ago',
    wordCount: 412,
    timeOnTaskSec: 1830,
  },
}

export const LocaleVi: Story = {
  globals: { locale: 'vi' },
  args: {
    title: 'Nhịp điệu của một tuần học đại học',
    content: SAMPLE_ESSAY_VI,
    saveState: 'saved',
    savedAt: '2026-06-22T08:42:00Z',
    savedAtLabel: 'Đã lưu 2 phút trước',
    wordCount: 380,
    timeOnTaskSec: 1830,
  },
}
