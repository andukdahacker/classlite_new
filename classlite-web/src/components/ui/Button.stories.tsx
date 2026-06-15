/**
 * Button smoke story — Story 1d-1 AC9.
 *
 * Single trivial primitive that exercises the full Storybook gate chain:
 *   - Locale toolbar (en / vi)        → AC2 #2 + AC9 bullet 1.
 *   - Role toolbar (owner/admin/teacher/student) → AC9 bullet 2.
 *   - axe-core via addon-a11y         → AC5 + AC9 bullet 3.
 *   - i18n parity                     → AC4 inheritance + AC9 bullet 4.
 *   - Three-state lint (primitive exempt; see AC3) — proven via the
 *     negative fixture at `src/test/fixtures/lint-bait/`.
 *   - FW-7 placement                  → AC7 + AC9 bullet 6 (file lives at
 *     `src/components/ui/Button.stories.tsx`).
 *
 * Comprehensive Button coverage (every variant × size × disabled state)
 * is Story 1d-2's scope — this file stays trivial on purpose so it acts
 * as the next dev's reference start point.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './button'

type ButtonProps = ComponentProps<typeof Button>

/**
 * Renders `<Button>` with the AC9-mandated i18n label. The label key
 * `auth.login.submit` exists in both en.json + vi.json — verified by the
 * inherited Story 1-7c i18n-parity coverage spec.
 */
function I18nButton(props: ButtonProps) {
  const { t } = useTranslation()
  return <Button {...props}>{t('auth.login.submit')}</Button>
}

const meta = {
  title: 'ui/Button',
  component: Button,
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    variant: {
      control: { type: 'select' },
      options: ['default', 'outline', 'secondary', 'ghost', 'destructive', 'link'],
    },
    size: {
      control: { type: 'select' },
      options: ['default', 'xs', 'sm', 'lg', 'icon', 'icon-xs', 'icon-sm', 'icon-lg'],
    },
    disabled: { control: 'boolean' },
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => <I18nButton {...args} />,
}

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      {(['default', 'outline', 'secondary', 'ghost', 'destructive', 'link'] as const).map(
        (variant) => (
          <I18nButton key={variant} variant={variant} />
        ),
      )}
    </div>
  ),
}

export const Sizes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      {(['xs', 'sm', 'default', 'lg'] as const).map((size) => (
        <I18nButton key={size} size={size} />
      ))}
    </div>
  ),
}

export const Disabled: Story = {
  render: () => <I18nButton disabled />,
}
