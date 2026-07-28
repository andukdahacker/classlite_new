/**
 * ExerciseSettingsPanel — Story 4.2 (AC4). The exercise-level settings:
 *   - time-limit toggle (+ a minutes number input when enabled)
 *   - case-sensitive answer key toggle (default OFF ⇒ case-insensitive)
 *
 * Reads/writes `content.settings` via the document autosave. Every FR-22 default
 * is the type zero value, so no false-zero handling is needed. There is NO
 * hyphen/whitespace-normalization toggle — that is fixed always-on grading
 * behavior (Epic 5), not per-row config.
 */
import { useTranslation } from 'react-i18next'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ExerciseSettings } from '../../lib/editorTypes'

export interface ExerciseSettingsPanelProps {
  settings: ExerciseSettings
  onChange: (patch: Partial<ExerciseSettings>) => void
}

const MIN_MINUTES = 1
// Mirrors the server's `maxTimeLimitMinutes` (24h) in
// internal/store/exercise_content_validate.go — a single source of truth so a
// value the UI accepts never 422s the autosave. (Review P2)
const MAX_MINUTES = 24 * 60

export function ExerciseSettingsPanel({ settings, onChange }: ExerciseSettingsPanelProps) {
  const { t } = useTranslation()

  return (
    <section
      className="flex flex-col gap-4 rounded-md border border-border p-4"
      aria-label={t('exercises.editor.settings.paneLabel')}
      data-testid="editor-settings-panel"
    >
      <h3 className="text-sm font-semibold">{t('exercises.editor.settings.heading')}</h3>

      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="editor-settings-timelimit" className="font-normal">
          {t('exercises.editor.settings.timeLimitLabel')}
        </Label>
        <Switch
          id="editor-settings-timelimit"
          checked={settings.timeLimitEnabled}
          onCheckedChange={(checked) => onChange({ timeLimitEnabled: checked })}
          data-testid="editor-settings-timelimit"
        />
      </div>

      {settings.timeLimitEnabled ? (
        <div className="flex items-center justify-between gap-3 pl-1">
          <Label htmlFor="editor-settings-minutes" className="font-normal">
            {t('exercises.editor.settings.minutesLabel')}
          </Label>
          <Input
            id="editor-settings-minutes"
            type="number"
            inputMode="numeric"
            min={MIN_MINUTES}
            max={MAX_MINUTES}
            value={settings.timeLimitMinutes || ''}
            onChange={(e) => {
              const raw = e.target.value
              if (raw === '') {
                onChange({ timeLimitMinutes: 0 })
                return
              }
              // Integer-only (the server decodes a Go `int` — a fractional JSON
              // number fails unmarshal → opaque 400) and bounded to the server's
              // range so a valid-looking value never 422s the autosave. (P2)
              const parsed = Number(raw)
              if (!Number.isFinite(parsed)) return
              const minutes = Math.min(MAX_MINUTES, Math.max(0, Math.round(parsed)))
              onChange({ timeLimitMinutes: minutes })
            }}
            className="w-24"
            data-testid="editor-settings-minutes"
          />
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="editor-settings-casesensitive" className="font-normal">
          {t('exercises.editor.settings.caseSensitiveLabel')}
        </Label>
        <Switch
          id="editor-settings-casesensitive"
          checked={settings.caseSensitive}
          onCheckedChange={(checked) => onChange({ caseSensitive: checked })}
          data-testid="editor-settings-casesensitive"
        />
      </div>
    </section>
  )
}
