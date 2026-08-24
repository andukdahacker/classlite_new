// Story 4.3a — the typed shape the AI generator (Gemini) is prompted to return.
//
// GO-7: the worker unmarshals Gemini's raw JSON into THESE structs, never a
// map[string]interface{}. A typed-unmarshal failure OR a downstream
// ValidateExerciseContentStructural failure is a terminal invalid_ai_response
// (AC6) — a bad prompt won't fix itself by retrying. SchemaVersion companions
// each blob so Story 4.5's lazy-upgrade machinery can dispatch later.
//
// These are the PROVIDER response contract; the worker maps them into the
// store.ExerciseContent v1 shape (which model must not import — store depends on
// model). The mapping + validation live in internal/worker.
package model

// AIResponseSchemaVersion is the version stamped on a generation result.
const AIResponseSchemaVersion = 1

// AISectionResponse is the section-mode generation result: a passage/prompt plus
// its question groups.
type AISectionResponse struct {
	SchemaVersion  int               `json:"schemaVersion"`
	SectionType    string            `json:"sectionType"`
	Title          string            `json:"title"`
	Passage        string            `json:"passage"`
	QuestionGroups []AIQuestionGroup `json:"questionGroups"`
}

// AIQuestionsResponse is the questions-mode result: groups to append to an
// existing section.
type AIQuestionsResponse struct {
	SchemaVersion  int               `json:"schemaVersion"`
	QuestionGroups []AIQuestionGroup `json:"questionGroups"`
}

// AIDistractorsResponse is the distractors-mode result: the full option list for
// one MCQ question (the correct answer plus the generated distractors).
type AIDistractorsResponse struct {
	SchemaVersion int      `json:"schemaVersion"`
	Options       []string `json:"options"`
	CorrectAnswer string   `json:"correctAnswer"`
}

// AIQuestionGroup mirrors store.QuestionGroup at the wire level.
type AIQuestionGroup struct {
	Type         string       `json:"type"`
	Instructions string       `json:"instructions"`
	Questions    []AIQuestion `json:"questions"`
}

// AIQuestion mirrors store.Question at the wire level.
type AIQuestion struct {
	Text             string   `json:"text"`
	Type             string   `json:"type"`
	Options          []string `json:"options"`
	CorrectAnswer    string   `json:"correctAnswer"`
	AcceptedVariants []string `json:"acceptedVariants"`
}

// --- Story 6.2a — AI Writing-grade response + result ---

// AI confidence levels (UX-DR22 — teacher-only). Mirrors the api.yaml
// AIWritingGradeCriterion/AnchoredAISuggestion confidence enum.
const (
	AIConfidenceHigh   = "high"
	AIConfidenceMedium = "medium"
)

// AIWritingGradeResponse is the shape Gemini is prompted to return for a Writing
// grade (6.2a). The criterion Band + Confidence and each comment field are POINTERS
// so the worker can distinguish "absent/null" (→ terminal invalid_ai_response, the
// D10 completeness rule) from "present but out of range" (→ terminal
// invalid_band_scores). The worker computes analyzedWordCount + latencyMs itself —
// they are NOT trusted from Gemini.
type AIWritingGradeResponse struct {
	Criteria        AIWritingCriteriaResponse  `json:"criteria"`
	Comments        []AIWritingCommentResponse `json:"comments"`
	OverallFeedback *string                    `json:"overallFeedback"`
}

// AIWritingCriteriaResponse is the four IELTS criteria as Gemini returns them.
type AIWritingCriteriaResponse struct {
	TaskResponse      AIWritingCriterionResponse `json:"taskResponse"`
	CoherenceCohesion AIWritingCriterionResponse `json:"coherenceCohesion"`
	LexicalResource   AIWritingCriterionResponse `json:"lexicalResource"`
	GrammaticalRange  AIWritingCriterionResponse `json:"grammaticalRange"`
}

// AIWritingCriterionResponse is one criterion as Gemini returns it. Band +
// Confidence are pointers: a nil (absent or JSON null) either → terminal
// invalid_ai_response (D10 completeness).
type AIWritingCriterionResponse struct {
	Band       *float64 `json:"band"`
	Rationale  string   `json:"rationale"`
	Confidence *string  `json:"confidence"`
}

