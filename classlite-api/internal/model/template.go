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

// TemplateSessionInput is a single session entry in a CreateTemplate /
// UpdateTemplate request. The service assigns SessionOrder = index in the input
// slice (0-indexed). Duration is optional (Story 3.3) — minutes, 5–600 or nil.
type TemplateSessionInput struct {
	Title       string
	Description *string
	Duration    *int
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

// Template is the wire-format shape returned by List. Field order matches
// api.yaml's Template schema. Story 3.3 adds UsedCount (per-tenant class count).
type Template struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	TargetBand   float64 `json:"targetBand"`
	PrimarySkill string  `json:"primarySkill"`
	SessionCount int     `json:"sessionCount"`
	Color        *string `json:"color"`
	Scope        string  `json:"scope"` // "system" | "center"
	UsedCount    int     `json:"usedCount"`
}

// TemplateSession is the wire-format session row returned inside
// CreateTemplateResponse + TemplateDetail. Story 3.3 adds Duration (minutes).
type TemplateSession struct {
	ID           string  `json:"id"`
	Title        string  `json:"title"`
	Description  *string `json:"description"`
	SessionOrder int     `json:"sessionOrder"`
	Duration     *int    `json:"duration"`
}

// TemplateDetail is the {data} payload for GET/PUT /api/templates/{id}
// (Story 3.3) — the template scalars + usedCount + its ordered session
// blueprint. `scope` is "system" for read-only seeds, "center" for owned.
type TemplateDetail struct {
	ID           string            `json:"id"`
	Name         string            `json:"name"`
	TargetBand   float64           `json:"targetBand"`
	PrimarySkill string            `json:"primarySkill"`
	SessionCount int               `json:"sessionCount"`
	Color        *string           `json:"color"`
	Scope        string            `json:"scope"`
	UsedCount    int               `json:"usedCount"`
	Sessions     []TemplateSession `json:"sessions"`
}

// UpdateTemplateInput is the decoded PUT /api/templates/{id} body. SessionCount
// is DERIVED (len(Sessions)), never a separate input.
type UpdateTemplateInput struct {
	Name         string
	TargetBand   float64
	PrimarySkill string
	Color        *string
	Sessions     []TemplateSessionInput
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
