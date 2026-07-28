// Story 4.2 — content-validation + settings round-trip + deep-equals through the
// real handler + middleware + service (TEST-BE-3). These extend the 4.1 handler
// ATDD suite (shared helpers: setupExerciseHandlerTest, createExercise,
// getExercise, classReq, decodeClassEnvelope, populatedContent). The 428/409/200
// precondition, 413 cap, cross-teacher 404, and student 403 paths are already
// pinned in exercise_handler_atdd_test.go and are NOT duplicated here.
package handler_test

import (
	"encoding/json"
	"net/http"
	"testing"
)

func defaultSettings() map[string]any {
	return map[string]any{"timeLimitEnabled": false, "timeLimitMinutes": 0, "caseSensitive": false}
}

func readingSection(groups ...map[string]any) map[string]any {
	return map[string]any{"type": "reading", "title": "S", "content": "c", "questionGroups": groups}
}

// TestExercise_Update_StructurallyInvalidContent_422 drives the STRUCTURAL
// (autosave-gate) validation path through the handler: each body is parseable v1
// JSON but MALFORMED (invalid type, foreign field, garbage settings), so the
// service rejects it with a typed 422 BEFORE the write on every autosave (never
// a persisted garbage row, never a 500). Completeness violations are NOT here —
// they are valid drafts (see TestExercise_Update_IncompleteDraftPersists_200).
func TestExercise_Update_StructurallyInvalidContent_422(t *testing.T) {
	env := setupExerciseHandlerTest(t)

	cases := map[string]map[string]any{
		"writing section carries groups": {
			"sections": []map[string]any{{
				"type": "writing", "title": "W", "content": "prompt",
				"questionGroups": []map[string]any{{
					"type": "short_answer", "instructions": "x",
					"questions": []map[string]any{{"text": "q", "type": "short_answer", "options": []string{}, "correctAnswer": "a", "acceptedVariants": []string{}}},
				}},
			}},
			"settings": defaultSettings(),
		},
		"T/F/NG carries forbidden options": {
			"sections": []map[string]any{readingSection(map[string]any{
				"type": "true_false_not_given", "instructions": "x",
				"questions": []map[string]any{{"text": "q", "type": "true_false_not_given", "options": []string{"yes", "no"}, "correctAnswer": "true", "acceptedVariants": []string{}}},
			})},
			"settings": defaultSettings(),
		},
		"unknown section type": {
			"sections": []map[string]any{{"type": "crossword", "title": "S", "content": "c", "questionGroups": []map[string]any{}}},
			"settings": defaultSettings(),
		},
		"negative time limit in settings": {
			"sections": []map[string]any{},
			"settings": map[string]any{"timeLimitEnabled": true, "timeLimitMinutes": -5, "caseSensitive": false},
		},
	}

	for name, content := range cases {
		t.Run(name, func(t *testing.T) {
			x := createExercise(t, env, env.ownerTok, "T", "reading", nil)
			id, _ := x.Data["id"].(string)
			updatedAt, _ := x.Data["updatedAt"].(string)
			rec := classReq(t, env.srv, http.MethodPatch, "/api/exercises/"+id, env.ownerTok,
				map[string]any{"content": content, "updatedAt": updatedAt})
			if rec.Code != http.StatusUnprocessableEntity {
				t.Fatalf("structurally-invalid content → %d, want 422 (body: %s)", rec.Code, rec.Body.String())
			}
		})
	}
}

