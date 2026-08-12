/**
 * Story 5.4 Task 4 (AC12,13,16) — the speaking upload chain + auto-retry, with the
 * 4-KEY request-event recorder (presign | r2put | confirm | progress). The count
 * oracle is the party-mode contract: absent-verification tags all four request
 * types, not just "PUT" (Murat B2). MSW is the HTTP seam; the dynamic R2 PUT host
 * has its own handler.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw-server'
import {
  uploadSpeakingAudio,
  SpeakingUploadTooLargeError,
  UploadAbortedError,
} from '../uploadSpeakingAudio'
import { SPEAKING_AUDIO_MAX_BYTES } from '../../lib/speakingContent'

const R2_HOST = 'https://r2-mock.example.com'

interface Counts {
  presign: number
  r2put: number
  confirm: number
  progress: number
}

function makeBlob(size = 1024): Blob {
  const blob = new Blob(['x'])
  Object.defineProperty(blob, 'size', { value: size })
  return blob
}

let counts: Counts
let presignedContentType: string | null

function installHandlers(opts: { putStatus?: number; presignStatus?: number } = {}): void {
  counts = { presign: 0, r2put: 0, confirm: 0, progress: 0 }
  presignedContentType = null
  server.use(
    http.post('/api/uploads/presign', async ({ request }) => {
      counts.presign += 1
      const body = (await request.json()) as { contentType: string }
      presignedContentType = body.contentType
      if (opts.presignStatus && opts.presignStatus >= 400) {
        return HttpResponse.json(
          { error: { code: 'FILE_TOO_LARGE', message: 'too large', requestId: 'r' } },
          { status: opts.presignStatus },
        )
      }
      const key = `center/speaking/${counts.presign}.webm`
      return HttpResponse.json({ data: { url: `${R2_HOST}/${key}`, key } })
    }),
    http.put(`${R2_HOST}/*`, () => {
      counts.r2put += 1
      return new HttpResponse(null, { status: opts.putStatus ?? 200 })
    }),
    http.post('/api/uploads/confirm', () => {
      counts.confirm += 1
      return HttpResponse.json({ data: { key: 'k', contentType: 'audio/webm', size: 1024 } })
    }),
    http.put('/api/submissions/:id/progress', () => {
      counts.progress += 1
      return HttpResponse.json({ data: {} })
    }),
  )
}

beforeEach(() => {
  vi.useRealTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('happy path', () => {
  test('webm take → presign(.webm, audio/webm) + PUT + confirm, returns key', async () => {
    installHandlers()
    const result = await uploadSpeakingAudio({
      blob: makeBlob(),
      contentType: 'audio/webm',
      ext: '.webm',
      backoffBaseMs: 0,
    })
    expect(result.key).toBe('center/speaking/1.webm')
    expect(counts).toEqual({ presign: 1, r2put: 1, confirm: 1, progress: 0 })
    expect(presignedContentType).toBe('audio/webm')
  })

  test('mp4 take → presign carries audio/mp4 (iOS variant)', async () => {
    installHandlers()
    await uploadSpeakingAudio({
      blob: makeBlob(),
      contentType: 'audio/mp4',
      ext: '.m4a',
      backoffBaseMs: 0,
    })
    expect(presignedContentType).toBe('audio/mp4')
  })
})

describe('auto-retry (AC13, R43)', () => {
  test('PUT fails → EXACTLY 4 presign + 4 r2put + 0 confirm + 0 progress, then throws', async () => {
    installHandlers({ putStatus: 502 })
    await expect(
      uploadSpeakingAudio({
        blob: makeBlob(),
        contentType: 'audio/webm',
        ext: '.webm',
        backoffBaseMs: 0,
      }),
    ).rejects.toBeInstanceOf(Error)
    expect(counts).toEqual({ presign: 4, r2put: 4, confirm: 0, progress: 0 })
  })

  test('permanent 413 at presign → NOT retried (1 presign, 0 put)', async () => {
    installHandlers({ presignStatus: 413 })
    await expect(
      uploadSpeakingAudio({
        blob: makeBlob(),
        contentType: 'audio/webm',
        ext: '.webm',
        backoffBaseMs: 0,
      }),
    ).rejects.toBeTruthy()
    expect(counts.presign).toBe(1)
    expect(counts.r2put).toBe(0)
  })

  test('abort during a retry backoff fires NO further presign / r2put', async () => {
    installHandlers({ putStatus: 502 })
    const controller = new AbortController()
    const promise = uploadSpeakingAudio({
      blob: makeBlob(),
      contentType: 'audio/webm',
      ext: '.webm',
      backoffBaseMs: 10_000,
      signal: controller.signal,
      // The first failure schedules a retry — abort inside that window.
      onRetry: () => controller.abort(),
    })
    await expect(promise).rejects.toBeInstanceOf(UploadAbortedError)
    expect(counts.presign).toBe(1)
    expect(counts.r2put).toBe(1)
    expect(counts.confirm).toBe(0)
  })
})

describe('client 25 MB pre-check (AC16 layer 1)', () => {
  test('oversize blob throws BEFORE any presign', async () => {
    installHandlers()
    await expect(
      uploadSpeakingAudio({
        blob: makeBlob(SPEAKING_AUDIO_MAX_BYTES + 1),
        contentType: 'audio/webm',
        ext: '.webm',
      }),
    ).rejects.toBeInstanceOf(SpeakingUploadTooLargeError)
    expect(counts.presign).toBe(0)
  })
})
