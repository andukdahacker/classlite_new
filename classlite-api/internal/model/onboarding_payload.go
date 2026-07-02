package model

import (
	"encoding/json"
	"fmt"
)

// OnboardingPayloadSchemaVersion is the current schema version for
// onboarding_progress.payload. Bump when the payload shape changes and add
// a Migrate branch to upgrade prior versions.
const OnboardingPayloadSchemaVersion = 1

// OnboardingPayload is the typed JSONB shape written to
// onboarding_progress.payload. GO-7 forbids map[string]interface{} for
// JSONB — everything is a typed struct with an explicit schemaVersion so we
// have a forward-compat migration seam.
type OnboardingPayload struct {
	SchemaVersion int              `json:"schemaVersion"`
	PersonaChoice *string          `json:"personaChoice"`
	CenterDraft   *CenterDraft     `json:"centerDraft"`
	TemplateDraft *json.RawMessage `json:"templateDraft"`
}

// CenterDraft carries the in-progress center form values before the caller
// commits via POST /api/centers.
type CenterDraft struct {
	Name       string  `json:"name"`
	BrandColor *string `json:"brandColor"`
	LogoURL    *string `json:"logoUrl"`
}

// NewOnboardingPayload returns a zero-valued payload stamped with the
// current schema version. Callers should prefer this over building a
// zero literal so SchemaVersion is always populated.
func NewOnboardingPayload() OnboardingPayload {
	return OnboardingPayload{SchemaVersion: OnboardingPayloadSchemaVersion}
}

// MigrateOnboardingPayload decodes a raw JSONB blob and upgrades it to the
// current schema version. v1 is the only version today — the function is a
// forward-compat seam per GO-7.
func MigrateOnboardingPayload(raw json.RawMessage) (OnboardingPayload, error) {
	var probe struct {
		SchemaVersion int `json:"schemaVersion"`
	}
	if len(raw) == 0 {
		return NewOnboardingPayload(), nil
	}
	if err := json.Unmarshal(raw, &probe); err != nil {
		return OnboardingPayload{}, fmt.Errorf("decode onboarding payload schema probe: %w", err)
	}

	switch probe.SchemaVersion {
	case OnboardingPayloadSchemaVersion:
		var p OnboardingPayload
		if err := json.Unmarshal(raw, &p); err != nil {
			return OnboardingPayload{}, fmt.Errorf("decode onboarding payload v%d: %w", probe.SchemaVersion, err)
		}
		return p, nil
	default:
		return OnboardingPayload{}, fmt.Errorf("unsupported onboarding payload schema version %d", probe.SchemaVersion)
	}
}
