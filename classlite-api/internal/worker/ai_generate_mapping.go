// Story 4.3a — mapping from the typed Gemini response (model.AI*Response) into
// the v1 store.ExerciseContent fragment, plus the per-mode prompt builders. The
// result is always a full ExerciseContent so the 4.2 structural validator can
// run over it; Story 4.3b extracts the mode-relevant slice at preview/insert.
package worker

import (
	"fmt"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
)

// defaultCarrierSectionType is the section type used to wrap generated question
// groups / distractors so the structural validator (which walks whole sections)
// has a valid, non-prompt-only host to reason about.
const defaultCarrierSectionType = store.SectionTypeReading

// mapSectionResponse builds a one-section fragment from a section generation.
func mapSectionResponse(r model.AISectionResponse) store.ExerciseContent {
	sectionType := r.SectionType
	if sectionType == "" {
		sectionType = defaultCarrierSectionType
	}
	return store.ExerciseContent{
		SchemaVersion: store.CurrentExerciseSchemaVersion,
		Sections: []store.ExerciseSection{{
			Type:           sectionType,
			Title:          r.Title,
			Content:        r.Passage,
			QuestionGroups: mapGroups(r.QuestionGroups),
		}},
		Settings: store.ExerciseSettings{},
	}
}

// mapQuestionsResponse wraps generated groups in a carrier reading section.
func mapQuestionsResponse(r model.AIQuestionsResponse) store.ExerciseContent {
	return store.ExerciseContent{
		SchemaVersion: store.CurrentExerciseSchemaVersion,
		Sections: []store.ExerciseSection{{
			Type:           defaultCarrierSectionType,
			Title:          "Generated questions",
			QuestionGroups: mapGroups(r.QuestionGroups),
		}},
		Settings: store.ExerciseSettings{},
	}
}

// mapDistractorsResponse wraps the generated MCQ option list as a single MCQ
// question inside a carrier section, so 4.3b can lift the options onto the
// target question and the validator can vet the option set.
func mapDistractorsResponse(r model.AIDistractorsResponse) store.ExerciseContent {
	return store.ExerciseContent{
		SchemaVersion: store.CurrentExerciseSchemaVersion,
		Sections: []store.ExerciseSection{{
			Type:  defaultCarrierSectionType,
			Title: "Generated distractors",
			QuestionGroups: []store.QuestionGroup{{
				Type: store.QuestionGroupTypeMultipleChoice,
				Questions: []store.Question{{
					Type:          store.QuestionGroupTypeMultipleChoice,
					Options:       r.Options,
					CorrectAnswer: r.CorrectAnswer,
				}},
			}},
		}},
		Settings: store.ExerciseSettings{},
	}
}

func mapGroups(in []model.AIQuestionGroup) []store.QuestionGroup {
	groups := make([]store.QuestionGroup, 0, len(in))
	for _, g := range in {
		groups = append(groups, store.QuestionGroup{
			Type:         g.Type,
			Instructions: g.Instructions,
			Questions:    mapQuestions(g.Questions),
		})
	}
	return groups
}

func mapQuestions(in []model.AIQuestion) []store.Question {
	questions := make([]store.Question, 0, len(in))
	for _, q := range in {
		questions = append(questions, store.Question{
			Text:             q.Text,
			Type:             q.Type,
			Options:          q.Options,
			CorrectAnswer:    q.CorrectAnswer,
			AcceptedVariants: q.AcceptedVariants,
		})
	}
	return questions
}

// --- prompt builders ---
// The prompt embeds the free-text topic/count. It is NEVER logged (R49). The
// generationConfig pins responseMimeType=application/json so the model returns
// the model.AI*Response shape directly.

func buildSectionPrompt(topic string) string {
	return fmt.Sprintf(
		"Generate an IELTS-style reading section as JSON matching this shape: "+
			"{schemaVersion:1, sectionType, title, passage, questionGroups:[{type, instructions, "+
			"questions:[{text, type, options, correctAnswer, acceptedVariants}]}]}. Topic: %q. "+
			"Use only these group types: multiple_choice, true_false_not_given, fill_in_blank, "+
			"short_answer, matching.", topic)
}

func buildQuestionsPrompt(count int) string {
	if count <= 0 {
		count = 3
	}
	return fmt.Sprintf(
		"Generate %d IELTS-style question groups as JSON matching: "+
			"{schemaVersion:1, questionGroups:[{type, instructions, questions:[{text, type, "+
			"options, correctAnswer, acceptedVariants}]}]}. Use only these group types: "+
			"multiple_choice, true_false_not_given, fill_in_blank, short_answer, matching.", count)
}

func buildDistractorsPrompt(count int) string {
	if count <= 0 {
		count = 3
	}
	return fmt.Sprintf(
		"Generate %d plausible but incorrect distractor options for a multiple-choice question, "+
			"as JSON matching: {schemaVersion:1, correctAnswer, options:[...]} where options includes "+
			"the correct answer plus the distractors.", count)
}
