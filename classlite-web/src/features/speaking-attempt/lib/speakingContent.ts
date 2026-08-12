/**
 * speakingContent — Story 5.4 Task 2 (AC4/AC5/AC15). This story OWNS the speaking
 * `submission.content` JSONB shape (opaque to the backend, ≤256 KiB — trivially,
 * since the audio BYTES live in R2 out-of-band and only the key rides `content`):
 *
 *   { schemaVersion: 1, audioKey: string, contentType: string, durationSec: number }
 *
 * Each save is a FULL replace. `contentType` is stored so Story 5.5 / Epic 6 play
 * the right container (webm vs mp4); `durationSec` drives the min-duration silent-
 * take gate (AC18) and the preview/submit display.
 *
 * The critical divergence from writing (source of BLOCKER-1/2): a writing value is
 * ALWAYS-local text, but the speaking value is a SERVER-MINTED KEY. So the offline
 * reconcile is ASYMMETRIC (D5) — a stale/empty local mirror must never blank a
 * real server key. All exports are pure so they unit-test without a React harness.
 */
import type { DraftMerge, ReconcileConfig } from '@/features/attempts'

/** The only content schema version this story emits (AC4). */
export const SPEAKING_CONTENT_SCHEMA_VERSION = 1 as const

/**
 * The speaking-attempt shape of `submission.content`. The generated
 * `SubmissionContent` is an open bag — this is the concrete key-carrying shape
 * this feature reads and writes into it.
 */
export interface SpeakingContent {
  schemaVersion: typeof SPEAKING_CONTENT_SCHEMA_VERSION
  /** The R2 object key of the uploaded take (`{center}/speaking/{uuid}.{ext}`). Empty = no recording. */
  audioKey: string
  /** The canonical container MIME (`audio/webm` | `audio/mp4`) so playback picks the right decoder. */
  contentType: string
  /** The take length in seconds — drives the min-duration gate + the UI display. */
  durationSec: number
}

/** The versioned empty content — a fresh attempt with no recording yet. */
export function emptySpeakingContent(): SpeakingContent {
  return {
    schemaVersion: SPEAKING_CONTENT_SCHEMA_VERSION,
    audioKey: '',
    contentType: '',
    durationSec: 0,
  }
}

/**
 * Coerce an untrusted `content` bag (server response or localStorage) into the
 * concrete `SpeakingContent` shape. Mis-typed / missing fields degrade safely and
 * `schemaVersion` is always re-stamped, so a resumed old/missing version
 * normalizes without throwing (AC4).
 */
export function normalizeSpeakingContent(raw: unknown): SpeakingContent {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return emptySpeakingContent()
  }
  const bag = raw as Record<string, unknown>
  const audioKey = typeof bag.audioKey === 'string' ? bag.audioKey : ''
  const contentType = typeof bag.contentType === 'string' ? bag.contentType : ''
  const durationRaw = bag.durationSec
  const durationSec =
    typeof durationRaw === 'number' && Number.isFinite(durationRaw) && durationRaw > 0
      ? durationRaw
      : 0
  return {
    schemaVersion: SPEAKING_CONTENT_SCHEMA_VERSION,
    audioKey,
    contentType,
    durationSec,
  }
}

// --- codec selection (D1/AC5) ------------------------------------------------

/** The canonical bare container MIME — the ONLY source for presign contentType,
 * stored content.contentType, and the key extension (NEVER `blob.type`, which
 * reports `audio/webm;codecs=opus` or empty on iOS and would 400 the presign's
 * exact-MIME lock). */
export type CanonicalAudioMime = 'audio/webm' | 'audio/mp4'

export interface PickedAudioMime {
  /** The full MIME (with codecs) to hand to `new MediaRecorder(stream, { mimeType })`. */
  recorderMimeType: string
  /** The bare canonical MIME for the presign + stored contentType. */
  canonical: CanonicalAudioMime
  /** The key/filename extension that follows the container. */
  ext: '.webm' | '.m4a'
}

const AUDIO_MIME_CANDIDATES: ReadonlyArray<{
  recorderMimeType: string
  canonical: CanonicalAudioMime
  ext: '.webm' | '.m4a'
}> = [
  { recorderMimeType: 'audio/webm;codecs=opus', canonical: 'audio/webm', ext: '.webm' },
  { recorderMimeType: 'audio/webm', canonical: 'audio/webm', ext: '.webm' },
  // iOS Safari records audio/mp4 (AAC), not webm.
  { recorderMimeType: 'audio/mp4', canonical: 'audio/mp4', ext: '.m4a' },
]

/**
 * Pick the recording container via `MediaRecorder.isTypeSupported` feature
 * detection (AC5): prefer webm/opus, fall back to audio/mp4 (iOS Safari). Returns
 * `null` when NO audio container is supported → the caller shows a blame-free
 * "this browser can't record audio" orientation instead of crashing.
 * @param isTypeSupported injectable predicate (defaults to
 *   `MediaRecorder.isTypeSupported`) so the picker unit-tests without a real
 *   MediaRecorder.
 */
