/**
 * MultiTabTestPage — DEV-ONLY mount surface for the AC4 multi-tab refresh
 * Playwright spec.
 *
 * Two buttons exercise the two refresh paths:
 *   - `fire-bait` issues an apiFetch call to a 401-bait route the
 *     Playwright spec mocks. The bait flows through the full
 *     401 → refreshAccessToken → silent retry pipeline.
 *   - `fire-refresh-direct` calls `refreshAccessToken()` directly. For
 *     manual verification: open two tabs side-by-side, click the button
 *     in both within ~100ms, observe network DevTools — exactly one
 *     `/api/auth/refresh` request must appear across the two tabs.
 *
 * Production builds MUST NOT include this component. routes.tsx gates
 * the lazy import on `import.meta.env.DEV` so Rolldown statically folds
 * the conditional and the dev chunk never lands in dist/.
 */
import { useState } from 'react'
import { apiFetch } from '@/lib/api-fetch'
import { refreshAccessToken } from '@/lib/auth-refresh'

export default function MultiTabTestPage() {
  const [log, setLog] = useState<string[]>([])

  const fireBait = async () => {
    try {
      await apiFetch('/api/__bait')
      setLog((entries) => [...entries, 'bait: apiFetch resolved'])
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setLog((entries) => [...entries, 'bait: apiFetch rejected: ' + message])
    }
  }

  const fireRefreshDirect = async () => {
    const result = await refreshAccessToken()
    setLog((entries) => [
      ...entries,
      'refresh: ' + (result.ok ? 'ok' : 'fail'),
    ])
  }

  return (
    <div className="min-h-screen bg-[var(--cl-paper)] p-8">
      <h1
        data-testid="multi-tab-test-heading"
        className="font-[var(--cl-font-display)] text-2xl text-[var(--cl-ink)]"
      >
        Multi-tab refresh bait (DEV only)
      </h1>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          data-testid="fire-bait"
          onClick={fireBait}
          className="rounded-sm bg-[var(--cl-ink)] px-4 py-2 text-[var(--cl-paper)]"
        >
          Fire 401 bait
        </button>
        <button
          data-testid="fire-refresh-direct"
          onClick={fireRefreshDirect}
          className="rounded-sm bg-[var(--cl-accent)] px-4 py-2 text-[var(--cl-paper)]"
        >
          Fire direct refresh
        </button>
      </div>
      <ul
        data-testid="bait-log"
        className="mt-6 list-disc pl-6 text-[var(--cl-ink)]"
      >
        {log.map((entry, index) => (
          <li key={index}>{entry}</li>
        ))}
      </ul>
    </div>
  )
}
