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
