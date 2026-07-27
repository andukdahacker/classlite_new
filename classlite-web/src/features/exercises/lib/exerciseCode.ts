/**
 * exerciseCode — Story 4.1 (AC1). The skill → letter + tile-color mapping for
 * the s15 skill-letter tile. Letters are locale-invariant (they mirror the
 * server EX-<L><NNN> code; never translate them). Colors follow the UX §5.6
 * R/L/W/S/G skill palette (extended to vocabulary/general).
 */
import type { ExerciseSkill } from '../api/useExercises'

const SKILL_LETTERS: Record<ExerciseSkill, string> = {
  reading: 'R',
  listening: 'L',
  writing: 'W',
  speaking: 'S',
  grammar: 'G',
  vocabulary: 'V',
  general: 'X',
}

// Tile color is a CSS design token (--cl-skill-*, defined in src/tokens.css) —
// never a raw hex here (the palette lives in the design system, one skill per
// letter, so dark mode + rebrands stay single-source).
const SKILL_TILE_COLORS: Record<ExerciseSkill, string> = {
  reading: 'var(--cl-skill-reading)',
  listening: 'var(--cl-skill-listening)',
  writing: 'var(--cl-skill-writing)',
  speaking: 'var(--cl-skill-speaking)',
  grammar: 'var(--cl-skill-grammar)',
  vocabulary: 'var(--cl-skill-vocabulary)',
  general: 'var(--cl-skill-general)',
}

export function skillLetter(skill: ExerciseSkill): string {
  return SKILL_LETTERS[skill] ?? 'X'
}

export function skillTileColor(skill: ExerciseSkill): string {
  return SKILL_TILE_COLORS[skill] ?? 'var(--cl-skill-general)'
}
