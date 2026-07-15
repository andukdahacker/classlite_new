// Package handler — Story 2.5b TermHandler.
//
// Four routes: GET + POST /api/terms, PATCH + DELETE /api/terms/{id}. All
// four sit behind the shared settingsChain (see cmd/api/main.go). Envelope
// shape + typed error mapping match the shipped SettingsHandler patterns.
package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
)

type TermHandler struct {
	svc *service.TermService
	clk clock.Clock
}

func NewTermHandler(svc *service.TermService, clk clock.Clock) *TermHandler {
	return &TermHandler{svc: svc, clk: clk}
}

// termResponse mirrors api.yaml Term. No omitempty (GO-5).
type termResponse struct {
	ID           string `json:"id"`
	CenterID     string `json:"centerId"`
	Name         string `json:"name"`
	StartDate    string `json:"startDate"`
	EndDate      string `json:"endDate"`
	SessionCount *int32 `json:"sessionCount"`
}

func termToResponse(t service.Term) termResponse {
	return termResponse{
		ID:           t.ID.String(),
		CenterID:     t.CenterID.String(),
		Name:         t.Name,
		StartDate:    t.StartDate.Format("2006-01-02"),
		EndDate:      t.EndDate.Format("2006-01-02"),
		SessionCount: t.SessionCount,
	}
}

func (h *TermHandler) List(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	rows, err := h.svc.List(r.Context(), tc)
	if err != nil {
		return err
	}
	out := make([]termResponse, len(rows))
	for i, t := range rows {
		out[i] = termToResponse(t)
	}
	WriteEnvelope(w, http.StatusOK, h.clk, out)
	return nil
}

func (h *TermHandler) Create(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxSettingsBodyBytes)
	var body createTermRequestBody
	if err := decodeSettingsJSONBody(r.Body, &body); err != nil {
		return err
	}

	start, err := parseDate(body.StartDate, "startDate")
	if err != nil {
		return err
	}
	end, err := parseDate(body.EndDate, "endDate")
	if err != nil {
		return err
	}
	created, err := h.svc.Create(r.Context(), tc, service.CreateTermInput{
		Name:         body.Name,
		StartDate:    start,
		EndDate:      end,
		SessionCount: body.SessionCount,
	})
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusCreated, h.clk, termToResponse(*created))
	return nil
}

func (h *TermHandler) Update(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	id, err := parseSettingsPathID(r, "id", "TERM_NOT_FOUND", "term")
	if err != nil {
		return err
	}

	// Two-pass decode so explicit JSON `null` on non-nullable name/startDate/
	// endDate is rejected as 422 rather than silently no-op'd via *string.
	// Only sessionCount is nullable (session_count column). Matches
	// RoomHandler.Update pattern for tri-state discipline.
	r.Body = http.MaxBytesReader(w, r.Body, maxSettingsBodyBytes)
	var body updateTermRequestBody
	if err := decodeSettingsJSONBody(r.Body, &body); err != nil {
		return err
	}

	in := service.UpdateTermInput{}
	var fields []model.FieldError

	if raw, ok := body["name"]; ok {
		if isJSONNull(raw) {
			fields = append(fields, model.FieldError{Field: "name", Message: "must not be null"})
		} else {
			var v string
			if uerr := json.Unmarshal(raw, &v); uerr != nil {
				fields = append(fields, model.FieldError{Field: "name", Message: "expected string"})
			} else {
				in.Name = &v
			}
		}
	}
	if raw, ok := body["startDate"]; ok {
		if isJSONNull(raw) {
			fields = append(fields, model.FieldError{Field: "startDate", Message: "must not be null"})
		} else {
			var v string
			if uerr := json.Unmarshal(raw, &v); uerr != nil {
				fields = append(fields, model.FieldError{Field: "startDate", Message: "expected string"})
			} else {
				start, perr := parseDate(v, "startDate")
				if perr != nil {
					return perr
				}
				in.StartDate = &start
			}
		}
	}
	if raw, ok := body["endDate"]; ok {
		if isJSONNull(raw) {
			fields = append(fields, model.FieldError{Field: "endDate", Message: "must not be null"})
		} else {
			var v string
			if uerr := json.Unmarshal(raw, &v); uerr != nil {
				fields = append(fields, model.FieldError{Field: "endDate", Message: "expected string"})
			} else {
				end, perr := parseDate(v, "endDate")
				if perr != nil {
					return perr
				}
				in.EndDate = &end
			}
		}
	}
	if raw, ok := body["sessionCount"]; ok {
		if isJSONNull(raw) {
			in.ClearFields = append(in.ClearFields, "session_count")
		} else {
			var v int32
			if uerr := json.Unmarshal(raw, &v); uerr != nil {
				fields = append(fields, model.FieldError{Field: "sessionCount", Message: "expected integer or null"})
			} else {
				in.SessionCount = &v
			}
		}
	}
	if len(fields) > 0 {
		return model.ValidationError{Fields: fields}
	}

	updated, err := h.svc.Update(r.Context(), tc, id, in)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, termToResponse(*updated))
	return nil
}

