/**
 * AttemptAudioPlayer — Story 5.2b Task 7 (AC9, D4). A native `<audio controls>`
 * player (play/pause, seek, playback-rate via the browser's own control) for the
 * listening section's audio URL, parsed from `AttemptSection.content`. No
 * waveform, no new dependency. v1 allows replay/seek (native default); IELTS
 * single-play enforcement is a flagged product follow-up (AC9), not blocking.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface AttemptAudioPlayerProps {
  /** The section content — a listening section carries the audio URL here. */
  content: string
}

/** Pull the first http(s) URL out of the section content (audio src). */
function parseAudioUrl(content: string): string | null {
  const trimmed = content.trim()
  if (/^https?:\/\/\S+$/i.test(trimmed)) return trimmed
  const match = content.match(/https?:\/\/\S+/i)
  return match ? match[0] : null
}

export function AttemptAudioPlayer({ content }: AttemptAudioPlayerProps) {
  const { t } = useTranslation()
  const src = parseAudioUrl(content)
  // A present-but-broken URL (404 / network / codec) must not render a dead
  // player with no explanation — surface the same unsupported message.
  const [loadFailed, setLoadFailed] = useState(false)

  return (
    <div className="flex flex-col gap-3" data-testid="attempt-audio">
      {src && !loadFailed ? (
        <audio
          controls
          controlsList="nodownload"
          src={src}
          onError={() => setLoadFailed(true)}
          aria-label={t('attempt.audio.label')}
          data-testid="attempt-audio-el"
          className="w-full"
        >
          {t('attempt.audio.unsupported')}
        </audio>
      ) : (
        <p className="text-sm text-[var(--cl-ink-soft)]" data-testid="attempt-audio-unsupported">
          {t('attempt.audio.unsupported')}
        </p>
      )}
    </div>
  )
}
