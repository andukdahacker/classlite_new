/**
 * MyPerformancePage — the student `/my-performance` route body (Story 8-3b, AC2).
 * Replaces the 8-2b dormant placeholder with the REAL softened student view
 * (`MyPerformanceContainer` owns the `GET /api/analytics/me` fetch + trilogy). The
 * route, `RouteRoleGate allowedRoles=['student']`, and sidebar link are unchanged.
 */
import type { ReactElement } from 'react'
import { MyPerformanceContainer } from './components/MyPerformanceContainer'

export function MyPerformancePage(): ReactElement {
  return <MyPerformanceContainer />
}
