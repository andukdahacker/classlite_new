// Package handler — Story 3.5 SessionContentHandler.
//
// Twelve content endpoints (notes/materials/exercises × list/create/update/
// delete) on the existing sessionChain (extractTenant →
// requireVerified → requireCenter → ErrorMapper — NOT owner-gated). Role +
// tenant + teacher-scope are enforced in the service (student → 403;
// cross-teacher / cross-tenant session → 404). Bodies decode strictly via the
// shared decodeClassJSONBody; responses use the {data,meta} envelope with
// explicit nulls (GO-5). Content is addable on past AND cancelled sessions —
// there is no time/status gate here.
package handler

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
)

type SessionContentHandler struct {
	svc *service.SessionContentService
	clk clock.Clock
}

func NewSessionContentHandler(svc *service.SessionContentService, clk clock.Clock) *SessionContentHandler {
	return &SessionContentHandler{svc: svc, clk: clk}
}

// --- wire DTOs (GO-5 explicit nulls) ---

type sessionNoteResponse struct {
	ID        string  `json:"id"`
	CenterID  string  `json:"centerId"`
	SessionID string  `json:"sessionId"`
	Body      string  `json:"body"`
	AuthorID  *string `json:"authorId"`
	CreatedAt string  `json:"createdAt"`
	UpdatedAt string  `json:"updatedAt"`
}

