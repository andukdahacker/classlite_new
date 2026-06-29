/**
 * lockoutStorage — same-tab + cross-tab persistence for the LoginPage lockout countdown.
 *
 * **UX persistence only. Backend is the security boundary. A cleared value here does
 * NOT unlock the account.** The backend's 15-minute lockout window (per
 * service/auth.go:53-55 LoginLockoutDuration) continues to reject login attempts
 * regardless of whether the localStorage value exists. The storage exists ONLY so
 * an F5 / new-tab open after a 429 ACCOUNT_LOCKED keeps the countdown UI visible
 * instead of inviting another submit that gets rejected.
 *
 * Storage shape: JSON envelope `{lockoutUntilMs: number, version: 1}` — forward
 * compatible with a future backend `GET /api/auth/lockout-status` endpoint that
 * would add source-of-truth metadata. Raw int storage would break silently.
 *
 * On ANY parse / shape mismatch / stale (past-by-any-duration) value:
 * `readLockoutUntilMs()` calls `clearLockoutUntilMs()` AND returns `null`.
 * This breaks the rehydrate-then-reject loop that would otherwise lock a
 * user OUT of `/login` indefinitely if their localStorage was poisoned by
 * an attacker or QA leak.
 *
 * SecurityError (Safari private mode) and QuotaExceededError fall through
 * silently — the storage degrades to in-memory-only for that session, which
 * still gives the user the form back after they navigate.
 */
const LOCKOUT_STORAGE_KEY = 'classlite_login_lockout_until'
const ENVELOPE_VERSION = 1

interface LockoutEnvelope {
  lockoutUntilMs: number
  version: 1
}

function safeGetItem(key: string): string | null {
  if (typeof window === 'undefined' || !window.localStorage) return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSetItem(key: string, value: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // SecurityError / QuotaExceededError — UX persistence degrades to
    // in-memory for this session; the backend still enforces the lockout
    // window regardless.
  }
}

function safeRemoveItem(key: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Same fallback posture as safeSetItem.
  }
}

export function readLockoutUntilMs(): number | null {
  const raw = safeGetItem(LOCKOUT_STORAGE_KEY)
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    safeRemoveItem(LOCKOUT_STORAGE_KEY)
    return null
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    !('lockoutUntilMs' in parsed) ||
    !('version' in parsed)
  ) {
    safeRemoveItem(LOCKOUT_STORAGE_KEY)
    return null
  }
  const envelope = parsed as Partial<LockoutEnvelope>
  if (
    typeof envelope.lockoutUntilMs !== 'number' ||
    !Number.isFinite(envelope.lockoutUntilMs) ||
    envelope.lockoutUntilMs <= 0 ||
    envelope.version !== ENVELOPE_VERSION
  ) {
    safeRemoveItem(LOCKOUT_STORAGE_KEY)
    return null
  }
  if (envelope.lockoutUntilMs < Date.now()) {
    safeRemoveItem(LOCKOUT_STORAGE_KEY)
    return null
  }
  return envelope.lockoutUntilMs
}

export function writeLockoutUntilMs(ms: number): void {
  if (!Number.isFinite(ms) || ms <= 0) return
  const envelope: LockoutEnvelope = {
    lockoutUntilMs: ms,
    version: ENVELOPE_VERSION,
  }
  safeSetItem(LOCKOUT_STORAGE_KEY, JSON.stringify(envelope))
}

export function clearLockoutUntilMs(): void {
  safeRemoveItem(LOCKOUT_STORAGE_KEY)
}

export { LOCKOUT_STORAGE_KEY }
