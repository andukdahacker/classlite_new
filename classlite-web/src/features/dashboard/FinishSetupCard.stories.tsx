/**
 * FinishSetupCard stories — Story 2-4 Task 3.2.
 *
 * ≥8 discrete variants covering:
 *   - Persona × fraction state (OperatorFreshLanding 4/7, OperatorAllPossible
 *     4/7 with optional items permanently pending, FounderNoInvites 3/7,
 *     SoloTeacher 1/4)
 *   - Snoozed state (returns null — the story renders the pre-snooze card
 *     so designers can compare)
 *   - Locale (LocaleViOperator / LocaleViFounder / LocaleViSolo) per
 *     Vietnamese overflow discipline
 *
 * Each story uses a distinct fake `userId` so the module-scope
 * `useChecklistState` cache does not leak across stories.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import FinishSetupCard from '@/features/dashboard/FinishSetupCard'
import type { ChecklistCtx } from '@/features/dashboard/lib/checklistDefinition'
import type { CenterSummary } from '@/features/auth/api/authKeys'

const CENTER: CenterSummary = {
  id: 'sb-center',
  name: 'Saigon English Center',
  shortCode: 'saigon-english',
  // eslint-disable-next-line no-restricted-syntax -- brand-color wire format
  brandColor: '#1e3a8a',
  logoUrl: null,
  timezone: 'Asia/Ho_Chi_Minh',
}

const CTX_POST_2_3C: ChecklistCtx = {
  currentCenter: CENTER,
  templateDraft: {
    selectedTemplateId: 'tpl-1',
    spawnedClassIds: ['c1', 'c2'],
    classesDraft: [
      { cohortName: 'Batch A', startDate: '2026-08-15', teacherEmail: 'bob@example.com' },
      { cohortName: 'Batch B', startDate: '2026-08-15', teacherEmail: 'alice@example.com' },
    ],
  },
  teachersInvitedCount: 2,
}

const CTX_FRESH: ChecklistCtx = {
  currentCenter: CENTER,
  templateDraft: null,
  teachersInvitedCount: 0,
}

const CTX_FOUNDER_NO_INVITES: ChecklistCtx = {
  currentCenter: CENTER,
  templateDraft: {
    selectedTemplateId: 'tpl-1',
    spawnedClassIds: ['c1'],
    classesDraft: [
      { cohortName: 'First class', startDate: '2026-08-15', teacherEmail: null },
    ],
  },
  teachersInvitedCount: 0,
}

const meta = {
  title: 'Dashboard/FinishSetupCard',
  component: FinishSetupCard,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Post-onboarding "Finish setting up" checklist card. Renders on `/dashboard` when the visibility gate is open (see AC1). Dismiss dropped from v1 per S-STRONG-13 — Story 2.5 ships the reopen surface.',
      },
    },
  },
} satisfies Meta<typeof FinishSetupCard>

export default meta
type Story = StoryObj<typeof meta>

export const OperatorFreshLanding: Story = {
  args: { persona: 'operator', userId: 'sb-fresh', ctx: CTX_FRESH },
}

export const OperatorAllPossible: Story = {
  args: { persona: 'operator', userId: 'sb-op-all', ctx: CTX_POST_2_3C },
}

export const FounderNoInvites: Story = {
  args: {
    persona: 'founder',
    userId: 'sb-fn',
    ctx: CTX_FOUNDER_NO_INVITES,
  },
}

export const SoloTeacher: Story = {
  args: {
    persona: 'solo_teacher',
    userId: 'sb-solo',
    ctx: { ...CTX_FRESH, teachersInvitedCount: 0 },
  },
}

export const LocaleViOperator: Story = {
  args: { persona: 'operator', userId: 'sb-vi-op', ctx: CTX_POST_2_3C },
  parameters: { i18n: { locale: 'vi' } },
}

export const LocaleViFounder: Story = {
  args: {
    persona: 'founder',
    userId: 'sb-vi-fn',
    ctx: CTX_FOUNDER_NO_INVITES,
  },
  parameters: { i18n: { locale: 'vi' } },
}

export const LocaleViSolo: Story = {
  args: {
    persona: 'solo_teacher',
    userId: 'sb-vi-solo',
    ctx: { ...CTX_FRESH, teachersInvitedCount: 0 },
  },
  parameters: { i18n: { locale: 'vi' } },
}

// Snoozed — shows the pre-snooze card for design comparison; in real
// runtime the visibility gate would return null. Documented in the story
// description below.
export const Snoozed: Story = {
  args: { persona: 'operator', userId: 'sb-snoozed', ctx: CTX_POST_2_3C },
  parameters: {
    docs: {
      description: {
        story:
          'Design reference for the pre-snooze card. At runtime, clicking "Snooze for a week" hides the card via `useChecklistState.isVisible` — this story renders the pre-snooze state so designers can compare.',
      },
    },
  },
}