type sessionMaterialResponse struct {
	ID        string `json:"id"`
	CenterID  string `json:"centerId"`
	SessionID string `json:"sessionId"`
	Title     string `json:"title"`
	URL       string `json:"url"`
	Kind      string `json:"kind"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type sessionExerciseResponse struct {
	ID           string  `json:"id"`
	CenterID     string  `json:"centerId"`
	SessionID    string  `json:"sessionId"`
	Title        string  `json:"title"`
	Instructions *string `json:"instructions"`
	Link         *string `json:"link"`
	CreatedAt    string  `json:"createdAt"`
	UpdatedAt    string  `json:"updatedAt"`
}

func noteToResponse(n generated.SessionNote) sessionNoteResponse {
	return sessionNoteResponse{
		ID:        uuidPgToString(n.ID),
		CenterID:  uuidPgToString(n.CenterID),
		SessionID: uuidPgToString(n.SessionID),
		Body:      n.Body,
		AuthorID:  uuidPgToPtr(n.AuthorID),
		CreatedAt: tstzToString(n.CreatedAt),
		UpdatedAt: tstzToString(n.UpdatedAt),
	}
}

func materialToResponse(m generated.SessionMaterial) sessionMaterialResponse {
	return sessionMaterialResponse{
		ID:        uuidPgToString(m.ID),
		CenterID:  uuidPgToString(m.CenterID),
		SessionID: uuidPgToString(m.SessionID),
		Title:     m.Title,
		URL:       m.Url,
		Kind:      m.Kind,
		CreatedAt: tstzToString(m.CreatedAt),
		UpdatedAt: tstzToString(m.UpdatedAt),
	}
}

func exerciseToResponse(e generated.SessionExercise) sessionExerciseResponse {
	return sessionExerciseResponse{
		ID:           uuidPgToString(e.ID),
		CenterID:     uuidPgToString(e.CenterID),
		SessionID:    uuidPgToString(e.SessionID),
		Title:        e.Title,
		Instructions: textPgToPtr(e.Instructions),
		Link:         textPgToPtr(e.Link),
		CreatedAt:    tstzToString(e.CreatedAt),
		UpdatedAt:    tstzToString(e.UpdatedAt),
	}
}

// --- request bodies ---

type noteRequestBody struct {
	Body string `json:"body"`
}

type materialRequestBody struct {
	Title string `json:"title"`
	URL   string `json:"url"`
}

type exerciseRequestBody struct {
	Title        string  `json:"title"`
	Instructions *string `json:"instructions"`
	Link         *string `json:"link"`
}

// requiredField validates a trimmed non-empty string, returning a 422 otherwise.
func requiredField(value, field string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", model.ValidationError{Fields: []model.FieldError{{Field: field, Message: field + " is required"}}}
	}
	return trimmed, nil
}

// trimOptional trims an optional string, collapsing an empty result to nil so a
// blank instructions/link is stored as SQL NULL, not an empty string.
func trimOptional(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

// httpURLField validates a required external URL: non-empty after trim AND an
// absolute http/https URL with a host. Rejects javascript:, data:, mailto:,
// relative paths, and other schemes so a stored link cannot become an
// href-injection sink when rendered by the client (AC4 — materials are
// external links).
func httpURLField(value, field string) (string, error) {
	trimmed, err := requiredField(value, field)
	if err != nil {
		return "", err
	}
	if !isHTTPURL(trimmed) {
		return "", urlSchemeError(field)
	}
	return trimmed, nil
}

// optionalHTTPURL validates an optional external URL. A nil/blank value stays
// nil (stored as SQL NULL); a present value must be an http/https URL.
func optionalHTTPURL(value *string, field string) (*string, error) {
	trimmed := trimOptional(value)
	if trimmed == nil {
		return nil, nil
	}
	if !isHTTPURL(*trimmed) {
		return nil, urlSchemeError(field)
	}
	return trimmed, nil
}

// isHTTPURL reports whether raw parses as an absolute http/https URL with a host.
func isHTTPURL(raw string) bool {
	parsed, err := url.Parse(raw)
	if err != nil {
		return false
	}
	scheme := strings.ToLower(parsed.Scheme)
	return (scheme == "http" || scheme == "https") && parsed.Host != ""
}

func urlSchemeError(field string) error {
	return model.ValidationError{Fields: []model.FieldError{{Field: field, Message: field + " must be an http or https URL"}}}
}

func (h *SessionContentHandler) decodeBody(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxSessionBodyBytes)
	return decodeClassJSONBody(r.Body, dst)
}

// --- notes ---

func (h *SessionContentHandler) ListNotes(w http.ResponseWriter, r *http.Request) error {
	tc, sessionID, err := h.tenantAndSession(r)
	if err != nil {
		return err
	}
	rows, err := h.svc.ListSessionNotes(r.Context(), tc, sessionID)
	if err != nil {
		return err
	}
	out := make([]sessionNoteResponse, len(rows))
	for i, n := range rows {
		out[i] = noteToResponse(n)
	}
	WriteEnvelope(w, http.StatusOK, h.clk, out)
	return nil
}

func (h *SessionContentHandler) CreateNote(w http.ResponseWriter, r *http.Request) error {
	tc, sessionID, err := h.tenantAndSession(r)
	if err != nil {
		return err
	}
	var body noteRequestBody
	if err := h.decodeBody(w, r, &body); err != nil {
		return err
	}
	value, err := requiredField(body.Body, "body")
	if err != nil {
		return err
	}
	note, err := h.svc.CreateSessionNote(r.Context(), tc, sessionID, service.NoteInput{Body: value})
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusCreated, h.clk, noteToResponse(note))
	return nil
}

func (h *SessionContentHandler) UpdateNote(w http.ResponseWriter, r *http.Request) error {
	tc, sessionID, err := h.tenantAndSession(r)
	if err != nil {
		return err
	}
	noteID, err := parseSettingsPathID(r, "noteId", "SESSION_NOTE_NOT_FOUND", "session note")
	if err != nil {
		return err
	}
	var body noteRequestBody
	if err := h.decodeBody(w, r, &body); err != nil {
		return err
	}
	value, err := requiredField(body.Body, "body")
	if err != nil {
		return err
	}
	note, err := h.svc.UpdateSessionNote(r.Context(), tc, sessionID, noteID, service.NoteInput{Body: value})
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, noteToResponse(note))
	return nil
}

func (h *SessionContentHandler) DeleteNote(w http.ResponseWriter, r *http.Request) error {
	tc, sessionID, err := h.tenantAndSession(r)
	if err != nil {
		return err
	}
	noteID, err := parseSettingsPathID(r, "noteId", "SESSION_NOTE_NOT_FOUND", "session note")
	if err != nil {
		return err
	}
	if err := h.svc.DeleteSessionNote(r.Context(), tc, sessionID, noteID); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// --- materials ---

func (h *SessionContentHandler) ListMaterials(w http.ResponseWriter, r *http.Request) error {
	tc, sessionID, err := h.tenantAndSession(r)
	if err != nil {
		return err
	}
	rows, err := h.svc.ListSessionMaterials(r.Context(), tc, sessionID)
	if err != nil {
		return err
	}
	out := make([]sessionMaterialResponse, len(rows))
	for i, m := range rows {
		out[i] = materialToResponse(m)
	}
	WriteEnvelope(w, http.StatusOK, h.clk, out)
	return nil
}

func (h *SessionContentHandler) CreateMaterial(w http.ResponseWriter, r *http.Request) error {
	tc, sessionID, err := h.tenantAndSession(r)
	if err != nil {
		return err
	}
	in, err := h.decodeMaterial(w, r)
	if err != nil {
		return err
	}
	material, err := h.svc.CreateSessionMaterial(r.Context(), tc, sessionID, in)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusCreated, h.clk, materialToResponse(material))
	return nil
}

func (h *SessionContentHandler) UpdateMaterial(w http.ResponseWriter, r *http.Request) error {
	tc, sessionID, err := h.tenantAndSession(r)
	if err != nil {
		return err
	}
	materialID, err := parseSettingsPathID(r, "materialId", "SESSION_MATERIAL_NOT_FOUND", "session material")
	if err != nil {
		return err
	}
	in, err := h.decodeMaterial(w, r)
	if err != nil {
		return err
	}
	material, err := h.svc.UpdateSessionMaterial(r.Context(), tc, sessionID, materialID, in)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, materialToResponse(material))
	return nil
}

func (h *SessionContentHandler) DeleteMaterial(w http.ResponseWriter, r *http.Request) error {
	tc, sessionID, err := h.tenantAndSession(r)
	if err != nil {
		return err
	}
	materialID, err := parseSettingsPathID(r, "materialId", "SESSION_MATERIAL_NOT_FOUND", "session material")
	if err != nil {
		return err
	}
	if err := h.svc.DeleteSessionMaterial(r.Context(), tc, sessionID, materialID); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (h *SessionContentHandler) decodeMaterial(w http.ResponseWriter, r *http.Request) (service.MaterialInput, error) {
	var body materialRequestBody
	if err := h.decodeBody(w, r, &body); err != nil {
		return service.MaterialInput{}, err
	}
	title, err := requiredField(body.Title, "title")
	if err != nil {
		return service.MaterialInput{}, err
	}
	materialURL, err := httpURLField(body.URL, "url")
	if err != nil {
		return service.MaterialInput{}, err
	}
	return service.MaterialInput{Title: title, URL: materialURL}, nil
}

// --- exercises ---

func (h *SessionContentHandler) ListExercises(w http.ResponseWriter, r *http.Request) error {
	tc, sessionID, err := h.tenantAndSession(r)
	if err != nil {
		return err
	}
	rows, err := h.svc.ListSessionExercises(r.Context(), tc, sessionID)
	if err != nil {
		return err
	}
	out := make([]sessionExerciseResponse, len(rows))
	for i, e := range rows {
		out[i] = exerciseToResponse(e)
	}
	WriteEnvelope(w, http.StatusOK, h.clk, out)
	return nil
}

func (h *SessionContentHandler) CreateExercise(w http.ResponseWriter, r *http.Request) error {
	tc, sessionID, err := h.tenantAndSession(r)
	if err != nil {
		return err
	}
	in, err := h.decodeExercise(w, r)
	if err != nil {
		return err
	}
	exercise, err := h.svc.CreateSessionExercise(r.Context(), tc, sessionID, in)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusCreated, h.clk, exerciseToResponse(exercise))
	return nil
}

func (h *SessionContentHandler) UpdateExercise(w http.ResponseWriter, r *http.Request) error {
	tc, sessionID, err := h.tenantAndSession(r)
	if err != nil {
		return err
	}
	exerciseID, err := parseSettingsPathID(r, "exerciseId", "SESSION_EXERCISE_NOT_FOUND", "session exercise")
	if err != nil {
		return err
	}
	in, err := h.decodeExercise(w, r)
	if err != nil {
		return err
	}
	exercise, err := h.svc.UpdateSessionExercise(r.Context(), tc, sessionID, exerciseID, in)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, exerciseToResponse(exercise))
	return nil
}

func (h *SessionContentHandler) DeleteExercise(w http.ResponseWriter, r *http.Request) error {
	tc, sessionID, err := h.tenantAndSession(r)
	if err != nil {
		return err
	}
	exerciseID, err := parseSettingsPathID(r, "exerciseId", "SESSION_EXERCISE_NOT_FOUND", "session exercise")
	if err != nil {
		return err
	}
	if err := h.svc.DeleteSessionExercise(r.Context(), tc, sessionID, exerciseID); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (h *SessionContentHandler) decodeExercise(w http.ResponseWriter, r *http.Request) (service.ExerciseInput, error) {
	var body exerciseRequestBody
	if err := h.decodeBody(w, r, &body); err != nil {
		return service.ExerciseInput{}, err
	}
	title, err := requiredField(body.Title, "title")
	if err != nil {
		return service.ExerciseInput{}, err
	}
	link, err := optionalHTTPURL(body.Link, "link")
	if err != nil {
		return service.ExerciseInput{}, err
	}
	return service.ExerciseInput{
		Title:        title,
		Instructions: trimOptional(body.Instructions),
		Link:         link,
	}, nil
}

// --- shared ---

// tenantAndSession resolves the tenant context and the {id} session path param
// common to every content endpoint.
func (h *SessionContentHandler) tenantAndSession(r *http.Request) (model.TenantContext, uuid.UUID, error) {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return model.TenantContext{}, uuid.UUID{}, err
	}
	sessionID, err := parseSettingsPathID(r, "id", "SESSION_NOT_FOUND", "session")
	if err != nil {
		return model.TenantContext{}, uuid.UUID{}, err
	}
	return tc, sessionID, nil
}
