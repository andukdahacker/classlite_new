// Package handler — Story 2-5a SettingsHandler.
//
// Two routes: GET + PATCH /api/centers/{id}. Both sit behind
// ExtractTenant → RequireVerifiedEmail → RequireCenterContext →
// RequireRole("owner") → settingsRateLimit → handler (see cmd/api/main.go
// for the chain wiring, per story AC7).
//
// The `centers` table has NO RLS (docs/project-context.md §GO-1). The
// tenant check here is the sole gate that prevents Owner A from reading
// or mutating Owner B's row via a crafted path id — do NOT rely on RLS.
package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
)

// SettingsHandler wires SettingsService to HTTP.
type SettingsHandler struct {
	svc *service.SettingsService
	clk clock.Clock
}

// NewSettingsHandler constructs a SettingsHandler.
func NewSettingsHandler(svc *service.SettingsService, clk clock.Clock) *SettingsHandler {
	return &SettingsHandler{svc: svc, clk: clk}
}

// maxSettingsBodyBytes caps every settings endpoint body to 16 KiB —
// mirrors the onboarding cap. Payload shape is bounded (~7 short fields).
const maxSettingsBodyBytes = 16 * 1024

// centerProfileResponse is the wire shape returned by both GET and PATCH.
// Mirrors api.yaml CenterProfile — no omitempty (GO-5).
type centerProfileResponse struct {
	ID                  string  `json:"id"`
	Name                string  `json:"name"`
	ShortCode           string  `json:"shortCode"`
	ContactEmail        *string `json:"contactEmail"`
	BrandColor          *string `json:"brandColor"`
	LogoUrl             *string `json:"logoUrl"`
	Timezone            string  `json:"timezone"`
	GoogleMeetConnected bool    `json:"googleMeetConnected"`
	CreatedAt           string  `json:"createdAt"`
}

// updateCenterProfileRequestBody is the two-pass decode target for PATCH.
// The map lets us distinguish JSON absent (key not in map), JSON null
// (raw value == "null"), and JSON present (raw value is a string literal).
//
// D4 (2026-07-15 code review): wire semantics are:
//   - Key absent     → do not touch the column
//   - Key present, `null` → CLEAR the column to NULL (nullable fields only)
//   - Key present, string → SET the column to that string
//
// Non-nullable fields (name, timezone) reject `null` with a 422 before
// the request reaches the service. Nullable fields (contactEmail,
// brandColor, logoUrl) accept `null` and add themselves to
// UpdateCenterInput.ClearFields for the SQL layer to force to NULL.
//
// Note: shortCode is intentionally NOT declared. The Settings UI renders
// it as read-only per AC3; any client that sends it is silently ignored.
type updateCenterProfileRequestBody map[string]json.RawMessage

// nullableFields enumerates the columns whose wire `null` means "clear to
// NULL" instead of "422 not-nullable". Kept in sync with the SQL query's
// clear_fields array whitelist (queries/centers.sql).
var nullableFields = map[string]string{
	"contactEmail": "contact_email",
	"brandColor":   "brand_color",
	"logoUrl":      "logo_url",
}

var jsonNullBytes = []byte("null")

// Get returns the caller's center profile (AC1 + AC7 GET).
func (h *SettingsHandler) Get(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireSettingsTenant(r)
	if err != nil {
		return err
	}

	profile, err := h.svc.GetCenter(r.Context(), tc)
	if err != nil {
		return err
	}

	WriteEnvelope(w, http.StatusOK, h.clk, centerProfileToResponse(profile))
	return nil
}

// Patch runs the partial-update flow (AC3 save + AC7 PATCH + AC10 audit).
func (h *SettingsHandler) Patch(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireSettingsTenant(r)
	if err != nil {
		return err
	}

	// P14 (2026-07-15 code review): pass `nil` as the ResponseWriter arg
	// so MaxBytesReader does NOT auto-write a 413 header (which would race
	// the handler's error path). We inspect the returned error below and
	// map *http.MaxBytesError to the typed PayloadTooLargeError → 413.
	r.Body = http.MaxBytesReader(nil, r.Body, maxSettingsBodyBytes)
	body, decodeErr := decodeUpdateCenterProfileBody(r.Body)
	if decodeErr != nil {
		return decodeErr
	}

	in, buildErr := buildUpdateCenterInputFromBody(body)
	if buildErr != nil {
		return buildErr
	}

	profile, err := h.svc.UpdateCenter(r.Context(), tc, in)
	if err != nil {
		return err
	}

	WriteEnvelope(w, http.StatusOK, h.clk, centerProfileToResponse(profile))
	return nil
}

