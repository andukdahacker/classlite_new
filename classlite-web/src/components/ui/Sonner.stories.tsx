/**
 * Sonner — Story 1d-2 AC4.
 *
 * The `<Toaster />` is mounted at `src/App.tsx` top-level for production
 * surfaces; the Storybook preview decorator (`.storybook/preview.tsx`)
 * mounts a local Toaster inside the canvas so toasts surface within the
 * Storybook iframe.
 *
 * Toast bodies resolve via `t('storybook.toast.*')` keys — never
 * hardcoded English (UX-2 + TEST-FE-4).
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from './button'
import { Toaster } from './sonner'

const meta = {
  title: 'ui/Sonner',
  component: Toaster,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Toaster>

export default meta
type Story = StoryObj<typeof meta>

function Triggers() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-3">
      <Button onClick={() => toast.success(t('storybook.toast.success'))}>
        Trigger success
      </Button>
      <Button onClick={() => toast.error(t('storybook.toast.error'))}>
        Trigger error
      </Button>
      <Button onClick={() => toast.info(t('storybook.toast.info'))}>
        Trigger info
      </Button>
    </div>
  )
}

/**
 * `WithTriggers` — clicking each button surfaces the matching toast via
 * Sonner's `toast.success` / `toast.error` / `toast.info`. The Storybook
 * decorator already mounts a `<Toaster />` inside the canvas; the
 * trigger component below does NOT need its own Toaster mount.
 */
export const WithTriggers: Story = {
  render: () => <Triggers />,
}
