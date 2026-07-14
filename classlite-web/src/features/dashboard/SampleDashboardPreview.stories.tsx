/**
 * SampleDashboardPreview stories — Story 2-4 Task 5.3.
 *
 * ≥3 discrete variants (Task 5.3 minimum): OperatorDefault, LocaleVi,
 * OperatorWithLongCenterName (banner copy interpolates a centerName in a
 * later revision — for v1 the copy is static, so this story just documents
 * the intent).
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import SampleDashboardPreview from '@/features/dashboard/SampleDashboardPreview'

const meta = {
  title: 'Dashboard/SampleDashboardPreview',
  component: SampleDashboardPreview,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          '4-up ghosted-frame stat strip for the Operator persona. Fixture-driven — Epic 8 wires real analytics.',
      },
    },
  },
} satisfies Meta<typeof SampleDashboardPreview>

export default meta
type Story = StoryObj<typeof meta>

export const OperatorDefault: Story = {}

export const LocaleVi: Story = {
  parameters: { i18n: { locale: 'vi' } },
}

export const OperatorWithLongCenterName: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Copy is static in v1, so long center names do not overflow the banner. Documented so future copy revisions (post-Epic 8) can revisit.',
      },
    },
  },
}
