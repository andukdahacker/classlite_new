// Story 4.2 — semantic validation for the v1 ExerciseContent (T1 / AC7), split
// into two tiers by the 2026-07-28 code review (Decision B / FU-4-2-B).
//
// STRUCTURAL validation is the AUTOSAVE gate: the service calls
// ValidateExerciseContentStructural on every 1500ms full-replace PATCH, BEFORE
// the write. It rejects only documents that are malformed regardless of how
// finished they are — invalid section/group types, a prompt-only section that
// carries groups, a foreign field on a type that does not use it, an over-cap
// collection (the DoS guard), garbage settings, or a non-triad T/F/NG answer.
// An in-progress DRAFT — an empty section, a half-built option list, a blank
// answer key — is structurally valid and always persists, so autosave never
// 422s the normal seed state of a freshly-added section or group.
//
// COMPLETENESS validation is the FINALIZE/ASSIGN gate (wired in Epic 5 via
// ValidateExerciseContentComplete): structural PLUS every invariant a graded,
// assignable exercise must satisfy — ≥1 group per non-prompt section, ≥1
// question per group, a non-blank answer key, ≥2 MCQ options, a non-empty
// matching bank, a present T/F/NG answer, and a coherent time limit.
//
// Both tiers return a model.ValidationError (GO-2) → a typed 422, never a panic.
//
// NOTE (AC7, deliberate): the valid SECTION-type set is the story's 5-set
// (reading/listening/writing/speaking/grammar). 4.1 also declares a
// SectionTypeVocabulary constant, but the 4.2 editor does not offer it and AC7
// pins the accepted set to five — "declared" is not "enabled". A future story
// that ships a vocabulary section adds it here. All five GROUP types are
// enabled (the editor offers all five question types).
package store

import (
	"fmt"
	"unicode"

	"github.com/ducdo/classlite-api/internal/model"
)

// Per-collection caps (CQ-3 named constants). The structural walk runs on EVERY
// 1500ms autosave PATCH, so an unbounded document is a CPU/JSONB DoS reachable
// by any authenticated teacher (Murat 7/9). MaxContentBytes (4.1) is the coarse
// byte guard mapped to 413 in the service; these bound the shape at a semantic
// level and surface as 422. The numbers are generous for a real exercise while
// keeping the validation walk cheap. Caps are STRUCTURAL — they must hold on
// every autosave, not only at finalize.
const (
	maxSectionsPerExercise = 50
	maxGroupsPerSection    = 50
	maxQuestionsPerGroup   = 200
	// maxOptionsPerQuestion bounds an MCQ option list AND a Matching heading
	// bank (the bank is replicated into each item's Options in v1).
	maxOptionsPerQuestion = 50
	// minMcqOptions — an MCQ with one option is not a choice (completeness).
	minMcqOptions = 2
	// maxAcceptedVariants bounds the accepted-answer list on a gap-fill /
	// short-answer question — the same per-autosave DoS guard as the option cap.
	maxAcceptedVariants = 50
	// maxTimeLimitMinutes is a generous upper bound (24h) on an exercise timer.
	// Settings arrive over the wire from a client (SEC-7: never trusted), so a
	// nonsensical value becomes a typed 422 rather than one the Epic-5 timer eats.
	maxTimeLimitMinutes = 24 * 60
)

// validSectionTypes is the AC7 5-set (see the file-level note on vocabulary).
var validSectionTypes = map[string]bool{
	SectionTypeReading:   true,
	SectionTypeListening: true,
	SectionTypeWriting:   true,
	SectionTypeSpeaking:  true,
	SectionTypeGrammar:   true,
}

// promptOnlySectionTypes carry no question groups (server-enforced, AC2/AC7).
var promptOnlySectionTypes = map[string]bool{
	SectionTypeWriting:  true,
	SectionTypeSpeaking: true,
}

// validGroupTypes is the enabled 5-set of question-group types.
var validGroupTypes = map[string]bool{
	QuestionGroupTypeMultipleChoice:    true,
	QuestionGroupTypeTrueFalseNotGiven: true,
	QuestionGroupTypeFillInBlank:       true,
	QuestionGroupTypeShortAnswer:       true,
	QuestionGroupTypeMatching:          true,
}

// validTfngAnswers is the fixed True/Not-Given/False triad (the CorrectAnswer a
// T/F/NG question may carry).
var validTfngAnswers = map[string]bool{
	"true":     true,
	"false":    true,
	"notGiven": true,
}