// AIWritingCommentResponse is one anchored suggestion as Gemini returns it. Anchors
// are UTF-16 code-unit offsets into content.text (or null for whole-essay).
type AIWritingCommentResponse struct {
	Type        string  `json:"type"`
	Criterion   string  `json:"criterion"`
	AnchorStart *int    `json:"anchorStart"`
	AnchorEnd   *int    `json:"anchorEnd"`
	Text        string  `json:"text"`
	Confidence  *string `json:"confidence"`
}

// AIWritingGradeResult is the validated + normalized suggestion stored in
// jobs.result (6.2a). Value-typed (not pointers) because the seam invariant is
// "anything at status=complete is fully valid + gradeable" (D10) — so 6.2b/6.1 can
// trust it without re-deriving. It carries NO overall band (6.2b previews it; 6.1
// computes the authoritative one on commit — D1). Mirrors the api.yaml
// AIWritingGradeResult schema exactly.
type AIWritingGradeResult struct {
	Criteria          AIWritingGradeCriteria  `json:"criteria"`
	Comments          []AIWritingGradeComment `json:"comments"`
	OverallFeedback   *string                 `json:"overallFeedback"`
	AnalyzedWordCount int                     `json:"analyzedWordCount"`
	LatencyMs         int64                   `json:"latencyMs"`
}

// AIWritingGradeCriteria is the four validated criteria in the stored result.
type AIWritingGradeCriteria struct {
	TaskResponse      AIWritingGradeCriterion `json:"taskResponse"`
	CoherenceCohesion AIWritingGradeCriterion `json:"coherenceCohesion"`
	LexicalResource   AIWritingGradeCriterion `json:"lexicalResource"`
	GrammaticalRange  AIWritingGradeCriterion `json:"grammaticalRange"`
}

// AIWritingGradeCriterion is one validated criterion (band on the 0.5 grid,
// confidence ∈ {high, medium}).
type AIWritingGradeCriterion struct {
	Band       float64 `json:"band"`
	Rationale  string  `json:"rationale"`
	Confidence string  `json:"confidence"`
}

// AIWritingGradeComment is one normalized anchored suggestion (the 6.1
// AnchoredComment shape + confidence). Out-of-range / surrogate-splitting anchors
// were demoted to whole-essay (both nil) before storage (D5/D10).
type AIWritingGradeComment struct {
	Type        string `json:"type"`
	Criterion   string `json:"criterion"`
	AnchorStart *int   `json:"anchorStart"`
	AnchorEnd   *int   `json:"anchorEnd"`
	Text        string `json:"text"`
	Confidence  string `json:"confidence"`
}

// --- Story 6.3b — AI Speaking-grade response + result ---

// AISpeakingGradeResponse is the shape Gemini is prompted to return for a Speaking
// grade (6.3b) — the SPEAKING twin of AIWritingGradeResponse. The criterion Band +
// Confidence and each moment's Confidence are POINTERS so the worker can distinguish
// "absent/null" (→ terminal invalid_ai_response, the completeness rule) from "present
// but out of range" (→ terminal invalid_band_scores). Transcript is a pointer:
// present → transcriptionStatus=available; null/absent → partial_success
// (transcriptionStatus=unavailable, D3). The worker computes analyzedDurationMs +
// latencyMs itself — they are NOT trusted from Gemini.
type AISpeakingGradeResponse struct {
	Criteria        AISpeakingCriteriaResponse `json:"criteria"`
	Moments         []AISpeakingMomentResponse `json:"moments"`
	Transcript      *string                    `json:"transcript"`
	OverallFeedback *string                    `json:"overallFeedback"`
}

// AISpeakingCriteriaResponse is the four IELTS Speaking criteria as Gemini returns them.
type AISpeakingCriteriaResponse struct {
	FluencyCoherence AISpeakingCriterionResponse `json:"fluencyCoherence"`
	LexicalResource  AISpeakingCriterionResponse `json:"lexicalResource"`
	GrammaticalRange AISpeakingCriterionResponse `json:"grammaticalRange"`
	Pronunciation    AISpeakingCriterionResponse `json:"pronunciation"`
}

