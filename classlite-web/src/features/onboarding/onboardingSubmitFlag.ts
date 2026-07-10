/**
 * onboardingSubmitFlag — module-scope flag that suppresses the
 * `OnboardingLayout` guard's `session.center != null → /dashboard` redirect
 * while `CenterSetupPage` is mid-submit.
 *
 * Why a module-scope flag rather than a `useRef` in a context or a Zustand
 * store: the guard needs to observe this from a sibling component in the
 * same render pass without triggering re-renders (a context edge would;
 * a store would). The lifecycle is bounded to a single submit — flip on
 * before `createCenter.mutate`, clear on error, latch through the
 * `/setup/template` navigate. `CenterSetupPage` unmounts on that navigate
 * so there is no long-running latch to leak.
 *
 * Lives in its own module so `OnboardingLayout.tsx` can stay compliant with
 * `react-refresh/only-export-components`.
 */

export const onboardingSubmitFlag = {
  current: false,
  set(value: boolean) {
    this.current = value
  },
}
