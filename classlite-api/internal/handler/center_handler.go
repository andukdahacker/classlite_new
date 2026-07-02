// Package handler — Story 2.1 CenterHandler.
//
// One route: POST /api/centers. Sits behind ExtractTenant →
// RequireVerifiedEmail → RateLimit → handler (AC8).
package handler

import (
	"encoding/json"
	"net/http"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
)

// CenterHandler wires CenterService to HTTP.
type CenterHandler struct {
	svc *service.CenterService
	clk clock.Clock
}

// NewCenterHandler constructs a CenterHandler.
func NewCenterHandler(svc *service.CenterService, clk clock.Clock) *CenterHandler {
	return &CenterHandler{svc: svc, clk: clk}
}

type createCenterRequestBody struct {
	Name       string  `json:"name"`
	BrandColor *string `json:"brandColor"`
	LogoUrl    *string `json:"logoUrl"`
}

type createCenterResponseBody struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	ShortCode   string  `json:"shortCode"`
	BrandColor  *string `json:"brandColor"`
	LogoUrl     *string `json:"logoUrl"`
	Timezone    string  `json:"timezone"`
	Role        string  `json:"role"`
	AccessToken string  `json:"accessToken"`
	ExpiresAt   string  `json:"expiresAt"`
}

// Create runs the transactional center creation flow (AC2 + AC6).
func (h *CenterHandler) Create(w http.ResponseWriter, r *http.Request) error {
	userID, err := userIDFromContext(r)
	if err != nil {
		return err
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxOnboardingBodyBytes)
	var body createCenterRequestBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "body", Message: "invalid JSON"}}}
	}

	result, err := h.svc.CreateCenter(r.Context(), userID, service.CreateCenterInput{
		Name:       body.Name,
		BrandColor: body.BrandColor,
		LogoUrl:    body.LogoUrl,
	})
	if err != nil {
		return err
	}

	WriteEnvelope(w, http.StatusCreated, h.clk, createCenterResponseBody{
		ID:          result.ID.String(),
		Name:        result.Name,
		ShortCode:   result.ShortCode,
		BrandColor:  result.BrandColor,
		LogoUrl:     result.LogoUrl,
		Timezone:    result.Timezone,
		Role:        result.Role,
		AccessToken: result.AccessToken,
		ExpiresAt:   result.ExpiresAt.UTC().Format("2006-01-02T15:04:05.000Z07:00"),
	})
	return nil
}
