/**
 * features/analytics — public export surface (Story 8-2b, TS-7). Consumers
 * import the route/pages/hooks from this barrel; the two hand-built charts live
 * in `components/domain/*` (imported by direct path there). The shared pure fns
 * live in `@/lib/analytics/*` (a non-feature tier so the domain charts can
 * consume them without an FW-7 domain→feature inversion — code-review 2026-09-22)
 * and are imported directly from there, never re-exported through this barrel.
 */
export { AnalyticsRoute } from './AnalyticsRoute'
export { MyPerformancePage } from './MyPerformancePage'
export { ClassPerformanceView } from './components/ClassPerformanceView'
export { useAnalyticsHome } from './api/useAnalyticsHome'
export { useClassPerformance } from './api/useClassPerformance'
export { analyticsKeys } from './api/analyticsKeys'
