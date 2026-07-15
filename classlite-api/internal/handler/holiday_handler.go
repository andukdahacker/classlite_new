// Package handler — Story 2.5b HolidayHandler. Same shape as TermHandler.
package handler

import (
	"encoding/json"
	"net/http"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
)

type HolidayHandler struct {
	svc *service.HolidayService
	clk clock.Clock
}

func NewHolidayHandler(svc *service.HolidayService, clk clock.Clock) *HolidayHandler {
	return &HolidayHandler{svc: svc, clk: clk}
}

type holidayResponse struct {
	ID       string `json:"id"`
	CenterID string `json:"centerId"`
	Name     string `json:"name"`
	Date     string `json:"date"`
}

func holidayToResponse(h service.Holiday) holidayResponse {
	return holidayResponse{
		ID:       h.ID.String(),
		CenterID: h.CenterID.String(),
		Name:     h.Name,
		Date:     h.Date.Format("2006-01-02"),
	}
}

func (h *HolidayHandler) List(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	rows, err := h.svc.List(r.Context(), tc)
	if err != nil {
		return err
	}
	out := make([]holidayResponse, len(rows))
	for i, x := range rows {
		out[i] = holidayToResponse(x)
	}
	WriteEnvelope(w, http.StatusOK, h.clk, out)
	return nil
}

func (h *HolidayHandler) Create(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxSettingsBodyBytes)
	var body createHolidayRequestBody
	if err := decodeSettingsJSONBody(r.Body, &body); err != nil {
		return err
	}
	date, err := parseDate(body.Date, "date")
	if err != nil {
		return err
	}
	created, err := h.svc.Create(r.Context(), tc, service.CreateHolidayInput{
		Name: body.Name,
		Date: date,
	})
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusCreated, h.clk, holidayToResponse(*created))
	return nil
}

func (h *HolidayHandler) Update(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	id, err := parseSettingsPathID(r, "id", "HOLIDAY_NOT_FOUND", "holiday")
	if err != nil {
		return err
	}
	// Two-pass decode — reject explicit `null` on non-nullable name + date.
	// Matches RoomHandler.Update / TermHandler.Update tri-state discipline.
	r.Body = http.MaxBytesReader(w, r.Body, maxSettingsBodyBytes)
	var body updateHolidayRequestBody
	if err := decodeSettingsJSONBody(r.Body, &body); err != nil {
		return err
	}

	in := service.UpdateHolidayInput{}
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
	if raw, ok := body["date"]; ok {
		if isJSONNull(raw) {
			fields = append(fields, model.FieldError{Field: "date", Message: "must not be null"})
		} else {
			var v string
			if uerr := json.Unmarshal(raw, &v); uerr != nil {
				fields = append(fields, model.FieldError{Field: "date", Message: "expected string"})
			} else {
				d, derr := parseDate(v, "date")
				if derr != nil {
					return derr
				}
				in.Date = &d
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
	WriteEnvelope(w, http.StatusOK, h.clk, holidayToResponse(*updated))
	return nil
}

func (h *HolidayHandler) Delete(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	id, err := parseSettingsPathID(r, "id", "HOLIDAY_NOT_FOUND", "holiday")
	if err != nil {
		return err
	}
	if err := h.svc.Delete(r.Context(), tc, id); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

type createHolidayRequestBody struct {
	Name string `json:"name"`
	Date string `json:"date"`
}

// updateHolidayRequestBody uses raw JSON so the handler can reject explicit
// null on non-nullable name + date (tri-state via handler-entry). No nullable
// columns exist on holidays.
type updateHolidayRequestBody map[string]json.RawMessage
