/**
 * MobileWritingSurface — Story 1d-4 AC5 visual identity stories.
 *
 * Viewport is locked at `iphone14` per `parameters.viewport.defaultViewport`.
 * UX-DR32 + UX-4: the component renders at 390x844 with Geist 16px body
 * type and line-height 1.7 — designer-reviewable without a device.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'

import { EmptyStatePlaceholder } from '@/test/fixtures/empty-state-placeholder'
import { ErrorStatePlaceholder } from '@/test/fixtures/error-state-placeholder'

import { MobileWritingSurface } from './MobileWritingSurface'

const SAMPLE_EN = (
  <>
    <p>
      The library is quieter on Thursdays. I noticed this last semester, when
      the reading lists for our literature seminars began to overlap with the
      examination calendar. Students stopped lingering in the atrium and the
      study carrels filled up by mid-morning.
    </p>
    <p>
      My argument here is that the rhythm of the university week is not
      designed around its students — it is designed around the calendar of
      the institution.
    </p>
  </>
)

const SAMPLE_VI = (
  <>
    <p>
      Thư viện trở nên yên tĩnh hơn vào các ngày thứ Năm. Tôi nhận ra điều
      này vào học kỳ trước, khi danh sách đọc của các lớp văn học bắt đầu
      chồng chéo với lịch thi. Học viên không còn nán lại ở sảnh.
    </p>
    <p>
      Luận điểm của tôi là nhịp điệu của tuần học không được thiết kế xoay
      quanh người học — nó được thiết kế xoay quanh lịch của nhà trường.
    </p>
  </>
)

const meta = {
  title: 'domain/MobileWritingSurface',
  component: MobileWritingSurface,
  parameters: {
    layout: 'centered',
    viewport: { defaultViewport: 'iphone14' },
  },
} satisfies Meta<typeof MobileWritingSurface>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    title: 'How the university week is built',
    content: SAMPLE_EN,
    saveState: 'saved',
    wordCount: 412,
  },
}

export const Saving: Story = {
  args: {
    title: 'How the university week is built',
    content: SAMPLE_EN,
    saveState: 'saving',
    wordCount: 415,
  },
}

export const LocaleVi: Story = {
  globals: { locale: 'vi' },
  args: {
    title: 'Nhịp điệu của một tuần học đại học',
    content: SAMPLE_VI,
    saveState: 'saved',
    wordCount: 380,
  },
}

export const Empty: Story = {
  args: {
    title: 'Untitled essay',
    content: (
      <EmptyStatePlaceholder
        headline="Start writing"
        body="Your draft will save automatically."
      />
    ),
    saveState: 'saved',
    wordCount: 0,
  },
}

export const Loading: Story = {
  args: {
    title: 'How the university week is built',
    content: SAMPLE_EN,
    saveState: 'saving',
    wordCount: 0,
  },
  render: () => (
    <div
      role="status"
      aria-label="Loading mobile writing canvas"
      className="flex h-[844px] w-[390px] flex-col gap-3 border border-dashed border-border bg-muted/30 p-4"
    >
      <div className="h-6 w-2/3 animate-pulse rounded bg-muted" />
      <div className="h-6 w-5/6 animate-pulse rounded bg-muted/80" />
      <div className="h-40 w-full animate-pulse rounded bg-muted/70" />
    </div>
  ),
}

export const Error: Story = {
  args: {
    title: 'How the university week is built',
    content: SAMPLE_EN,
    saveState: 'error',
    wordCount: 0,
  },
  render: () => (
    <div className="flex h-[844px] w-[390px] items-center justify-center bg-[color:var(--cl-paper)]">
      <ErrorStatePlaceholder
        message="Couldn't sync this draft."
        retryLabel="Try again"
        onRetry={() => {}}
      />
    </div>
  ),
}
