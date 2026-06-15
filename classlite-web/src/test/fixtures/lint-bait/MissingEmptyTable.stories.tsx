/**
 * Negative fixture — Story 1d-1 AC3.
 *
 * Intentionally violates the three-state required-exports rule by
 * omitting the `Empty` and `Error` exports. The unit test
 * `src/test/storybook-rules/required-exports.test.ts` reads this file
 * from disk, parses its exports, and asserts `checkRequiredExports()`
 * returns `ok: false` with both names in `missing`. If a future dev
 * "fixes" this file by adding the missing exports, the test will fail
 * loudly — that's the whole point: this file is the canonical proof
 * that the rule has teeth.
 *
 * Location note: lives under `src/test/fixtures/lint-bait/` so that
 * `.storybook/main.ts`'s story-discovery globs (which only walk
 * `src/components/**` and `src/features/**`) do not pick it up. Storybook
 * never builds this fixture; only the unit test reads it.
 *
 * eslint-disable-next-line — this fixture intentionally is incomplete.
 */

// `Table.stories.tsx` naming triggers the three-state rule. The required
// set is ['Default', 'Loading', 'Empty', 'Error'] — we ship only the
// first two so the test asserts `missing: ['Empty', 'Error']`.

export default {
  title: 'lint-bait/MissingEmptyTable',
}

export const Default = { args: {} }
export const Loading = { args: {} }
