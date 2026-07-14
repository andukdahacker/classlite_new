/**
 * YourClassesRow stories — Story 2-4 Task 5.6.
 *
 * ≥4 discrete variants exercising the AC9 render matrix.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import YourClassesRow from '@/features/dashboard/YourClassesRow'

const meta = {
  title: 'Dashboard/YourClassesRow',
  component: YourClassesRow,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Preview of up to 2 spawned classes below the persona-value card. Ghost card + dead-link CTA renders when no classes exist.',
      },
    },
  },
} satisfies Meta<typeof YourClassesRow>

export default meta
type Story = StoryObj<typeof meta>

export const TwoClasses: Story = {
  args: {
    centerName: 'Saigon English Center',
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
}

export const OneClass: Story = {
  args: {
    centerName: 'Saigon English Center',
    classesDraft: [
      {
        cohortName: 'IELTS Morning',
        startDate: '2026-08-15',
        teacherEmail: null,
      },
    ],
  },
}

export const EmptyGhost: Story = {
  args: {
    centerName: 'Saigon English Center',
    classesDraft: [],
  },
}

export const LocaleVi: Story = {
  args: {
    centerName: 'Trung tâm Anh ngữ Sài Gòn',
    classesDraft: [
      {
        cohortName: 'Lớp Sáng',
        startDate: '2026-08-15',
        teacherEmail: null,
      },
    ],
  },
  parameters: { i18n: { locale: 'vi' } },
}
