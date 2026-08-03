// Story 5.2a — the answer-strip mapper (AC10,11,12). THE SEC CORE of this
// keystone.
//
// SECURITY INVARIANT (AC10, D1): the AttemptExercise/AttemptSection/
// AttemptQuestionGroup/AttemptQuestion types below are DISTINCT response types
// that do NOT declare correctAnswer or acceptedVariants at all. The mapper reads
// store.ExerciseContent and constructs them field-by-field (a WHITELIST) — it
// never references an answer field. This is a STRUCTURAL omission, not a runtime
// filter: a future field added to store.Question is therefore hidden by default
// (it can only reach a student if someone explicitly adds it to a mapper here),
// and no `json:"-"`/blacklist over the existing type leaves the answer one
// refactor away from re-leaking. The raw-JSON golden test across all five group
// types (attempt_read_test.go) is the belt-and-suspenders backstop (D7).
//
// The mapper is skill-agnostic (AC12): it strips answers uniformly and preserves
// section / group / question ordering; prompt-only sections (empty questionGroups,
// writing/speaking) round-trip intact so 5.3/5.4 read the prompt from
// section.content.
package service

import (
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/google/uuid"
)

// AttemptQuestion is the student-visible question surface. It carries ONLY
// text/type/options — correctAnswer and acceptedVariants are structurally absent
// (AC10,11). Serialized directly by the handler.
type AttemptQuestion struct {
	Text    string   `json:"text"`
	Type    string   `json:"type"`
	Options []string `json:"options"`
}

// AttemptQuestionGroup mirrors store.QuestionGroup with answer-stripped questions.
type AttemptQuestionGroup struct {
	Type         string            `json:"type"`
	Instructions string            `json:"instructions"`
	Questions    []AttemptQuestion `json:"questions"`
}

// AttemptSection mirrors store.ExerciseSection. Content carries the passage /
// prompt / audio-URL text (student-visible).
type AttemptSection struct {
	Type           string                 `json:"type"`
	Title          string                 `json:"title"`
	Content        string                 `json:"content"`
	QuestionGroups []AttemptQuestionGroup `json:"questionGroups"`
}

// AttemptExercise is the answer-stripped exercise the attempt UIs render. Settings
// reuses store.ExerciseSettings verbatim (no answer data there).
type AttemptExercise struct {
	ID       string                 `json:"id"`
	Title    string                 `json:"title"`
	Skill    string                 `json:"skill"`
	Sections []AttemptSection       `json:"sections"`
	Settings store.ExerciseSettings `json:"settings"`
}

// toAttemptExercise builds the answer-stripped AttemptExercise from a decoded
// store.ExerciseContent (already run through the version ladder by the caller).
// Pure + whitelist: it references no answer field. Ordering is preserved.
func toAttemptExercise(content store.ExerciseContent, id uuid.UUID, title, skill string) AttemptExercise {
	sections := make([]AttemptSection, len(content.Sections))
	for i, s := range content.Sections {
		sections[i] = toAttemptSection(s)
	}
	return AttemptExercise{
		ID:       id.String(),
		Title:    title,
		Skill:    skill,
		Sections: sections,
		Settings: content.Settings,
	}
}

func toAttemptSection(s store.ExerciseSection) AttemptSection {
	groups := make([]AttemptQuestionGroup, len(s.QuestionGroups))
	for i, g := range s.QuestionGroups {
		groups[i] = toAttemptQuestionGroup(g)
	}
	return AttemptSection{
		Type:           s.Type,
		Title:          s.Title,
		Content:        s.Content,
		QuestionGroups: groups,
	}
}

func toAttemptQuestionGroup(g store.QuestionGroup) AttemptQuestionGroup {
	questions := make([]AttemptQuestion, len(g.Questions))
	for i, q := range g.Questions {
		questions[i] = toAttemptQuestion(q)
	}
	return AttemptQuestionGroup{
		Type:         g.Type,
		Instructions: g.Instructions,
		Questions:    questions,
	}
}

// toAttemptQuestion whitelists the student-safe fields. CorrectAnswer and
// AcceptedVariants on store.Question are DELIBERATELY not read — that is the
// answer-strip (AC10,11). Nil options become a non-nil empty slice so the wire
// carries `[]` not `null` (GO-5).
func toAttemptQuestion(q store.Question) AttemptQuestion {
	options := q.Options
	if options == nil {
		options = []string{}
	}
	return AttemptQuestion{
		Text:    q.Text,
		Type:    q.Type,
		Options: options,
	}
}