func (h *TermHandler) Delete(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	id, err := parseSettingsPathID(r, "id", "TERM_NOT_FOUND", "term")
	if err != nil {
		return err
	}
	if err := h.svc.Delete(r.Context(), tc, id); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// createTermRequestBody mirrors api.yaml CreateTermRequest.
type createTermRequestBody struct {
	Name         string  `json:"name"`
	StartDate    string  `json:"startDate"`
	EndDate      string  `json:"endDate"`
	SessionCount *int32  `json:"sessionCount"`
}

// updateTermRequestBody uses raw JSON so the handler can distinguish absent
// vs null on `sessionCount` (tri-state — see TermHandler.Update). name +
// startDate + endDate reject explicit null with 422 at handler entry.
type updateTermRequestBody map[string]json.RawMessage

// -----------------------------------------------------------------------------
// Shared helpers used by term/holiday/room handlers.
// -----------------------------------------------------------------------------

// requireOwnerTenant is the settingsChain contract in code form: ensure the
// middleware seeded a TenantContext with UserID + CenterID. If not, return a
// service.ForbiddenError so the mapper renders 403 INSUFFICIENT_ROLE (guarded
// upstream by RequireRole("owner") — this is defense in depth).
func requireOwnerTenant(r *http.Request) (model.TenantContext, error) {
	tc, ok := model.TenantFromContext(r.Context())
	if !ok || tc.UserID == "" || tc.CenterID == "" {
		return model.TenantContext{}, ErrTenantContextMissing
	}
	return tc, nil
}

// parseSettingsPathID resolves the {id} path parameter as a UUID. On invalid
// UUIDs the caller passes an entity-specific NotFoundError code (e.g.
// "TERM_NOT_FOUND") so the wire discriminator matches the api.yaml contract
// for that endpoint rather than collapsing to a generic "NOT_FOUND".
func parseSettingsPathID(r *http.Request, key, notFoundCode, resource string) (uuid.UUID, error) {
	raw := r.PathValue(key)
	if raw == "" {
		return uuid.UUID{}, model.ValidationError{Fields: []model.FieldError{{Field: key, Message: "path parameter required"}}}
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.UUID{}, model.NotFoundError{Code: notFoundCode, Resource: resource}
	}
	return id, nil
}

// decodeSettingsJSONBody wraps a strict json.Decoder + typed error mapping
// shared by all three taxonomy handlers.
func decodeSettingsJSONBody(r io.Reader, dst any) error {
	dec := json.NewDecoder(r)
	if err := dec.Decode(dst); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			return &service.PayloadTooLargeError{LimitBytes: maxBytesErr.Limit}
		}
		if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
			return model.ValidationError{Fields: []model.FieldError{{Field: "body", Message: "request body is required"}}}
		}
		return model.ValidationError{Fields: []model.FieldError{{Field: "body", Message: "invalid JSON"}}}
	}
	return nil
}

// parseDate accepts an ISO-8601 date (YYYY-MM-DD) and returns a UTC-midnight
// time.Time. Invalid input maps to 422 with a field-level error.
func parseDate(raw, field string) (time.Time, error) {
	t, err := time.Parse("2006-01-02", raw)
	if err != nil {
		return time.Time{}, model.ValidationError{Fields: []model.FieldError{{Field: field, Message: "expected YYYY-MM-DD"}}}
	}
	return t, nil
}
