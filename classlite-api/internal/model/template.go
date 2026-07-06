// Package model — Story 2.2 template DTOs.
//
// Naming: Input types map from handler → service; response types are the
// service's return shapes rendered directly into the {data, meta} envelope.
// service.SpawnInput / SpawnResult live in the service package so the
// business logic can carry richer internal state without leaking it into
// the model layer.
package model

// PrimarySkill enumerates the six valid values for
// class_templates.primary_skill (matches DB CHECK constraint in
// migration 20260703120000_create_class_templates.up.sql).
type PrimarySkill = string

const (
	PrimarySkillWriting          PrimarySkill = "writing"
	PrimarySkillSpeaking         PrimarySkill = "speaking"
	PrimarySkillListening        PrimarySkill = "listening"
	PrimarySkillReading          PrimarySkill = "reading"
	PrimarySkillListeningReading PrimarySkill = "listening_reading"
	PrimarySkillAllSkills        PrimarySkill = "all_skills"
)

// IsValidPrimarySkill returns true when s matches one of the six enum values.
// Used by validateCreateTemplateInput before hitting the DB CHECK.
func IsValidPrimarySkill(s string) bool {
	switch s {
	case PrimarySkillWriting, PrimarySkillSpeaking, PrimarySkillListening,
		PrimarySkillReading, PrimarySkillListeningReading, PrimarySkillAllSkills:
		return true
	default:
		return false
	}
}

// TemplateSessionInput is a single session entry in a CreateTemplate request.
// The service assigns SessionOrder = index in the input slice (0-indexed).
type TemplateSessionInput struct {
	Title       string
	Description *string
}

// CreateTemplateInput is the request body decoded by the handler and passed
// verbatim to TemplateService.CreateCustomTemplate.
type CreateTemplateInput struct {
	Name         string
	TargetBand   float64
	PrimarySkill string
	SessionCount int
	Color        *string
	Sessions     []TemplateSessionInput
}

// Template is the wire-format shape returned by both List and Create. Field
// order matches api.yaml's Template + CreateTemplateResult schemas.
type Template struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	TargetBand   float64 `json:"targetBand"`
	PrimarySkill string  `json:"primarySkill"`
	SessionCount int     `json:"sessionCount"`
	Color        *string `json:"color"`
	Scope        string  `json:"scope"` // "system" | "center"
}

// TemplateSession is the wire-format session row returned inside
// CreateTemplateResponse.
type TemplateSession struct {
	ID           string  `json:"id"`
	Title        string  `json:"title"`
	Description  *string `json:"description"`
	SessionOrder int     `json:"sessionOrder"`
}

// ListTemplatesResponse is the {data} payload for GET /api/templates.
type ListTemplatesResponse struct {
	Templates []Template `json:"templates"`
}

// CreateTemplateResponse is the {data} payload for POST /api/templates.
// Includes the freshly-inserted sessions so the wizard can render the plan
// without a second round-trip.
type CreateTemplateResponse struct {
	ID           string            `json:"id"`
	Name         string            `json:"name"`
	TargetBand   float64           `json:"targetBand"`
	PrimarySkill string            `json:"primarySkill"`
	SessionCount int               `json:"sessionCount"`
	Color        *string           `json:"color"`
	Scope        string            `json:"scope"`
	Sessions     []TemplateSession `json:"sessions"`
}
