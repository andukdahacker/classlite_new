/**
 * connectMarker — Story 2-5c AC14 sessionStorage sentinel.
 *
 * Extracted into its own file so both useConnectGoogleMeet (set) and
 * SettingsPage (read + clear) reference the same key without importing
 * a hook. The key is intentionally scoped by provider so future
 * integrations can add their own markers without collision.
 */
export const CONNECT_IN_FLIGHT_MARKER_KEY = 'meet-connect-in-flight'
