package store

// Story 8-3a / FU-8-2-A (AC16, GO-7). The typed element of the immutable
// grades.answer_errors JSONB — one definitive-incorrect objective answer, snapshotted
// at AutoGradeService.Release so the student/class Mistakes surfaces can mine
// Reading/Listening auto-graded errors.
//
// Deliberately carries NO `skill` (Winston C2): skill is exercises.skill, derived by a
// JOIN at mine-time exactly like the human-comment mining path, so there is one source
// of truth. Baking skill into the JSONB would let two sources drift (a section Type can
// differ from the exercise skill — exercise_content.go). QuestionType is the effective
// per-question type (question type, group-type fallback) resolved via
// grading.QuestionTypesByRef; at mine-time it becomes the pattern's `criterion`.
type AnswerError struct {
	QuestionRef   string `json:"questionRef"`
	QuestionType  string `json:"questionType"`
	SchemaVersion int    `json:"schemaVersion"`
}
