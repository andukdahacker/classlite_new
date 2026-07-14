/**
 * TeacherDashboard stories — Story 2-4 Task 6.7.
 *
 * ≥8 discrete variants (M-INFO-18 pragmatic — Size-M): OperatorPostOnboarding,
 * FounderPostOnboarding, SoloTeacherPostOnboarding, MidWizardNoCenter,
 * PostCenterIncomplete, LocaleViOperator, OperatorSnoozed (W-INFO-20),
 * FounderSnoozed (W-INFO-20).
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { HttpResponse, http } from 'msw'
import { queryClient } from '@/lib/query-client'
import { authKeys } from '@/features/auth/api/authKeys'
import TeacherDashboard from '@/features/dashboard/TeacherDashboard'

type Persona = 'operator' | 'founder' | 'solo_teacher'

const CENTER = {
  id: 'sb-center',
  name: 'Saigon English Center',
  shortCode: 'saigon-english',
  // eslint-disable-next-line no-restricted-syntax -- brand-color wire format
  brandColor: '#1e3a8a' as string | null,
  logoUrl: null,
  timezone: 'Asia/Ho_Chi_Minh',
}

function seedSession(withCenter: boolean) {
  queryClient.setQueryData(authKeys.session(), {
    user: {
      id: 'sb-user',
      email: 'owner@example.com',
      fullName: 'Trang',
      emailVerified: true,
    },
    accessToken: 'sb.jwt',
    center: withCenter ? CENTER : null,
  })
}

function progressHandler(
  persona: Persona | null,
  currentStep:
    | 'persona'
    | 'center'
    | 'template'
    | 'spawn'
    | 'solo_first_class'
    | 'done',
) {
  return http.get('/api/onboarding/progress', () =>
    HttpResponse.json({
      data: {
        persona,
        currentStep,
        payload: {
          templateDraft: {
            selectedTemplateId: 'tpl-1',
            spawnedClassIds: ['c1', 'c2'],
            classesDraft: [
              {
                cohortName: 'IELTS Morning',
                startDate: '2026-08-15',
                teacherEmail: 'bob@example.com',
              },
              {
                cohortName: 'IELTS Evening',
                startDate: '2026-08-20',
                teacherEmail: 'alice@example.com',
              },
            ],
          },
        },
        updatedAt: '2026-07-14T00:00:00.000Z',
      },
      meta: {},
    }),
  )
}

const meta = {
  title: 'Dashboard/TeacherDashboard',
  component: TeacherDashboard,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Post-onboarding dashboard shell for the teacher lazy chunk. Composes welcome banner, welcome heading, and a persona-branched body (Operator / Founder / Solo Teacher).',
      },
    },
  },
  decorators: [
    (Story, ctx) => {
      const meta = ctx.parameters?.storyMeta as
        | { persona: Persona | null; withCenter: boolean; currentStep: string }
        | undefined
      if (meta) {
        seedSession(meta.withCenter)
      }
      return Story()
    },
  ],
} satisfies Meta<typeof TeacherDashboard>

export default meta
type Story = StoryObj<typeof meta>

export const OperatorPostOnboarding: Story = {
  parameters: {
    storyMeta: { persona: 'operator', withCenter: true, currentStep: 'done' },
    msw: { handlers: [progressHandler('operator', 'done')] },
  },
}

export const FounderPostOnboarding: Story = {
  parameters: {
    storyMeta: { persona: 'founder', withCenter: true, currentStep: 'done' },
    msw: { handlers: [progressHandler('founder', 'done')] },
  },
}

export const SoloTeacherPostOnboarding: Story = {
  parameters: {
    storyMeta: {
      persona: 'solo_teacher',
      withCenter: true,
      currentStep: 'done',
    },
    msw: { handlers: [progressHandler('solo_teacher', 'done')] },
  },
}

export const MidWizardNoCenter: Story = {
  parameters: {
    storyMeta: { persona: null, withCenter: false, currentStep: 'persona' },
    msw: { handlers: [progressHandler(null, 'persona')] },
  },
}

export const PostCenterIncomplete: Story = {
  parameters: {
    storyMeta: { persona: 'operator', withCenter: true, currentStep: 'template' },
    msw: { handlers: [progressHandler('operator', 'template')] },
  },
}

export const LocaleViOperator: Story = {
  parameters: {
    storyMeta: { persona: 'operator', withCenter: true, currentStep: 'done' },
    msw: { handlers: [progressHandler('operator', 'done')] },
    i18n: { locale: 'vi' },
  },
}

export const OperatorSnoozed: Story = {
  parameters: {
    storyMeta: { persona: 'operator', withCenter: true, currentStep: 'done' },
    msw: { handlers: [progressHandler('operator', 'done')] },
    docs: {
      description: {
        story:
          'FinishSetupCard is snoozed via `localStorage` — the sample preview + Your Classes row still render. Set the snooze key manually in the story preview if you want to see this state live.',
      },
    },
  },
}

export const FounderSnoozed: Story = {
  parameters: {
    storyMeta: { persona: 'founder', withCenter: true, currentStep: 'done' },
    msw: { handlers: [progressHandler('founder', 'done')] },
    docs: {
      description: {
        story:
          'Founder equivalent of OperatorSnoozed — AI grade card + Your Classes stay visible when the checklist is snoozed.',
      },
    },
  },
}
