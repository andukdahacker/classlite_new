// storybook-rule: no-three-state
/**
 * EmptyState — the canonical empty-state leaf (Story 10.3 AC1). Pure
 * presentational component; it owns no fetch and has no Loading/Error branches,
 * so the three-state rule is opted out above (the rule is NOT suffix-globbed — a
 * `*State.stories.tsx` under `components/domain/` still trips it without this
 * directive).
 *
 * The catalog below is the inventory of real call-site variants (s54–s62, minus
 * the split-out s53). Every string is i18n-resolved via `i18n.t()` — the
 * component never calls `t()` itself (UX-3 role-decorator at the call site).
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  Archive,
  GraduationCap,
  Inbox,
  MessagesSquare,
  UploadCloud,
  Users,
} from 'lucide-react'

import i18n from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { EmptyState } from './EmptyState'
import { GhostedChartFrame } from './GhostedChartFrame'

const meta = {
  title: 'domain/EmptyState',
  component: EmptyState,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof EmptyState>

export default meta
type Story = StoryObj<typeof meta>

/** s54 classes — simple, branded trailing accent, single Create CTA. */
export const ClassesEmpty: Story = {
  args: {
    icon: <GraduationCap className="size-7" />,
    headline: i18n.t('classes.empty.headline'),
    headlineAccent: i18n.t('classes.empty.headlineAccent'),
    description: i18n.t('classes.empty.body'),
    live: true,
    actions: <Button>{i18n.t('classes.empty.cta')}</Button>,
  },
}

/** s55 roster — action-less (enrolment UI is Epic 7.3), preserve copy. */
export const RosterEmpty: Story = {
  args: {
    icon: <Users className="size-7" />,
    headline: i18n.t('people.student.list.empty.headline'),
    description: i18n.t('people.student.list.empty.body'),
    live: true,
  },
}

/** s56 inbox — the three role lenses (the proving oracle). */
export const InboxEmptyStudent: Story = {
  args: {
    icon: <Inbox className="size-7" />,
    headline: i18n.t('inbox.empty.student.title'),
    headlineAccent: i18n.t('inbox.empty.student.titleAccent'),
    description: i18n.t('inbox.empty.student.body'),
    live: true,
  },
}

export const InboxEmptyTeacher: Story = {
  args: {
    icon: <Inbox className="size-7" />,
    headline: i18n.t('inbox.empty.teacher.title'),
    headlineAccent: i18n.t('inbox.empty.teacher.titleAccent'),
    description: i18n.t('inbox.empty.teacher.body'),
    live: true,
  },
}

export const InboxEmptyOwner: Story = {
  args: {
    icon: <Inbox className="size-7" />,
    headline: i18n.t('inbox.empty.ownerAdmin.title'),
    headlineAccent: i18n.t('inbox.empty.ownerAdmin.titleAccent'),
    description: i18n.t('inbox.empty.ownerAdmin.body'),
    live: true,
  },
}

/** s58 questions — Q&A-vs-Inbox explainer + single Open-Inbox CTA. */
export const QuestionsEmpty: Story = {
  args: {
    icon: <MessagesSquare className="size-7" />,
    headline: i18n.t('questions.empty.teacher.title'),
    description: i18n.t('questions.empty.teacher.explainer'),
    actions: <Button variant="outline">{i18n.t('questions.empty.teacher.openInbox')}</Button>,
  },
}

/** s59 knowledge hub — simple, single Upload CTA. */
export const KnowledgeHubEmpty: Story = {
  args: {
    icon: <UploadCloud className="size-7" />,
    headline: i18n.t('knowledgeHub.empty.true.headline'),
    description: i18n.t('knowledgeHub.empty.true.body'),
    actions: <Button>{i18n.t('knowledgeHub.empty.true.cta')}</Button>,
  },
}

/** s60 archive — action-less (the second oracle). */
export const ArchiveEmpty: Story = {
  args: {
    icon: <Archive className="size-7" />,
    headline: i18n.t('archive.empty.title'),
    headlineAccent: i18n.t('archive.empty.titleAccent'),
    description: i18n.t('archive.empty.body'),
    live: true,
  },
}

/** s61 analytics — guided + GhostedChartFrame, keeps its own headline + owner CTA. */
export const AnalyticsNoData: Story = {
  args: {
    tone: 'guided',
    headline: i18n.t('analytics.home.empty.headline'),
    live: true,
    children: <GhostedChartFrame />,
    actions: <Button variant="outline">{i18n.t('analytics.home.empty.action')}</Button>,
  },
}

/** s57 my-performance — guided, NO stamped headline (the page-head + banner carry it).
 *  The catalog entry renders the ghosted frame + the threshold copy as the readable
 *  `description`; the real amber warn-banner lives at the my-performance call site
 *  (its contrast is owned there, not duplicated into this illustrative story). */
export const MyPerformanceEmpty: Story = {
  args: {
    tone: 'guided',
    live: true,
    description: i18n.t('analytics.myPerformance.ghosted.banner'),
    children: <GhostedChartFrame />,
  },
}

/** s62 student day-one — guided hero (icon + accent headline + checklist + dismiss). */
export const StudentDayOne: Story = {
  args: {
    tone: 'guided',
    icon: <GraduationCap className="size-7" />,
    headline: i18n.t('dashboard.welcome.headline'),
    headlineAccent: i18n.t('dashboard.welcome.headlineAccent'),
    children: (
      <>
        <p className="text-sm text-[color:var(--cl-ink-soft)]">
          {i18n.t('dashboard.welcome.subtext')}
        </p>
        <p className="text-sm font-medium text-[color:var(--cl-ink)]">
          {i18n.t('dashboard.welcome.nextSession', { session: 'IELTS Writing · Mon 7pm' })}
        </p>
        <ul className="flex flex-col gap-1 text-sm text-[color:var(--cl-ink-soft)]">
          <li>{i18n.t('dashboard.welcome.step1')}</li>
          <li>{i18n.t('dashboard.welcome.step2')}</li>
          <li>{i18n.t('dashboard.welcome.step3')}</li>
        </ul>
      </>
    ),
    actions: <Button>{i18n.t('dashboard.welcome.cta')}</Button>,
  },
}