// decodeUpdateCenterProfileBody performs the two-pass PATCH decode.
// Returns (body, err) where err is one of:
//   - *service.PayloadTooLargeError — 413 (body exceeded MaxBytesReader cap)
//   - model.ValidationError         — 422 (empty body / malformed JSON)
func decodeUpdateCenterProfileBody(r io.Reader) (updateCenterProfileRequestBody, error) {
	var body updateCenterProfileRequestBody
	if err := json.NewDecoder(r).Decode(&body); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			return nil, &service.PayloadTooLargeError{LimitBytes: maxBytesErr.Limit}
		}
		if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
			return nil, model.ValidationError{Fields: []model.FieldError{{Field: "body", Message: "request body is required"}}}
		}
		return nil, model.ValidationError{Fields: []model.FieldError{{Field: "body", Message: "invalid JSON"}}}
	}
	return body, nil
}

// buildUpdateCenterInputFromBody folds the tri-state (absent / null / value)
// map into a typed service.UpdateCenterInput. Nullable fields (contactEmail,
// brandColor, logoUrl) map JSON `null` into ClearFields; non-nullable fields
// (name, timezone) reject `null` with a 422 up-front.
func buildUpdateCenterInputFromBody(body updateCenterProfileRequestBody) (service.UpdateCenterInput, error) {
	in := service.UpdateCenterInput{}
	var fields []model.FieldError

	nonNullable := []struct {
		key    string
		target **string
	}{
		{"name", &in.Name},
		{"timezone", &in.Timezone},
	}
	for _, spec := range nonNullable {
		raw, ok := body[spec.key]
		if !ok {
			continue
		}
		if isJSONNull(raw) {
			fields = append(fields, model.FieldError{Field: spec.key, Message: "must not be null"})
			continue
		}
		var value string
		if err := json.Unmarshal(raw, &value); err != nil {
			fields = append(fields, model.FieldError{Field: spec.key, Message: "expected string"})
			continue
		}
		*spec.target = &value
	}

	// Nullable columns — JSON null → ClearFields membership.
	nullable := []struct {
		key      string
		sqlName  string
		target   **string
	}{
		{"contactEmail", "contact_email", &in.ContactEmail},
		{"brandColor", "brand_color", &in.BrandColor},
		{"logoUrl", "logo_url", &in.LogoURL},
	}
	for _, spec := range nullable {
		raw, ok := body[spec.key]
		if !ok {
			continue
		}
		if isJSONNull(raw) {
			in.ClearFields = append(in.ClearFields, spec.sqlName)
			continue
		}
		var value string
		if err := json.Unmarshal(raw, &value); err != nil {
			fields = append(fields, model.FieldError{Field: spec.key, Message: "expected string or null"})
			continue
		}
		*spec.target = &value
	}

	if len(fields) > 0 {
		return service.UpdateCenterInput{}, model.ValidationError{Fields: fields}
	}
	return in, nil
}

func isJSONNull(raw json.RawMessage) bool {
	if len(raw) != 4 {
		return false
	}
	return string(raw) == string(jsonNullBytes)
}

// requireSettingsTenant enforces the two invariants shared by GET + PATCH:
//   - a TenantContext exists (middleware wired correctly)
//   - the path `{id}` MUST equal tc.CenterID (Winston-S3 belt-and-suspenders
//     because `centers` is global-no-RLS)
func requireSettingsTenant(r *http.Request) (model.TenantContext, error) {
	tc, ok := model.TenantFromContext(r.Context())
	if !ok || tc.UserID == "" || tc.CenterID == "" {
		return model.TenantContext{}, ErrTenantContextMissing
	}
	pathID := r.PathValue("id")
	if pathID == "" || pathID != tc.CenterID {
		return model.TenantContext{}, &service.TenantMismatchError{
			PathCenterID:    pathID,
			ContextCenterID: tc.CenterID,
		}
	}
	return tc, nil
}

// centerProfileToResponse formats the service-layer CenterProfile as the
// wire shape defined by api.yaml CenterProfile.
func centerProfileToResponse(p *service.CenterProfile) centerProfileResponse {
	return centerProfileResponse{
		ID:                  p.ID.String(),
		Name:                p.Name,
		ShortCode:           p.ShortCode,
		ContactEmail:        p.ContactEmail,
		BrandColor:          p.BrandColor,
		LogoUrl:             p.LogoURL,
		Timezone:            p.Timezone,
		GoogleMeetConnected: p.GoogleMeetConnected,
		CreatedAt:           p.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z07:00"),
	}
}
