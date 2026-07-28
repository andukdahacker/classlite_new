/**
 * KeyBadge — the canonical correct-answer marker (Story 4.2, mockup 02c:6115).
 * A green-tinted "✓ KEY" badge in mono, used across every question editor so
 * the correct option/answer reads identically everywhere. The exact tints come
 * from the mockup's answer-key palette.
 */
import { useTranslation } from 'react-i18next'

export function KeyBadge() {
  const { t } = useTranslation()
  return (
    <span
      className="inline-flex items-center rounded border border-[color:var(--cl-green)]/30 bg-[color:var(--cl-tint-green)] px-1.5 py-0.5 font-mono text-xs text-[color:var(--cl-green)]"
      data-testid="key-badge"
    >
      {t('exercises.editor.keyBadge')}
    </span>
  )
}
