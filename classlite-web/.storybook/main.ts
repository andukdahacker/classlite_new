import type { StorybookConfig } from '@storybook/react-vite'

/**
 * Storybook configuration — Story 1d-1 AC1 (Tier A: Vite 8 / Rolldown).
 *
 * Story locations follow FW-7 component placement (AC7): only files under
 * src/components/ui/, src/components/domain/, or src/features/<area>/components/
 * are picked up. The placement check is enforced by .storybook/test-runner.ts
 * — keep this glob in sync.
 *
 * Addons are deliberately minimal (per AC2 / AC5):
 *   - addon-a11y: AC5 axe-core integration (Storybook UI panel + test-runner).
 *   - addon-docs: autodocs + MDX support for the conventions doc renders.
 *
 * Explicitly NOT installed (out of scope per the story's Out of Scope list):
 *   - @chromatic-com/storybook   → visual regression testing deferred.
 *   - @storybook/addon-vitest    → would conflict with the existing jsdom
 *     Vitest setup; the test-runner CLI is the dedicated story runner.
 *   - @storybook/addon-mcp       → not in the AC2 decorator stack.
 */
const config: StorybookConfig = {
  stories: [
    // FW-7 placement tiers (AC7). Story files MUST live under one of
    // these globs — `.storybook/test-runner.ts`'s setup hook checks the
    // same regex. The `src/test/fixtures/lint-bait/` directory is
    // deliberately excluded so the AC3 negative fixture is never
    // rendered by Storybook (only read as text by the Vitest unit test
    // at `src/test/storybook-rules/required-exports.test.ts`).
    '../src/components/ui/**/*.stories.@(ts|tsx)',
    '../src/components/domain/**/*.stories.@(ts|tsx)',
    '../src/features/*/components/**/*.stories.@(ts|tsx)',
  ],
  addons: ['@storybook/addon-a11y', '@storybook/addon-docs'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  staticDirs: ['../public'],
  typescript: {
    reactDocgen: 'react-docgen-typescript',
  },
}

export default config
