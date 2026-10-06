// Package handler — Story 9.4 self-profile endpoints (GFW-1 / GFW-5).
//
// Three routes on a verified-gated, center-OPTIONAL chain (copies the
// onboardingChain shape — extractTenant → requireVerified → ErrorMapper, NO
// requireCenter — so a user in membership limbo still reaches their profile):
//
//	GET  /api/users/me                 → GetMe
//	PUT  /api/users/me                 → UpdateMe (full-snapshot replace, D5)
//	POST /api/users/me/change-password → ChangePassword
//
// Target is resolved from the TenantContext.UserID claim ONLY — there is no
// user-id path/body param, so a caller can only read/update their OWN record
// (AC6). The PUT deliberately ignores any `email` field (AC7 — email is the
// display-only login identity). Responses use the data-only {data} envelope
// (GO-5: avatarUrl null serializes as null); change-password returns 204.
package handler

import (
	"encoding/json"
	"net/http"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
)

const maxUserProfileBodyBytes = 16 * 1024

// UserHandler serves the self-profile endpoints.
type UserHandler struct {
	svc *service.UserService
}

// NewUserHandler wires the self-profile handler.
func NewUserHandler(svc *service.UserService) *UserHandler {
	return &UserHandler{svc: svc}
}

// --- wire DTOs (GO-5: no omitempty; every key always emitted) ---

type notificationSettingsDTO struct {
	SchemaVersion       int  `json:"schemaVersion"`
	EmailOnSubmission   bool `json:"emailOnSubmission"`
	EmailOnQuestion     bool `json:"emailOnQuestion"`
	EmailOnAnnouncement bool `json:"emailOnAnnouncement"`
}

type userProfileResponse struct {
	ID                   string                  `json:"id"`
	Email                string                  `json:"email"`
	FullName             string                  `json:"fullName"`
	AvatarURL            *string                 `json:"avatarUrl"`
	LanguagePref         string                  `json:"languagePref"`
	NotificationSettings notificationSettingsDTO `json:"notificationSettings"`
	EmailVerified        bool                    `json:"emailVerified"`
	IsOauthOnly          bool                    `json:"isOauthOnly"`
}

type updateProfileRequestBody struct {
	FullName string `json:"fullName"`
	// AvatarURL is presence-aware (D5 full-snapshot / D2 review patch): a nil
	// RawMessage means the key was OMITTED (→ 422, a partial PUT must not silently
	// blank the avatar), whereas an explicit `null` is a present-and-intentional
	// clear. A non-null value is unmarshalled into a *string for the service.
	AvatarURL    json.RawMessage          `json:"avatarUrl"`
	LanguagePref string                   `json:"languagePref"`
	Notification *notificationSettingsDTO `json:"notificationSettings"`
	// Email is accepted-but-IGNORED (AC7 — email is display-only; a PUT carrying
	// it must not mutate the login identity). Present so a stray client send does
	// not 400 on an unknown field, and so the negative test can assert it is a
	// no-op rather than a mutation.
	Email *string `json:"email"`
}

type changePasswordRequestBody struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

func profileToResponse(p *service.UserProfile) userProfileResponse {
	return userProfileResponse{
		ID:           p.ID.String(),
		Email:        p.Email,
		FullName:     p.FullName,
		AvatarURL:    p.AvatarURL,
		LanguagePref: p.LanguagePref,
		NotificationSettings: notificationSettingsDTO{
			SchemaVersion:       p.NotificationSettings.SchemaVersion,
			EmailOnSubmission:   p.NotificationSettings.EmailOnSubmission,
			EmailOnQuestion:     p.NotificationSettings.EmailOnQuestion,
			EmailOnAnnouncement: p.NotificationSettings.EmailOnAnnouncement,
		},
		EmailVerified: p.EmailVerified,
		IsOauthOnly:   p.IsOAuthOnly,
	}
}

// GetMe implements GET /api/users/me (AC6 / D1).
func (h *UserHandler) GetMe(w http.ResponseWriter, r *http.Request) error {
	tc, ok := model.TenantFromContext(r.Context())
	if !ok {
		return model.ForbiddenError{Reason: "authentication required"}
	}
	profile, err := h.svc.GetProfile(r.Context(), tc)
	if err != nil {
		return err
	}
	WriteJSON(w, http.StatusOK, profileToResponse(profile))
	return nil
}

// UpdateMe implements PUT /api/users/me (AC6 / D5 — full-snapshot replace).
func (h *UserHandler) UpdateMe(w http.ResponseWriter, r *http.Request) error {
	tc, ok := model.TenantFromContext(r.Context())
	if !ok {
		return model.ForbiddenError{Reason: "authentication required"}
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxUserProfileBodyBytes)
	var body updateProfileRequestBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "body", Message: "invalid JSON"}}}
	}
	// D5 full snapshot — notificationSettings AND avatarUrl must be PRESENT (a
	// missing one would otherwise silently reset/blank the stored value); fullName
	// / languagePref are validated in the service. An explicit `null` avatarUrl is
	// a present, intentional clear (D2 review patch).
	if body.Notification == nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "notificationSettings", Message: "required"}}}
	}
	if body.AvatarURL == nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "avatarUrl", Message: "required"}}}
	}
	var avatarURL *string
	if err := json.Unmarshal(body.AvatarURL, &avatarURL); err != nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "avatarUrl", Message: "must be a string or null"}}}
	}
	profile, err := h.svc.UpdateProfile(r.Context(), tc, service.UpdateProfileInput{
		FullName:     body.FullName,
		AvatarURL:    avatarURL,
		LanguagePref: body.LanguagePref,
		NotificationSettings: service.NotificationSettings{
			SchemaVersion:       body.Notification.SchemaVersion,
			EmailOnSubmission:   body.Notification.EmailOnSubmission,
			EmailOnQuestion:     body.Notification.EmailOnQuestion,
			EmailOnAnnouncement: body.Notification.EmailOnAnnouncement,
		},
	})
	if err != nil {
		return err
	}
	WriteJSON(w, http.StatusOK, profileToResponse(profile))
	return nil
}

// ChangePassword implements POST /api/users/me/change-password (AC4).
func (h *UserHandler) ChangePassword(w http.ResponseWriter, r *http.Request) error {
	tc, ok := model.TenantFromContext(r.Context())
	if !ok {
		return model.ForbiddenError{Reason: "authentication required"}
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxUserProfileBodyBytes)
	var body changePasswordRequestBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "body", Message: "invalid JSON"}}}
	}
	if err := h.svc.ChangePassword(r.Context(), tc, body.CurrentPassword, body.NewPassword); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}
