package store

// Story 6.4a (AC8, GO-7). The typed element of the auto_grade_results.answers JSONB — the
// per-question objective-grading record the teacher reviews and overrides. A typed struct
// (never map[string]interface{}): AutoMark is the engine verdict ("correct"|"wrong"|
// "needs_review"); OverrideMark is the teacher's manual mark (nil when not overridden).
// The answer-key fields (correctAnswer/acceptedVariants) are NOT stored here — grading
// reads them live from the frozen exercise (D14); this record holds only the student-facing
// state so a released grade never persists the key.
type AutoGradeAnswer struct {
	QuestionRef    string  `json:"questionRef"`
	StudentAnswer  string  `json:"studentAnswer"`
	StudentFlagged bool    `json:"studentFlagged"`
	AutoMark       string  `json:"autoMark"`
	OverrideMark   *string `json:"overrideMark"`
}