export function pickAudioMimeType(
  isTypeSupported?: (mimeType: string) => boolean,
): PickedAudioMime | null {
  const supported =
    isTypeSupported ??
    (typeof MediaRecorder !== 'undefined' &&
    typeof MediaRecorder.isTypeSupported === 'function'
      ? (mimeType: string) => MediaRecorder.isTypeSupported(mimeType)
      : () => false)
  for (const candidate of AUDIO_MIME_CANDIDATES) {
    if (supported(candidate.recorderMimeType)) {
      return { ...candidate }
    }
  }
  return null
}

// --- size / duration budget (D3/D10/AC7,16) ----------------------------------

/** The A9 speaking cap (mirrors the server `speakingAudioMaxBytes`, D3). */
export const SPEAKING_AUDIO_MAX_BYTES = 25 * 1024 * 1024

/**
 * The recorder's requested audio bitrate (128 kbps — good voice quality, small
 * files). Passed to `new MediaRecorder(stream, { audioBitsPerSecond })` so the
 * take size is PREDICTABLE, which is what makes the max-duration derivation a real
 * guarantee rather than a guess.
 */
export const SPEAKING_AUDIO_BITS_PER_SECOND = 128_000

/**
 * The max recording duration, DERIVED from the 25 MB budget (AC7/D10) so the size
 * ceiling is never discovered post-take. Uses a 2× safety factor over the
 * requested bitrate: even if a browser overshoots our requested 128 kbps by 2×,
 * `SPEAKING_MAX_DURATION_SEC` seconds of audio still fits under 25 MB. The
 * recorder auto-stops here.
 */
export const SPEAKING_MAX_DURATION_SEC = Math.floor(
  SPEAKING_AUDIO_MAX_BYTES / (2 * (SPEAKING_AUDIO_BITS_PER_SECOND / 8)),
)

/**
 * Below this, a take is treated as silent/accidental — the submit sheet shows a
 * non-blocking "no usable recording — submit anyway?" warning (AC18, Sally B3).
 * A silent Blob must never sail through unnoticed.
 */
export const SPEAKING_MIN_DURATION_SEC = 3

/**
 * The client-side preparation countdown default (D4, calm model). No backend
 * field yet — `exercise.prepSeconds` is FU-5-4-A. IELTS Part-2 cue-card prep is
 * one minute; the student can skip it ("Start recording now") since it protects
 * nothing (unenforced).
 */
export const SPEAKING_PREP_SECONDS = 60

// --- reconcile (ASYMMETRIC local-newer-wins, D5) -----------------------------

/**
 * The speaking conflict signal surfaced to the page for its reconcile toast.
 * Unlike writing's text recovery, the only local-wins case is recovering a
 * server-minted KEY whose `/progress` PUT failed after a successful R2 PUT.
 */
export interface SpeakingReconcileConflict {
  /** True when a differing local key was recovered over the server value. */
  recoveredLocalKey: boolean
  /** True when a detected concurrent foreign writer made the server win. */
  serverWonForeign: boolean
}

/** The conflict signal for "no reconcile ran" / no divergence. */
export const SPEAKING_NO_CONFLICT: SpeakingReconcileConflict = {
  recoveredLocalKey: false,
  serverWonForeign: false,
}

/**
 * Build the ASYMMETRIC speaking reconcile merge (AC15, D5 — the party-mode
 * BLOCKER). Because the value is a SERVER-MINTED key (not always-local text), the
 * policy is deliberately lopsided:
 *   - local has NO key (empty/stale mirror)         → SERVER wins (never blank a real key)
 *   - local has a DIFFERING non-empty key           → LOCAL wins (recover a key whose
 *                                                      /progress PUT failed post-PUT)
 *   - local key equals the server key               → SERVER wins (no divergence)
 *   - a foreign writer was detected (`foreignChanged`) → SERVER wins
 * @param foreignChanged whether a concurrent foreign writer was detected.
 */
export function makeSpeakingMerge(
  foreignChanged: boolean,
): DraftMerge<SpeakingContent, SpeakingReconcileConflict> {
  return (local, server) => {
    if (local === null || foreignChanged) {
      return {
        merged: server,
        conflict: {
          recoveredLocalKey: false,
          serverWonForeign: foreignChanged && local !== null,
        },
      }
    }
    // Asymmetry: local can only WIN when it holds a differing, non-empty key.
    if (local.audioKey !== '' && local.audioKey !== server.audioKey) {
      return {
        merged: local,
        conflict: { recoveredLocalKey: true, serverWonForeign: false },
      }
    }
    // Empty local, or a local key that matches the server → the server value
    // stands (a stale/empty mirror must never blank a real server key).
    return { merged: server, conflict: { ...SPEAKING_NO_CONFLICT } }
  }
}

/** The default (no-foreign-change) reconcile merge — asymmetric local-key-wins. */
export const reconcileSpeakingDrafts = makeSpeakingMerge(false)

/**
 * The speaking reconcile config wired into `reconcileStoredDraftIntoCache`.
 */
export const speakingReconcileConfig: ReconcileConfig<
  SpeakingContent,
  SpeakingReconcileConflict
> = {
  normalize: normalizeSpeakingContent,
  merge: reconcileSpeakingDrafts,
  noConflict: SPEAKING_NO_CONFLICT,
}