// TestExercise_Update_IncompleteDraftPersists_200 proves the Decision-B autosave
// gate: a structurally-valid but INCOMPLETE draft (an empty section, a group
// seeded with blank options/answers, an enabled-but-unfilled timer — the normal
// mid-edit state a freshly-added section/group produces) persists with 200, not
// a false "Save failed". Completeness is deferred to the Epic-5 finalize gate.
func TestExercise_Update_IncompleteDraftPersists_200(t *testing.T) {
	env := setupExerciseHandlerTest(t)

	drafts := map[string]map[string]any{
		"empty reading section (no groups yet)": {
			"sections": []map[string]any{readingSection()},
			"settings": defaultSettings(),
		},
		"freshly-added MCQ group with blank options": {
			"sections": []map[string]any{readingSection(map[string]any{
				"type": "multiple_choice", "instructions": "",
				"questions": []map[string]any{{"text": "", "type": "multiple_choice", "options": []string{"", ""}, "correctAnswer": "", "acceptedVariants": []string{}}},
			})},
			"settings": defaultSettings(),
		},
		"gap-fill group with a blank answer key": {
			"sections": []map[string]any{readingSection(map[string]any{
				"type": "fill_in_blank", "instructions": "",
				"questions": []map[string]any{{"text": "The ______ is here.", "type": "fill_in_blank", "options": []string{}, "correctAnswer": "", "acceptedVariants": []string{}}},
			})},
			"settings": defaultSettings(),
		},
		"time limit enabled but minutes not yet typed": {
			"sections": []map[string]any{},
			"settings": map[string]any{"timeLimitEnabled": true, "timeLimitMinutes": 0, "caseSensitive": false},
		},
	}

	for name, content := range drafts {
		t.Run(name, func(t *testing.T) {
			x := createExercise(t, env, env.ownerTok, "T", "reading", nil)
			id, _ := x.Data["id"].(string)
			updatedAt, _ := x.Data["updatedAt"].(string)
			rec := classReq(t, env.srv, http.MethodPatch, "/api/exercises/"+id, env.ownerTok,
				map[string]any{"content": content, "updatedAt": updatedAt})
			if rec.Code != http.StatusOK {
				t.Fatalf("incomplete draft autosave → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
			}
		})
	}
}

// TestExercise_Update_SettingsRoundTrip confirms the happy path: a fully-valid
// populated blob → 200, and the settings + schemaVersion survive the round-trip.
func TestExercise_Update_SettingsRoundTrip(t *testing.T) {
	env := setupExerciseHandlerTest(t)
	x := createExercise(t, env, env.ownerTok, "T", "reading", nil)
	id, _ := x.Data["id"].(string)
	updatedAt, _ := x.Data["updatedAt"].(string)

	content := populatedContent()
	content["settings"] = map[string]any{"timeLimitEnabled": true, "timeLimitMinutes": 45, "caseSensitive": true}

	rec := classReq(t, env.srv, http.MethodPatch, "/api/exercises/"+id, env.ownerTok,
		map[string]any{"content": content, "updatedAt": updatedAt})
	if rec.Code != http.StatusOK {
		t.Fatalf("settings PATCH → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}

	got := getExercise(t, env, env.ownerTok, id)
	gotContent, _ := got.Data["content"].(map[string]any)
	settings, _ := gotContent["settings"].(map[string]any)
	if enabled, _ := settings["timeLimitEnabled"].(bool); !enabled {
		t.Errorf("timeLimitEnabled = %v, want true", settings["timeLimitEnabled"])
	}
	if mins, _ := settings["timeLimitMinutes"].(float64); mins != 45 {
		t.Errorf("timeLimitMinutes = %v, want 45", settings["timeLimitMinutes"])
	}
	if cs, _ := settings["caseSensitive"].(bool); !cs {
		t.Errorf("caseSensitive = %v, want true", settings["caseSensitive"])
	}
	// schema_version stays server-authoritative through a settings PATCH.
	if sv, _ := got.Data["schemaVersion"].(float64); sv != 1 {
		t.Errorf("schemaVersion = %v, want 1 (never bumped by a content PATCH)", got.Data["schemaVersion"])
	}
}

// TestExercise_Update_ContentDeepEqualsRoundTrip asserts the stored blob is a
// byte-faithful round-trip of what the autosave sent (keys + casing + nesting).
func TestExercise_Update_ContentDeepEqualsRoundTrip(t *testing.T) {
	env := setupExerciseHandlerTest(t)
	x := createExercise(t, env, env.ownerTok, "T", "reading", nil)
	id, _ := x.Data["id"].(string)
	updatedAt, _ := x.Data["updatedAt"].(string)

	sent := populatedContent()
	rec := classReq(t, env.srv, http.MethodPatch, "/api/exercises/"+id, env.ownerTok,
		map[string]any{"content": sent, "updatedAt": updatedAt})
	if rec.Code != http.StatusOK {
		t.Fatalf("content PATCH → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}

	got := getExercise(t, env, env.ownerTok, id)
	// Canonicalize both through json.Marshal (map keys sort; JSON numbers
	// normalize) so a true structural deep-equal survives the map<->float64
	// decode. Any dropped/renamed key fails here.
	sentJSON, _ := json.Marshal(sent)
	gotJSON, _ := json.Marshal(got.Data["content"])
	if string(sentJSON) != string(gotJSON) {
		t.Fatalf("content round-trip drift\n sent: %s\n got:  %s", sentJSON, gotJSON)
	}
}
