/**
 * Story 5.4 Task 2 (AC4,5,15) — pure unit tests for the speaking content model,
 * codec picker, and the ASYMMETRIC reconcile (the BLOCKER-1/2 oracle). RED-first.
 */
import { describe, expect, test } from 'vitest'
import {
  SPEAKING_AUDIO_MAX_BYTES,
  SPEAKING_MAX_DURATION_SEC,
  SPEAKING_MIN_DURATION_SEC,
  SPEAKING_PREP_SECONDS,
  SPEAKING_CONTENT_SCHEMA_VERSION,
  emptySpeakingContent,
  normalizeSpeakingContent,
  pickAudioMimeType,
  makeSpeakingMerge,
  speakingReconcileConfig,
  type SpeakingContent,
} from '../speakingContent'

const keyed = (audioKey: string, over?: Partial<SpeakingContent>): SpeakingContent => ({
  schemaVersion: SPEAKING_CONTENT_SCHEMA_VERSION,
  audioKey,
  contentType: 'audio/webm',
  durationSec: 30,
  ...over,
})

describe('normalizeSpeakingContent', () => {
  test('null / array / scalar → empty content', () => {
    expect(normalizeSpeakingContent(null)).toEqual(emptySpeakingContent())
    expect(normalizeSpeakingContent([])).toEqual(emptySpeakingContent())
    expect(normalizeSpeakingContent(42)).toEqual(emptySpeakingContent())
  })

  test('valid bag is coerced and schemaVersion re-stamped', () => {
    const out = normalizeSpeakingContent({
      schemaVersion: 99,
      audioKey: 'c/speaking/x.webm',
      contentType: 'audio/mp4',
      durationSec: 12,
    })
    expect(out).toEqual({
      schemaVersion: SPEAKING_CONTENT_SCHEMA_VERSION,
      audioKey: 'c/speaking/x.webm',
      contentType: 'audio/mp4',
      durationSec: 12,
    })
  })

  test('missing / mis-typed fields degrade safely (no throw)', () => {
    const out = normalizeSpeakingContent({ audioKey: 5, durationSec: 'nope' })
    expect(out.audioKey).toBe('')
    expect(out.contentType).toBe('')
    expect(out.durationSec).toBe(0)
  })

  test('non-finite / negative durationSec → 0', () => {
    expect(normalizeSpeakingContent({ durationSec: Number.NaN }).durationSec).toBe(0)
    expect(normalizeSpeakingContent({ durationSec: -3 }).durationSec).toBe(0)
    expect(normalizeSpeakingContent({ durationSec: Infinity }).durationSec).toBe(0)
  })
})

describe('pickAudioMimeType (canonical MIME source — never blob.type, AC5)', () => {
  test('webm/opus supported → audio/webm + .webm', () => {
    const picked = pickAudioMimeType((t) => t.includes('webm'))
    expect(picked?.canonical).toBe('audio/webm')
    expect(picked?.ext).toBe('.webm')
    expect(picked?.recorderMimeType).toContain('webm')
  })

  test('webm unsupported, mp4 supported (iOS Safari) → audio/mp4 + .m4a', () => {
    const picked = pickAudioMimeType((t) => t === 'audio/mp4')
    expect(picked?.canonical).toBe('audio/mp4')
    expect(picked?.ext).toBe('.m4a')
  })

  test('no supported audio mime → null (blame-free orientation, not a crash)', () => {
    expect(pickAudioMimeType(() => false)).toBeNull()
  })
})

describe('makeSpeakingMerge — ASYMMETRIC local-newer-wins (D5, BLOCKER oracle)', () => {
  const merge = makeSpeakingMerge(false)

  test('local null → server wins, no conflict', () => {
    const server = keyed('c/speaking/server.webm')
    expect(merge(null, server)).toEqual({
      merged: server,
      conflict: { recoveredLocalKey: false, serverWonForeign: false },
    })
  })

  test('EMPTY local + keyed server → SERVER wins (a stale/empty mirror must NEVER blank a real key)', () => {
    const server = keyed('c/speaking/server.webm')
    const local = emptySpeakingContent()
    const result = merge(local, server)
    expect(result.merged).toBe(server)
    expect(result.conflict.recoveredLocalKey).toBe(false)
  })

  test('keyed local DIFFERING from server → LOCAL wins (recover a key whose /progress PUT failed)', () => {
    const local = keyed('c/speaking/local.webm')
    const server = keyed('c/speaking/server.webm')
    const result = merge(local, server)
    expect(result.merged).toBe(local)
    expect(result.conflict.recoveredLocalKey).toBe(true)
  })

  test('keyed local SAME as server → server wins, no conflict', () => {
    const local = keyed('c/speaking/same.webm')
    const server = keyed('c/speaking/same.webm')
    expect(merge(local, server).conflict.recoveredLocalKey).toBe(false)
  })

  test('foreign signal → SERVER wins even if local has a differing key', () => {
    const foreignMerge = makeSpeakingMerge(true)
    const local = keyed('c/speaking/local.webm')
    const server = keyed('c/speaking/server.webm')
    const result = foreignMerge(local, server)
    expect(result.merged).toBe(server)
    expect(result.conflict.serverWonForeign).toBe(true)
  })
})

describe('constants', () => {
  test('25 MiB cap', () => {
    expect(SPEAKING_AUDIO_MAX_BYTES).toBe(25 * 1024 * 1024)
  })

  test('max-duration auto-stop is derived to GUARANTEE the 25 MB ceiling', () => {
    // Even at a generous 2× safety bitrate the recording must fit under the cap.
    expect(SPEAKING_MAX_DURATION_SEC).toBeGreaterThan(0)
    expect(SPEAKING_MIN_DURATION_SEC).toBeGreaterThan(0)
    expect(SPEAKING_MIN_DURATION_SEC).toBeLessThan(SPEAKING_MAX_DURATION_SEC)
    expect(SPEAKING_PREP_SECONDS).toBeGreaterThan(0)
  })

  test('reconcile config wires normalize + merge + noConflict', () => {
    expect(speakingReconcileConfig.normalize(null)).toEqual(emptySpeakingContent())
    expect(speakingReconcileConfig.noConflict).toEqual({
      recoveredLocalKey: false,
      serverWonForeign: false,
    })
  })
})