// ValidateExerciseContentStructural is the autosave gate (Decision B). It
// returns a model.ValidationError for a MALFORMED document — one that is wrong
// no matter how finished it is — or nil when the document is structurally sound.
// An incomplete draft validates clean here so autosave can persist it; the
// completeness invariants are deferred to ValidateExerciseContentComplete.
func ValidateExerciseContentStructural(c ExerciseContent) error {
	v := walkContent(c)
	if len(v.structural) > 0 {
		return model.ValidationError{Fields: v.structural}
	}
	return nil
}

// ValidateExerciseContentComplete is the finalize/assign gate (wired at the
// Epic-5 finalize surface). It enforces structural AND completeness — every
// invariant a graded, assignable exercise must satisfy. It returns a
// model.ValidationError carrying one FieldError per violation, or nil when the
// document is complete.
func ValidateExerciseContentComplete(c ExerciseContent) error {
	v := walkContent(c)
	fields := make([]model.FieldError, 0, len(v.structural)+len(v.completeness))
	fields = append(fields, v.structural...)
	fields = append(fields, v.completeness...)
	if len(fields) > 0 {
		return model.ValidationError{Fields: fields}
	}
	return nil
}

// walkContent runs the recursive validation once, bucketing every violation
// into the structural or completeness tier. It never panics on any shape — an
// empty Question, a nil slice, or a deeply-nested blob all bucket to a typed
// error at worst.
func walkContent(c ExerciseContent) *contentValidator {
	v := &contentValidator{}
	if len(c.Sections) > maxSectionsPerExercise {
		v.addStructural("sections", "TOO_MANY_SECTIONS",
			fmt.Sprintf("an exercise may hold at most %d sections", maxSectionsPerExercise))
	}
	for si, s := range c.Sections {
		v.validateSection(fmt.Sprintf("sections[%d]", si), s)
	}
	v.validateSettings(c.Settings)
	return v
}

// contentValidator accumulates field errors during the recursive walk, split by
// tier so one walk feeds both the structural and the complete gate.
type contentValidator struct {
	structural   []model.FieldError
	completeness []model.FieldError
}

func (v *contentValidator) addStructural(field, code, message string) {
	v.structural = append(v.structural, model.FieldError{Field: field, Code: code, Message: message})
}

func (v *contentValidator) addCompleteness(field, code, message string) {
	v.completeness = append(v.completeness, model.FieldError{Field: field, Code: code, Message: message})
}

func (v *contentValidator) validateSection(path string, s ExerciseSection) {
	if !validSectionTypes[s.Type] {
		v.addStructural(path+".type", "INVALID_SECTION_TYPE", "unknown section type")
		return // an unknown type has no group rules to reason about
	}
	if promptOnlySectionTypes[s.Type] {
		if len(s.QuestionGroups) > 0 {
			v.addStructural(path+".questionGroups", "SECTION_TYPE_FORBIDS_GROUPS",
				"writing and speaking sections carry no question groups")
		}
		// Completeness (Review P4): a writing/speaking section IS its prompt — an
		// empty prompt is an unassignable draft, but a legal mid-edit state, so
		// this is finalize-only, never an autosave gate.
		if isBlankAnswer(s.Content) {
			v.addCompleteness(path+".content", "SECTION_REQUIRES_PROMPT",
				"a writing or speaking section must have a prompt")
		}
		return
	}
	if len(s.QuestionGroups) < 1 {
		// Completeness (Decision 1 → B): a reading/listening/grammar section must
		// hold ≥1 group to be assignable, but a freshly-added empty section is a
		// valid autosave draft — so this is finalize-only, not an autosave gate.
		v.addCompleteness(path+".questionGroups", "SECTION_REQUIRES_GROUP",
			"a reading, listening, or grammar section must hold at least one question group")
	}
	if len(s.QuestionGroups) > maxGroupsPerSection {
		v.addStructural(path+".questionGroups", "TOO_MANY_GROUPS",
			fmt.Sprintf("a section may hold at most %d question groups", maxGroupsPerSection))
	}
	for gi, g := range s.QuestionGroups {
		v.validateGroup(fmt.Sprintf("%s.questionGroups[%d]", path, gi), g)
	}
}

func (v *contentValidator) validateGroup(path string, g QuestionGroup) {
	if !validGroupTypes[g.Type] {
		v.addStructural(path+".type", "INVALID_GROUP_TYPE", "unknown question group type")
		return
	}
	if len(g.Questions) < 1 {
		// Completeness: a group with no questions is pointless but a legal
		// mid-edit draft state (the editor seeds one question, but a delete can
		// empty it), so it is finalize-only.
		v.addCompleteness(path+".questions", "GROUP_REQUIRES_QUESTION",
			"a question group must hold at least one question")
	}
	if len(g.Questions) > maxQuestionsPerGroup {
		v.addStructural(path+".questions", "TOO_MANY_QUESTIONS",
			fmt.Sprintf("a question group may hold at most %d questions", maxQuestionsPerGroup))
	}
	for qi, q := range g.Questions {
		v.validateQuestion(fmt.Sprintf("%s.questions[%d]", path, qi), g.Type, q)
	}
}

