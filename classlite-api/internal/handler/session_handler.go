// Package handler — Story 3.4 SessionHandler.
//
// Six endpoints on the sessionChain (= classChain shape: extractTenant →
// requireVerified → requireCenter → ErrorMapper — NOT owner-gated, so teachers
// reach it). Role + teacher-scope are enforced in the service (students → 403;
// cross-teacher → 404). Bodies decode strictly (reuses decodeClassJSONBody).
// Responses use the {data,meta} envelope with explicit nulls (GO-5).
package handler

import (
	"net/http"
	"strings"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

const maxSessionBodyBytes = 16 * 1024

type SessionHandler struct {
	svc *service.SessionService
	clk clock.Clock
}

func NewSessionHandler(svc *service.SessionService, clk clock.Clock) *SessionHandler {
	return &SessionHandler{svc: svc, clk: clk}
}

// sessionResponse is the api.yaml Session wire shape — every field explicit,
// nullables as pointers (GO-5).
type sessionResponse struct {
	ID                string  `json:"id"`
	CenterID          string  `json:"centerId"`
	ClassID           string  `json:"classId"`
	ClassName         string  `json:"className"`
	ClassColor        *string `json:"classColor"`
	Topic             *string `json:"topic"`
	StartsAt          string  `json:"startsAt"`
	EndsAt            string  `json:"endsAt"`
	Status            string  `json:"status"`
	CancelledAt       *string `json:"cancelledAt"`
	RecurrenceGroupID *string `json:"recurrenceGroupId"`
	RecurrencePattern *string `json:"recurrencePattern"`
	RecurrenceTz      string  `json:"recurrenceTz"`
	CreatedAt         string  `json:"createdAt"`
	UpdatedAt         string  `json:"updatedAt"`
}

type sessionSeriesResponse struct {
	GroupID   *string `json:"groupId"`
	Total     int64   `json:"total"`
	Upcoming  int64   `json:"upcoming"`
	Completed int64   `json:"completed"`
}

type sessionDetailResponse struct {
	Session sessionResponse       `json:"session"`
	Series  sessionSeriesResponse `json:"series"`
}

type createSessionResultResponse struct {
	RecurrenceGroupID *string         `json:"recurrenceGroupId"`
	Count             int             `json:"count"`
	First             sessionResponse `json:"first"`
}

// buildSessionResponse assembles the wire DTO from the shared session columns
// (the three row types carry identical fields).
func buildSessionResponse(
	id, centerID, classID pgtype.UUID, topic pgtype.Text,
	startsAt, endsAt pgtype.Timestamptz, status string, cancelledAt pgtype.Timestamptz,
	groupID pgtype.UUID, pattern pgtype.Text, tz string,
	createdAt, updatedAt pgtype.Timestamptz, className string, classColor pgtype.Text,
) sessionResponse {
	return sessionResponse{
		ID:                uuidPgToString(id),
		CenterID:          uuidPgToString(centerID),
		ClassID:           uuidPgToString(classID),
		ClassName:         className,
		ClassColor:        textPgToPtr(classColor),
		Topic:             textPgToPtr(topic),
		StartsAt:          tstzToString(startsAt),
		EndsAt:            tstzToString(endsAt),
		Status:            status,
		CancelledAt:       tstzPgToPtr(cancelledAt),
		RecurrenceGroupID: uuidPgToPtr(groupID),
		RecurrencePattern: textPgToPtr(pattern),
		RecurrenceTz:      tz,
		CreatedAt:         tstzToString(createdAt),
		UpdatedAt:         tstzToString(updatedAt),
	}
}

func rangeRowToResponse(r generated.ListSessionsByRangeRow) sessionResponse {
	return buildSessionResponse(r.ID, r.CenterID, r.ClassID, r.Topic, r.StartsAt, r.EndsAt,
		r.Status, r.CancelledAt, r.RecurrenceGroupID, r.RecurrencePattern, r.RecurrenceTz,
		r.CreatedAt, r.UpdatedAt, r.ClassName, r.ClassColor)
}

func classRowToResponse(r generated.ListSessionsByClassRow) sessionResponse {
	return buildSessionResponse(r.ID, r.CenterID, r.ClassID, r.Topic, r.StartsAt, r.EndsAt,
		r.Status, r.CancelledAt, r.RecurrenceGroupID, r.RecurrencePattern, r.RecurrenceTz,
		r.CreatedAt, r.UpdatedAt, r.ClassName, r.ClassColor)
}

func detailRowToResponse(r generated.GetSessionByIDRow) sessionResponse {
	return buildSessionResponse(r.ID, r.CenterID, r.ClassID, r.Topic, r.StartsAt, r.EndsAt,
		r.Status, r.CancelledAt, r.RecurrenceGroupID, r.RecurrencePattern, r.RecurrenceTz,
		r.CreatedAt, r.UpdatedAt, r.ClassName, r.ClassColor)
}

func seriesToResponse(c service.SeriesCounts) sessionSeriesResponse {
	var groupID *string
	if c.GroupID != nil {
		s := c.GroupID.String()
		groupID = &s
	}
	return sessionSeriesResponse{GroupID: groupID, Total: c.Total, Upcoming: c.Upcoming, Completed: c.Completed}
}

// List — GET /api/sessions?from&to&classId (story 3.4 AC2/AC7).
func (h *SessionHandler) List(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	from, err := parseScheduleDate(r.URL.Query().Get("from"), "from")
	if err != nil {
		return err
	}
	to, err := parseScheduleDate(r.URL.Query().Get("to"), "to")
	if err != nil {
		return err
	}
	classID, err := parseOptionalUUID(queryPtr(r, "classId"), "classId")
	if err != nil {
		return err
	}
	rows, err := h.svc.ListSessions(r.Context(), tc, from, to, classID)
	if err != nil {
		return err
	}
	out := make([]sessionResponse, len(rows))
	for i, x := range rows {
		out[i] = rangeRowToResponse(x)
	}
	WriteEnvelope(w, http.StatusOK, h.clk, out)
	return nil
}

// Create — POST /api/sessions (story 3.4 AC2/AC3).
func (h *SessionHandler) Create(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxSessionBodyBytes)
	var body createSessionRequestBody
	if err := decodeClassJSONBody(r.Body, &body); err != nil {
		return err
	}
	in, verr := body.toCreateInput()
	if verr != nil {
		return verr
	}
	result, err := h.svc.CreateSessions(r.Context(), tc, in)
	if err != nil {
		return err
	}
	var groupID *string
	if result.RecurrenceGroupID != nil {
		s := result.RecurrenceGroupID.String()
		groupID = &s
	}
	WriteEnvelope(w, http.StatusCreated, h.clk, createSessionResultResponse{
		RecurrenceGroupID: groupID,
		Count:             result.Count,
		First:             detailRowToResponse(result.First),
	})
	return nil
}

