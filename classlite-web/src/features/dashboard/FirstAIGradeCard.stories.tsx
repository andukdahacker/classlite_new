/**
 * FirstAIGradeCard stories — Story 2-4 Task 4.3.
 *
 * ≥6 discrete variants exercising:
 *   - Default (Founder/Solo — identical layout, fixture-driven)
 *   - LocaleVi
 *   - Cramped720 (Vietnamese width envelope)
 *   - ReducedMotion (v1 renders static but locks the contract for
 *     FU-2-4-F's live pipeline)
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import FirstAIGradeCard from '@/features/dashboard/FirstAIGradeCard'

const meta = {
  title: 'Dashboard/FirstAIGradeCard',
  component: FirstAIGradeCard,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Static AI-graded essay preview for Founder + Solo Teacher personas. Fixture-driven — no wire dependency on Epic 6. Live pipeline lands via FU-2-4-F.',
      },
    },
  },
} satisfies Meta<typeof FirstAIGradeCard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Founder: Story = {
  parameters: {
    docs: { description: { story: 'Founder persona render (identical to Solo).' } },
  },
}

export const SoloTeacher: Story = {
  parameters: {
    docs: { description: { story: 'Solo Teacher persona render.' } },
  },
}

export const LocaleVi: Story = {
  parameters: { i18n: { locale: 'vi' } },
}

export const Cramped720: Story = {
  parameters: {
    viewport: { defaultViewport: 'tablet' },
    i18n: { locale: 'vi' },
    docs: {
      description: {
        story:
          'Vietnamese width envelope at ~720px — verifies excerpt line-clamp holds and criterion labels do not wrap.',
      },
    },
  },
}

export const ReducedMotion: Story = {
  parameters: {
    reducedMotion: 'reduce',
    docs: {
      description: {
        story:
          'v1 renders static content, so `prefers-reduced-motion: reduce` is a no-op. When FU-2-4-F wires the live pipeline the animation MUST honor this parameter.',
      },
    },
  },
}