func (v *contentValidator) validateQuestion(path, groupType string, q Question) {
	// Completeness (Review P4): every question needs a stem to be assignable — a
	// blank one (incl. whitespace / zero-width) would ship an empty prompt to the
	// student. A freshly-seeded question has an empty stem (a legal mid-edit
	// state), so this is finalize-only via the completeness bucket, never an
	// autosave gate.
	if isBlankAnswer(q.Text) {
		v.addCompleteness(path+".text", "BLANK_QUESTION_TEXT",
			"a question must have a stem")
	}
	switch groupType {
	case QuestionGroupTypeTrueFalseNotGiven:
		// A PRESENT answer must be a valid triad member — structural garbage
		// like "maybe" is rejected on every autosave. A fresh T/F/NG question
		// seeds "true", so a draft never trips this. Requiring the answer be
		// present (non-blank) is a completeness concern.
		if q.CorrectAnswer != "" && !validTfngAnswers[q.CorrectAnswer] {
			v.addStructural(path+".correctAnswer", "INVALID_TFNG_ANSWER",
				"the correct answer must be one of true, false, notGiven")
		}
		if q.CorrectAnswer == "" {
			v.addCompleteness(path+".correctAnswer", "INVALID_TFNG_ANSWER",
				"the correct answer must be one of true, false, notGiven")
		}
		v.forbidOptions(path, q, "TFNG_FORBIDS_OPTIONS")
		v.forbidVariants(path, q, "TFNG_FORBIDS_VARIANTS")
	case QuestionGroupTypeMultipleChoice:
		v.validateChoiceOptions(path, q, choiceKindMCQ)
		v.forbidVariants(path, q, "CHOICE_FORBIDS_VARIANTS")
	case QuestionGroupTypeMatching:
		v.validateChoiceOptions(path, q, choiceKindMatching)
		v.forbidVariants(path, q, "CHOICE_FORBIDS_VARIANTS")
	case QuestionGroupTypeFillInBlank, QuestionGroupTypeShortAnswer:
		if isBlankAnswer(q.CorrectAnswer) {
			v.addCompleteness(path+".correctAnswer", "BLANK_CORRECT_ANSWER",
				"the correct answer must not be blank")
		}
		v.validateAcceptedVariants(path, q)
		v.forbidOptions(path, q, "TEXT_ANSWER_FORBIDS_OPTIONS")
	}
}

// forbidOptions records a STRUCTURAL error when a question type that does not
// consume an option list carries one (T/F/NG, gap-fill, short-answer). Keeps
// the stored blob shape-faithful to the wire contract on every autosave.
func (v *contentValidator) forbidOptions(path string, q Question, code string) {
	if len(q.Options) > 0 {
		v.addStructural(path+".options", code, "this question type carries no options")
	}
}

// forbidVariants records a STRUCTURAL error when a question type that does not
// consume an accepted-variant list carries one (T/F/NG, MCQ, matching).
func (v *contentValidator) forbidVariants(path string, q Question, code string) {
	if len(q.AcceptedVariants) > 0 {
		v.addStructural(path+".acceptedVariants", code, "this question type carries no accepted variants")
	}
}

// validateAcceptedVariants bounds (structural cap) and blank-checks
// (completeness) the accepted-answer list a gap-fill / short-answer question
// carries. A blank variant is a grading landmine — it would match an empty
// submission in the Epic-5 engine — but it is also a transient mid-typing state,
// so the blank check is finalize-only while the cap holds on every autosave.
func (v *contentValidator) validateAcceptedVariants(path string, q Question) {
	if len(q.AcceptedVariants) > maxAcceptedVariants {
		v.addStructural(path+".acceptedVariants", "TOO_MANY_VARIANTS",
			fmt.Sprintf("at most %d accepted variants are allowed", maxAcceptedVariants))
	}
	for _, variant := range q.AcceptedVariants {
		if isBlankAnswer(variant) {
			v.addCompleteness(path+".acceptedVariants", "BLANK_ACCEPTED_VARIANT",
				"an accepted variant must not be blank")
			break
		}
	}
}

type choiceKind int

const (
	choiceKindMCQ choiceKind = iota
	choiceKindMatching
)

