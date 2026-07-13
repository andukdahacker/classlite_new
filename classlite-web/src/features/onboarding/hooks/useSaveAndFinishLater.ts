/**
 * useSaveAndFinishLater — Story 2-3c AC4 Round 1 code-review folds
 * (R1-C2-P1 + R1-C2-P2 + R1-C2-P3).
 *
 * Shared click-handler contract for the "Save and finish later" affordance
 * used by TemplateSelectPage / ClassSpawnPage / SoloFirstClassPage:
 *
 *  - **R1-C2-P1** — prevent double-click via `leaving` state; callers must
 *    combine on `disabled={leaving || primary-mutation-in-flight}`.
 *  - **R1-C2-P2** — flush failures do NOT silently swallow. A Sentry
 *    breadcrumb captures the diagnostic so we notice at scale (user still
 *    navigates to /dashboard per spec AC4 try/finally intent — a stalled
 *    auto-save must not orphan them on the wizard step).
 *  - **R1-C2-P3** — concurrent-mutation guard lives at the callsite; this
 *    hook only owns the leaving + flush + navigate lifecycle.
 *
 * Navigate uses `replace: true` (D2 kept — matches shipped 2-3a
 * `CenterSetupPage` pattern; back-nav shouldn't resurrect the paused step).
 */
import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router'
import { addBreadcrumb } from '@sentry/react'

interface UseSaveAndFinishLaterArgs {
  flush: () => Promise<void>
  page: string
}

export function useSaveAndFinishLater({
  flush,
  page,
}: UseSaveAndFinishLaterArgs) {
  const navigate = useNavigate()
  const [leaving, setLeaving] = useState(false)

  const trigger = useCallback(async () => {
    if (leaving) return
    setLeaving(true)
    try {
      await flush()
    } catch {
      addBreadcrumb({
        category: 'onboarding',
        message: 'save-and-finish-later flush failed',
        level: 'warning',
        data: { page },
      })
    } finally {
      navigate('/dashboard', { replace: true })
    }
  }, [leaving, flush, page, navigate])

  return { leaving, trigger }
}
