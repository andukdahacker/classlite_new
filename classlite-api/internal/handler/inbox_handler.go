// Package handler — Story 10.1a InboxHandler.
//
// The role-safe inbox read API:
//
//	GET  /api/inbox                 the caller's own active-queue rows (paginated)
//	GET  /api/inbox/count           the caller's unread count (badge polling)
//	POST /api/inbox/{id}/read       mark one own row read (idempotent)
//	POST /api/inbox/{id}/archive    archive one own row
//
// ALL roles reach these handlers — there is NO role gate (every role has an
// inbox, DD5). Role-scoping is a WRITE-time invariant baked by the subscriber
// (DD3): the read is simply "give me MY rows". A row owned by another user (same
// or other tenant) → 404 NOT_FOUND (non-disclosure, never 403). Responses use the
// {data,meta} envelope with explicit nulls (GO-5).
package handler

import (
	"encoding/json"
	"net/http"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
)

// notificationNotFoundCode mirrors the service's NOTIFICATION_NOT_FOUND typed
// error (404 non-disclosure for a non-owned / absent row).
const notificationNotFoundCode = "NOTIFICATION_NOT_FOUND"

type InboxHandler struct {
	svc *service.NotificationService
	clk clock.Clock
}

func NewInboxHandler(svc *service.NotificationService, clk clock.Clock) *InboxHandler {
	return &InboxHandler{svc: svc, clk: clk}
}

// notificationResponse is one inbox row on the wire. metadata is the DD1b typed
// per-type object passed through verbatim. readAt/archivedAt are nullable (GO-5
// explicit null). createdAt is an ISO string (TS-6).
type notificationResponse struct {
	ID         string          `json:"id"`
	Type       string          `json:"type"`
	Title      string          `json:"title"`
	Body       string          `json:"body"`
	Link       string          `json:"link"`
	Metadata   json.RawMessage `json:"metadata"`
	ReadAt     *string         `json:"readAt"`
	ArchivedAt *string         `json:"archivedAt"`
	CreatedAt  string          `json:"createdAt"`
}

func (h *InboxHandler) toResponse(it service.InboxItem) notificationResponse {
	metadata := it.Metadata
	if len(metadata) == 0 {
		metadata = json.RawMessage(`{}`)
	}
	return notificationResponse{
		ID:         it.ID.String(),
		Type:       it.Type,
		Title:      it.Title,
		Body:       it.Body,
		Link:       it.Link,
		Metadata:   metadata,
		ReadAt:     wireTimePtr(it.ReadAt),
		ArchivedAt: wireTimePtr(it.ArchivedAt),
		CreatedAt:  wireTime(it.CreatedAt),
	}
}

// List — GET /api/inbox (AC3). Caller's own active rows, paginated; optional
// ?type=…&unread_only=true.
func (h *InboxHandler) List(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireQuestionTenant(r)
	if err != nil {
		return err
	}
	page, pageSize := parseSnakePageParams(r)
	filter := service.InboxFilter{Type: r.URL.Query().Get("type")}
	if u := r.URL.Query().Get("unread_only"); u != "" {
		switch u {
		case "true":
			filter.UnreadOnly = true
		case "false":
			filter.UnreadOnly = false
		default:
			return model.ValidationError{Fields: []model.FieldError{{Field: "unread_only", Message: "must be true or false"}}}
		}
	}
	items, pageMeta, err := h.svc.ListInbox(r.Context(), tc, filter, page, pageSize)
	if err != nil {
		return err
	}
	out := make([]notificationResponse, len(items))
	for i, it := range items {
		out[i] = h.toResponse(it)
	}
	writePaginatedEnvelope(w, h.clk, out, pageMeta)
	return nil
}

// Count — GET /api/inbox/count (AC4). Lightweight unread badge count.
func (h *InboxHandler) Count(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireQuestionTenant(r)
	if err != nil {
		return err
	}
	unread, err := h.svc.CountUnread(r.Context(), tc)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, map[string]int{"unread": unread})
	return nil
}

// MarkRead — POST /api/inbox/{id}/read (AC5). Idempotent (a 2nd read → 200 no-op);
// a non-owned id → 404 NOT_FOUND.
func (h *InboxHandler) MarkRead(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireQuestionTenant(r)
	if err != nil {
		return err
	}
	id, err := parseSettingsPathID(r, "id", notificationNotFoundCode, "notification")
	if err != nil {
		return err
	}
	if err := h.svc.MarkRead(r.Context(), tc, id); err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, map[string]string{"id": id.String(), "status": "read"})
	return nil
}

// Archive — POST /api/inbox/{id}/archive (AC5). Removes the row from the active
// queue + unread count; a non-owned id → 404 NOT_FOUND.
func (h *InboxHandler) Archive(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireQuestionTenant(r)
	if err != nil {
		return err
	}
	id, err := parseSettingsPathID(r, "id", notificationNotFoundCode, "notification")
	if err != nil {
		return err
	}
	if err := h.svc.Archive(r.Context(), tc, id); err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, map[string]string{"id": id.String(), "status": "archived"})
	return nil
}

// MarkAllRead — POST /api/inbox/read-all (10.1b AC6). Stamps every active (unread,
// non-archived) row for the caller read in one atomic tx. Caller-scoped via the
// existing MarkAllReadForUser query (10-1a BH7: retains `AND archived_at IS NULL`);
// returns the net-new {data:{status}} ack (no id — this verb has no single row).
func (h *InboxHandler) MarkAllRead(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireQuestionTenant(r)
	if err != nil {
		return err
	}
	if err := h.svc.MarkAllRead(r.Context(), tc); err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, map[string]string{"status": "ok"})
	return nil
}
