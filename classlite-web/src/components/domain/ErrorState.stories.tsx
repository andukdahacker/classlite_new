// storybook-rule: no-three-state
/**
 * ErrorState — the canonical inline error-state leaf (Story 10.4 AC1). Pure
 * presentational component; it owns no fetch and has no Loading/Empty/Error
 * branches of its own, so the three-state rule is opted out above (the rule is
 * NOT suffix-globbed — a `*State.stories.tsx` under `components/domain/` still
 * trips it without this directive).
 *
 * The catalog below is the inventory of real variants (RetryOnly, WithDetail,
 * WithAction, WithIcon). Every string is i18n-resolved via `i18n.t()` — the
 * component never calls `t()` itself (UX-3 role-decorator at the call site).
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { AlertTriangle } from 'lucide-react'

import i18n from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { ErrorState } from './ErrorState'

const meta = {
  title: 'domain/ErrorState',
  component: ErrorState,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof ErrorState>

export default meta
type Story = StoryObj<typeof meta>

/** The transient fetch-retry idiom: message + retry only (the "why" is self-evident). */
export const RetryOnly: Story = {
  args: {
    message: i18n.t('dashboard.teacher.errorMessage'),
    retryLabel: i18n.t('dashboard.teacher.retry'),
    onRetry: () => {},
  },
}

/** A designed error state carrying the three-part middle: message (what) + detail (why). */
export const WithDetail: Story = {
  args: {
    message: i18n.t('knowledgeHub.storage.full.title'),
    detail: i18n.t('knowledgeHub.storage.full.ownerBody'),
    retryLabel: i18n.t('dashboard.teacher.retry'),
    onRetry: () => {},
  },
}

/** A "what to do next" escape with no retry (an alternate recovery path). */
export const WithAction: Story = {
  args: {
    message: i18n.t('knowledgeHub.storage.full.title'),
    detail: i18n.t('knowledgeHub.storage.full.ownerBody'),
    action: (
      <Button variant="outline" size="sm">
        {i18n.t('settings.tabs.storage')}
      </Button>
    ),
  },
}

/** The glyph variant — the call site supplies the ghosted AlertTriangle. */
export const WithIcon: Story = {
  args: {
    icon: <AlertTriangle className="size-4" />,
    message: i18n.t('dashboard.teacher.errorMessage'),
    retryLabel: i18n.t('dashboard.teacher.retry'),
    onRetry: () => {},
  },
}
