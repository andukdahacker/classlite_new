// Package handler — Story 2.5b RoomHandler.
// PATCH tri-state PATCH semantics for the nullable `description` column
// (absent = no change, JSON null = clear to NULL, string = set). Name and
// capacity are non-nullable — JSON null rejected with 422 at handler entry.
package handler

import (
	"encoding/json"
	"net/http"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
)

type RoomHandler struct {
	svc *service.RoomService
	clk clock.Clock
}

func NewRoomHandler(svc *service.RoomService, clk clock.Clock) *RoomHandler {
	return &RoomHandler{svc: svc, clk: clk}
}

type roomResponse struct {
	ID          string  `json:"id"`
	CenterID    string  `json:"centerId"`
	Name        string  `json:"name"`
	Description *string `json:"description"`
	Capacity    int32   `json:"capacity"`
}

func roomToResponse(r service.Room) roomResponse {
	return roomResponse{
		ID:          r.ID.String(),
		CenterID:    r.CenterID.String(),
		Name:        r.Name,
		Description: r.Description,
		Capacity:    r.Capacity,
	}
}

func (h *RoomHandler) List(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	rows, err := h.svc.List(r.Context(), tc)
	if err != nil {
		return err
	}
	out := make([]roomResponse, len(rows))
	for i, x := range rows {
		out[i] = roomToResponse(x)
	}
	WriteEnvelope(w, http.StatusOK, h.clk, out)
	return nil
}

func (h *RoomHandler) Create(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxSettingsBodyBytes)
	var body createRoomRequestBody
	if err := decodeSettingsJSONBody(r.Body, &body); err != nil {
		return err
	}
	if body.Capacity == nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "capacity", Message: "required"}}}
	}
	created, err := h.svc.Create(r.Context(), tc, service.CreateRoomInput{
		Name:        body.Name,
		Description: body.Description,
		Capacity:    *body.Capacity,
	})
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusCreated, h.clk, roomToResponse(*created))
	return nil
}

// updateRoomRequestBody uses raw JSON messages so the handler can distinguish
// absent vs null on `description` (tri-state). name + capacity accept only
// present/absent; explicit null is rejected 422.
type updateRoomRequestBody map[string]json.RawMessage

func (h *RoomHandler) Update(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	id, err := parseSettingsPathID(r, "id", "ROOM_NOT_FOUND", "room")
	if err != nil {
		return err
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxSettingsBodyBytes)
	var body updateRoomRequestBody
	if err := decodeSettingsJSONBody(r.Body, &body); err != nil {
		return err
	}

	in := service.UpdateRoomInput{}
	var fields []model.FieldError

	if raw, ok := body["name"]; ok {
		if isJSONNull(raw) {
			fields = append(fields, model.FieldError{Field: "name", Message: "must not be null"})
		} else {
			var v string
			if err := json.Unmarshal(raw, &v); err != nil {
				fields = append(fields, model.FieldError{Field: "name", Message: "expected string"})
			} else {
				in.Name = &v
			}
		}
	}
	if raw, ok := body["description"]; ok {
		if isJSONNull(raw) {
			in.ClearFields = append(in.ClearFields, "description")
		} else {
			var v string
			if err := json.Unmarshal(raw, &v); err != nil {
				fields = append(fields, model.FieldError{Field: "description", Message: "expected string or null"})
			} else {
				in.Description = &v
			}
		}
	}
	if raw, ok := body["capacity"]; ok {
		if isJSONNull(raw) {
			fields = append(fields, model.FieldError{Field: "capacity", Message: "must not be null"})
		} else {
			var v int32
			if err := json.Unmarshal(raw, &v); err != nil {
				fields = append(fields, model.FieldError{Field: "capacity", Message: "expected integer"})
			} else {
				in.Capacity = &v
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
	WriteEnvelope(w, http.StatusOK, h.clk, roomToResponse(*updated))
	return nil
}

func (h *RoomHandler) Delete(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	id, err := parseSettingsPathID(r, "id", "ROOM_NOT_FOUND", "room")
	if err != nil {
		return err
	}
	if err := h.svc.Delete(r.Context(), tc, id); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

type createRoomRequestBody struct {
	Name        string  `json:"name"`
	Description *string `json:"description"`
	Capacity    *int32  `json:"capacity"`
}
