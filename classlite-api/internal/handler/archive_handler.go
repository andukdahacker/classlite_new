// Package handler — Story 10.2 ArchiveHandler.
//
// GET /api/archive — the role-scoped, UNION-paginated archive of soft-deleted
// exercises + ended-≥30-days classes. Sits on the staff-gated chain
// (owner/admin/teacher); the service enforces role scope + the student 403 and
// the type-enum 422. The {data,meta} envelope carries explicit nulls (GO-5): a
// class row's skill/targetBand/link and an exercise row's classStatus are null.
package handler

import (
	"net/http"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/service"
)

type ArchiveHandler struct {
	svc *service.ArchiveService
	clk clock.Clock
}

// NewArchiveHandler wires the archive read handler.
func NewArchiveHandler(svc *service.ArchiveService, clk clock.Clock) *ArchiveHandler {
	return &ArchiveHandler{svc: svc, clk: clk}
}

// archiveItemResponse is one archive row on the wire. All fields explicit, no
// omitempty (GO-5). type is the discriminator; per-type fields are null for the
// other type. archivedAt is an ISO string (TS-6). link is the exercise Edit /
// Edit-a-copy target; "" for read-only classes.
type archiveItemResponse struct {
	Type        string   `json:"type"`
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	Subtitle    string   `json:"subtitle"`
	ArchivedAt  *string  `json:"archivedAt"`
	ClassStatus *string  `json:"classStatus"`
	Skill       *string  `json:"skill"`
	TargetBand  *float64 `json:"targetBand"`
	Link        string   `json:"link"`
}

func (h *ArchiveHandler) toResponse(it service.ArchiveItem) archiveItemResponse {
	archivedAt := it.ArchivedAt
	return archiveItemResponse{
		Type:        it.Type,
		ID:          it.ID,
		Title:       it.Title,
		Subtitle:    it.Subtitle,
		ArchivedAt:  wireTimePtr(&archivedAt),
		ClassStatus: it.ClassStatus,
		Skill:       it.Skill,
		TargetBand:  it.TargetBand,
		Link:        it.Link,
	}
}

// List — GET /api/archive (AC1/AC4). Role-scoped, paginated; optional ?type=.
func (h *ArchiveHandler) List(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireQuestionTenant(r)
	if err != nil {
		return err
	}
	page, pageSize := parseSnakePageParams(r)
	filter := service.ArchiveListFilter{
		Type:     r.URL.Query().Get("type"),
		Page:     page,
		PageSize: pageSize,
	}
	items, pageMeta, err := h.svc.List(r.Context(), tc, filter)
	if err != nil {
		return err
	}
	out := make([]archiveItemResponse, len(items))
	for i, it := range items {
		out[i] = h.toResponse(it)
	}
	writePaginatedEnvelope(w, h.clk, out, pageMeta)
	return nil
}