// validateChoiceOptions covers MCQ (an option list) and Matching (a heading
// bank replicated into Options). The CAP is structural (DoS guard on every
// autosave); the non-degenerate-set and CorrectAnswer-drawn-from-it rules are
// COMPLETENESS — a fresh MCQ seeds two blank options and a fresh matching item
// an empty bank, both valid drafts. The error-code prefix differs so the UI can
// route on the right message.
func (v *contentValidator) validateChoiceOptions(path string, q Question, kind choiceKind) {
	if len(q.Options) > maxOptionsPerQuestion {
		v.addStructural(path+".options", "TOO_MANY_OPTIONS",
			fmt.Sprintf("at most %d options are allowed", maxOptionsPerQuestion))
	}

	switch kind {
	case choiceKindMCQ:
		if len(q.Options) < minMcqOptions {
			v.addCompleteness(path+".options", "MCQ_TOO_FEW_OPTIONS",
				fmt.Sprintf("a multiple-choice question needs at least %d options", minMcqOptions))
		}
	case choiceKindMatching:
		if len(q.Options) == 0 {
			v.addCompleteness(path+".options", "MATCHING_EMPTY_BANK",
				"a matching item needs a non-empty heading bank")
		}
	}

	seen := make(map[string]bool, len(q.Options))
	dupFlagged := false
	blankFlagged := false
	for _, opt := range q.Options {
		if !blankFlagged && isBlankAnswer(opt) {
			code := "MCQ_BLANK_OPTION"
			if kind == choiceKindMatching {
				code = "MATCHING_BLANK_HEADING"
			}
			v.addCompleteness(path+".options", code, "an option must not be blank")
			blankFlagged = true
		}
		if seen[opt] && !dupFlagged {
			code := "MCQ_DUPLICATE_OPTIONS"
			if kind == choiceKindMatching {
				code = "MATCHING_DUPLICATE_HEADINGS"
			}
			v.addCompleteness(path+".options", code, "options must be unique")
			dupFlagged = true
		}
		seen[opt] = true
	}

	if len(q.Options) > 0 && !containsString(q.Options, q.CorrectAnswer) {
		code := "MCQ_CORRECT_NOT_IN_OPTIONS"
		if kind == choiceKindMatching {
			code = "MATCHING_CORRECT_NOT_IN_BANK"
		}
		v.addCompleteness(path+".correctAnswer", code, "the correct answer must be one of the options")
	}
}

func containsString(haystack []string, needle string) bool {
	for _, s := range haystack {
		if s == needle {
			return true
		}
	}
	return false
}

// validateSettings guards the exercise-level settings block. A negative or
// absurd time limit is STRUCTURAL garbage rejected on every autosave; an enabled
// timer with zero minutes is a transient mid-edit state (the teacher flipped the
// toggle before typing the value), so it is a COMPLETENESS concern. api.yaml
// declares `minimum: 0` on timeLimitMinutes, but nothing enforced it (no
// request-validation middleware); this is that enforcement.
func (v *contentValidator) validateSettings(s ExerciseSettings) {
	if s.TimeLimitMinutes < 0 {
		v.addStructural("settings.timeLimitMinutes", "NEGATIVE_TIME_LIMIT",
			"the time limit must not be negative")
	}
	if s.TimeLimitMinutes > maxTimeLimitMinutes {
		v.addStructural("settings.timeLimitMinutes", "TIME_LIMIT_TOO_LONG",
			fmt.Sprintf("the time limit must not exceed %d minutes", maxTimeLimitMinutes))
	}
	if s.TimeLimitEnabled && s.TimeLimitMinutes == 0 {
		v.addCompleteness("settings.timeLimitMinutes", "TIME_LIMIT_REQUIRES_MINUTES",
			"an enabled time limit needs a positive minutes value")
	}
}

// isBlankAnswer reports whether s is visually empty. A naive len>0 check is not
// a validity check (Murat): it must reject whitespace-only AND Unicode format /
// zero-width runes that strings.TrimSpace leaves behind.
func isBlankAnswer(s string) bool {
	for _, r := range s {
		if unicode.IsSpace(r) || isFormatRune(r) {
			continue
		}
		return false
	}
	return true
}

// isFormatRune reports whether r is a Unicode format rune (general category Cf).
// That single predicate is the whole zero-width / invisible-formatting family —
// ZWSP U+200B, ZWNJ/ZWJ U+200C/D, BOM/ZWNBSP U+FEFF, WORD JOINER U+2060,
// LRM/RLM U+200E/F, SOFT HYPHEN U+00AD, and the rest — so the blank check can no
// longer silently miss a sibling of a hardcoded four-rune list.
func isFormatRune(r rune) bool {
	return unicode.Is(unicode.Cf, r)
}