// Get — GET /api/sessions/{id} (story 3.4 AC2).
func (h *SessionHandler) Get(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	id, err := parseSettingsPathID(r, "id", "SESSION_NOT_FOUND", "session")
	if err != nil {
		return err
	}
	row, counts, err := h.svc.GetSession(r.Context(), tc, id)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, sessionDetailResponse{
		Session: detailRowToResponse(row),
		Series:  seriesToResponse(counts),
	})
	return nil
}

// Update — PATCH /api/sessions/{id} (story 3.4 AC2/AC4).
func (h *SessionHandler) Update(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	id, err := parseSettingsPathID(r, "id", "SESSION_NOT_FOUND", "session")
	if err != nil {
		return err
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxSessionBodyBytes)
	var body updateSessionRequestBody
	if err := decodeClassJSONBody(r.Body, &body); err != nil {
		return err
	}
	in, verr := body.toUpdateInput()
	if verr != nil {
		return verr
	}
	updated, err := h.svc.UpdateSessions(r.Context(), tc, id, in)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, detailRowToResponse(updated))
	return nil
}

// Cancel — POST /api/sessions/{id}/cancel (story 3.4 AC2/AC4).
func (h *SessionHandler) Cancel(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	id, err := parseSettingsPathID(r, "id", "SESSION_NOT_FOUND", "session")
	if err != nil {
		return err
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxSessionBodyBytes)
	var body cancelSessionRequestBody
	if err := decodeClassJSONBody(r.Body, &body); err != nil {
		return err
	}
	in, verr := body.toCancelInput()
	if verr != nil {
		return verr
	}
	updated, err := h.svc.CancelSessions(r.Context(), tc, id, in)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, detailRowToResponse(updated))
	return nil
}

