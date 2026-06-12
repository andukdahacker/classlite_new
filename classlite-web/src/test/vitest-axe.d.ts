/**
 * vitest-axe type augmentation — Vitest 4 compat.
 *
 * vitest-axe ships an `extend-expect.d.ts` that augments the legacy
 * `global Vi.Assertion<T>` namespace from Vitest 0.x / 1.x. Vitest 4.x
 * moved the Assertion interface into `@vitest/expect` and exposes it
 * via the `vitest` package's module declaration. The package's stock
 * augmentation no longer attaches.
 *
 * We re-augment against the modern `vitest` module so
 * `expect(result).toHaveNoViolations()` type-checks. The runtime
 * registration still flows through `import 'vitest-axe/extend-expect'`
 * in `src/test/vitest-setup.ts`.
 */
import 'vitest'
import type { AxeMatchers } from 'vitest-axe/matchers'

// Declaration merging requires the interface form even when no extra
// members are added — `type` aliases do not merge with the upstream
// `vitest` definitions. The lint rules below are disabled per-line for
// the merge to compile cleanly while preserving the generic `T` from
// vitest's Assertion signature.
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars
  interface Assertion<T = unknown> extends AxeMatchers {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