// AISpeakingCriterionResponse is one criterion as Gemini returns it. Band +
// Confidence are pointers: a nil (absent or JSON null) → terminal invalid_ai_response.
type AISpeakingCriterionResponse struct {
	Band       *float64 `json:"band"`
	Rationale  string   `json:"rationale"`
	Confidence *string  `json:"confidence"`
}

// AISpeakingMomentResponse is one AI moment as Gemini returns it — the
// TimestampedComment fields + a pointer Confidence. TimestampMs is milliseconds into
// the recording (or null for a general note). A missing Confidence → terminal
// invalid_ai_response (the completeness pre-check guards the positional zip nil-deref,
// D5/D11); a structurally-bad type/criterion/blank-text moment is DROPPED, not
// terminal (D11).
//
// TimestampMs is *float64 (not *int) on purpose (code review): an LLM routinely emits
// a whole number as `5000.0` or `5e3`, which Go's decoder REJECTS into an int —
// failing the top-level Unmarshal of the ENTIRE response and discarding a full-value
// four-band grade over one cosmetically-formatted number. The worker rounds it to the
// stored int pin (BoundSpeakingTimestampMs) after a successful parse.
type AISpeakingMomentResponse struct {
	Type        string   `json:"type"`
	Criterion   string   `json:"criterion"`
	TimestampMs *float64 `json:"timestampMs"`
	Text        string   `json:"text"`
	Confidence  *string  `json:"confidence"`
}

// AISpeakingGradeResult is the validated + normalized suggestion stored in
// jobs.result (6.3b) — the SPEAKING twin of AIWritingGradeResult. Value-typed because
// the seam invariant is "anything at status=complete is fully valid + gradeable" (D3)
// — bands are REQUIRED, the transcript is OPTIONAL. It carries NO overall band (6-3c
// previews it; 6.3a computes the authoritative one on commit — D1). Mirrors the
// api.yaml AISpeakingGradeResult schema exactly. transcript/confidence/rationale are
// TEACHER-ONLY (never surfaced to the student /result path — D10/UX-DR22).
type AISpeakingGradeResult struct {
	Criteria            AISpeakingGradeCriteria  `json:"criteria"`
	Moments             []AISpeakingGradeComment `json:"moments"`
	Transcript          *string                  `json:"transcript"`
	TranscriptionStatus string                   `json:"transcriptionStatus"`
	OverallFeedback     *string                  `json:"overallFeedback"`
	AnalyzedDurationMs  int                      `json:"analyzedDurationMs"`
	LatencyMs           int64                    `json:"latencyMs"`
}

// AISpeakingGradeCriteria is the four validated Speaking criteria in the stored result.
type AISpeakingGradeCriteria struct {
	FluencyCoherence AISpeakingGradeCriterion `json:"fluencyCoherence"`
	LexicalResource  AISpeakingGradeCriterion `json:"lexicalResource"`
	GrammaticalRange AISpeakingGradeCriterion `json:"grammaticalRange"`
	Pronunciation    AISpeakingGradeCriterion `json:"pronunciation"`
}

// AISpeakingGradeCriterion is one validated criterion (band on the 0.5 grid,
// confidence ∈ {high, medium}).
type AISpeakingGradeCriterion struct {
	Band       float64 `json:"band"`
	Rationale  string  `json:"rationale"`
	Confidence string  `json:"confidence"`
}

// AISpeakingGradeComment is one normalized AI moment (the 6.3a TimestampedComment
// shape + confidence). An out-of-bound timestampMs was demoted to null before storage
// (never dropped); a structurally-malformed moment was dropped entirely (D11).
type AISpeakingGradeComment struct {
	Type        string `json:"type"`
	Criterion   string `json:"criterion"`
	TimestampMs *int   `json:"timestampMs"`
	Text        string `json:"text"`
	Confidence  string `json:"confidence"`
}