// Delete — DELETE /api/sessions/{id}?scope&expectedUpdatedAt (story 3.4 AC2/AC4).
func (h *SessionHandler) Delete(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	id, err := parseSettingsPathID(r, "id", "SESSION_NOT_FOUND", "session")
	if err != nil {
		return err
	}
	scope := r.URL.Query().Get("scope")
	// expectedUpdatedAt is required on DELETE (AC2; CR-3-4 P10), but the
	// required-check is enforced in the service AFTER role/teacher-scope so an
	// unauthorized or cross-teacher caller still gets 403/404, not 422. Here we
	// only parse it when present.
	var expected *time.Time
	if raw := r.URL.Query().Get("expectedUpdatedAt"); raw != "" {
		// A '+' timezone offset in an unencoded query value decodes to a space;
		// an RFC3339 datetime never contains a space, so this restores the '+'.
		raw = strings.ReplaceAll(raw, " ", "+")
		t, perr := time.Parse(time.RFC3339, raw)
		if perr != nil {
			return model.ValidationError{Fields: []model.FieldError{{Field: "expectedUpdatedAt", Message: "expected RFC3339 timestamp"}}}
		}
		expected = &t
	}
	if err := h.svc.DeleteSessions(r.Context(), tc, id, scope, expected); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// --- request bodies ---

type recurrenceRequestBody struct {
	Pattern  string  `json:"pattern"`
	Weekdays []int   `json:"weekdays"`
	EndDate  *string `json:"endDate"`
}

type createSessionRequestBody struct {
	ClassID         string                `json:"classId"`
	Topic           *string               `json:"topic"`
	StartsAt        string                `json:"startsAt"`
	DurationMinutes int32                 `json:"durationMinutes"`
	Recurrence      recurrenceRequestBody `json:"recurrence"`
}

func (b createSessionRequestBody) toCreateInput() (service.CreateSessionInput, error) {
	classID, err := uuid.Parse(b.ClassID)
	if err != nil {
		return service.CreateSessionInput{}, model.ValidationError{Fields: []model.FieldError{{Field: "classId", Message: "expected a UUID"}}}
	}
	startsAt, err := time.Parse(time.RFC3339, b.StartsAt)
	if err != nil {
		return service.CreateSessionInput{}, model.ValidationError{Fields: []model.FieldError{{Field: "startsAt", Message: "expected an RFC3339 date-time"}}}
	}
	endDate, err := parseOptionalDate(b.Recurrence.EndDate, "recurrence.endDate")
	if err != nil {
		return service.CreateSessionInput{}, err
	}
	return service.CreateSessionInput{
		ClassID:         classID,
		Topic:           b.Topic,
		StartsAt:        startsAt,
		DurationMinutes: b.DurationMinutes,
		Recurrence: service.RecurrenceInput{
			Pattern:  b.Recurrence.Pattern,
			Weekdays: b.Recurrence.Weekdays,
			EndDate:  endDate,
		},
	}, nil
}

type updateSessionRequestBody struct {
	Topic             *string `json:"topic"`
	StartsAt          *string `json:"startsAt"`
	DurationMinutes   *int32  `json:"durationMinutes"`
	ClassID           *string `json:"classId"`
	ApplyScope        string  `json:"applyScope"`
	ExpectedUpdatedAt string  `json:"expectedUpdatedAt"`
}

func (b updateSessionRequestBody) toUpdateInput() (service.UpdateSessionInput, error) {
	classID, err := parseOptionalUUID(b.ClassID, "classId")
	if err != nil {
		return service.UpdateSessionInput{}, err
	}
	var startsAt *time.Time
	if b.StartsAt != nil {
		t, perr := time.Parse(time.RFC3339, *b.StartsAt)
		if perr != nil {
			return service.UpdateSessionInput{}, model.ValidationError{Fields: []model.FieldError{{Field: "startsAt", Message: "expected an RFC3339 date-time"}}}
		}
		startsAt = &t
	}
	expected, err := time.Parse(time.RFC3339, b.ExpectedUpdatedAt)
	if err != nil {
		return service.UpdateSessionInput{}, model.ValidationError{Fields: []model.FieldError{{Field: "expectedUpdatedAt", Message: "expected an RFC3339 date-time"}}}
	}
	return service.UpdateSessionInput{
		Topic:             b.Topic,
		StartsAt:          startsAt,
		DurationMinutes:   b.DurationMinutes,
		ClassID:           classID,
		ApplyScope:        b.ApplyScope,
		ExpectedUpdatedAt: expected,
	}, nil
}

type cancelSessionRequestBody struct {
	ApplyScope        string `json:"applyScope"`
	ExpectedUpdatedAt string `json:"expectedUpdatedAt"`
}

func (b cancelSessionRequestBody) toCancelInput() (service.CancelSessionInput, error) {
	expected, err := time.Parse(time.RFC3339, b.ExpectedUpdatedAt)
	if err != nil {
		return service.CancelSessionInput{}, model.ValidationError{Fields: []model.FieldError{{Field: "expectedUpdatedAt", Message: "expected an RFC3339 date-time"}}}
	}
	return service.CancelSessionInput{ApplyScope: b.ApplyScope, ExpectedUpdatedAt: expected}, nil
}

// --- helpers ---

// parseScheduleDate parses a YYYY-MM-DD list bound as midnight in the app zone
// so the half-open [from, to) window lands on local calendar days, not UTC ones
// (AC2; CR-3-4 P5).
func parseScheduleDate(raw, field string) (time.Time, error) {
	t, err := time.ParseInLocation("2006-01-02", raw, service.ScheduleLocation())
	if err != nil {
		return time.Time{}, model.ValidationError{Fields: []model.FieldError{{Field: field, Message: "expected YYYY-MM-DD"}}}
	}
	return t, nil
}

// queryPtr returns a pointer to the query value, or nil when absent/empty.
func queryPtr(r *http.Request, key string) *string {
	v := r.URL.Query().Get(key)
	if v == "" {
		return nil
	}
	return &v
}

// tstzToString serializes a timestamp at RFC3339Nano — full sub-second
// precision. RFC3339 (whole seconds) would truncate updatedAt, and the
// optimistic-concurrency guard compares the echoed value with exact equality
// against the microsecond-precision DB row, so a lossy encoding makes every
// PATCH/cancel/DELETE 409 (CR-3-4 P1).
func tstzToString(t pgtype.Timestamptz) string {
	if !t.Valid {
		return ""
	}
	return t.Time.Format(time.RFC3339Nano)
}

func tstzPgToPtr(t pgtype.Timestamptz) *string {
	if !t.Valid {
		return nil
	}
	s := t.Time.Format(time.RFC3339Nano)
	return &s
}
