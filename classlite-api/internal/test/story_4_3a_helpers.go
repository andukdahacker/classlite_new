// Story 4.3a — AI content-generation test helpers. Mirrors
// NewExerciseTestServerBareMux (the enqueue + poll routes over the same open
// authenticated chain, role/scope enforced in the service) plus the fixtures the
// worker + store ATDD scaffolds reference: an RLS-seeded target exercise, a
// deducted job (job row + -1 ledger, the production single-tx shape), and a
// stuck-job forcer.
package test

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NewAIGenerationTestServerBareMux wires the enqueue + poll routes over the
// exercise chain (extractTenant → requireVerified → requireCenter → ErrorMapper —
// NOT owner-gated) without auth injection, so one test can exercise
// owner/admin/teacher/student by supplying its own bearer token.
func NewAIGenerationTestServerBareMux(t *testing.T, db storyDB) http.Handler {
	t.Helper()
	aiSvc := service.NewAIGenerationService(db)
	aiHandler := handler.NewAIGenerationHandler(aiSvc, clock.RealClock{})

	extractTenant := middleware.ExtractTenant(db, jwtSigner())
	requireVerified := middleware.RequireVerifiedEmail()
	requireCenter := middleware.RequireCenterContext()
	chain := func(h middleware.HandlerWithError) http.Handler {
		return extractTenant(
			requireVerified(
				requireCenter(http.HandlerFunc(middleware.ErrorMapper(h))),
			),
		)
	}
	mux := http.NewServeMux()
	mux.Handle("POST /api/exercises/{id}/ai-generate", chain(aiHandler.Enqueue))
	mux.Handle("GET /api/jobs/{jobId}", chain(aiHandler.PollJob))
	return mux
}

// SeedExerciseOwnedBy inserts a committed exercise via the superuser pool
// (bypassing RLS for a cross-tx-visible fixture), owned by ownerID within
// centerID. centerID/ownerID are UUID strings; code is the unique EX code.
func SeedExerciseOwnedBy(t *testing.T, _ *pgxpool.Pool, centerID, ownerID, code string) uuid.UUID {
	t.Helper()
	sp := superuserPool(t)
	id := uuid.New()
	if _, err := sp.Exec(context.Background(),
		`INSERT INTO exercises (id, center_id, created_by, code, title, skill, tags, content, schema_version)
		 VALUES ($1, $2, $3, $4, 'AI target', 'reading', '{}', '{"sections":[]}', 1)`,
		id, centerID, ownerID, code,
	); err != nil {
		t.Fatalf("seed exercise owned by %s: %v", ownerID, err)
	}
	return id
}

// SeedExerciseAuthorForWorker inserts a bare user (no RLS on users) to serve as
// an exercise author / ledger actor in worker-harness tests. Returns its id.
func SeedExerciseAuthorForWorker(t *testing.T, db *TxDB) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO users (id, email, full_name) VALUES ($1, $2, $3)`,
		id, "author-"+id.String()[:8]+"@example.com", "AI Author",
	); err != nil {
		t.Fatalf("seed exercise author: %v", err)
	}
	return id
}

// SeedExerciseForWorker sets tenant context to centerID (so the RLS INSERT
// passes) and inserts a target exercise the ai_generate handlers can read.
// Returns the exercise id.
func SeedExerciseForWorker(t *testing.T, db *TxDB, centerID uuid.UUID) uuid.UUID {
	t.Helper()
	author := SeedExerciseAuthorForWorker(t, db)
	TenantContext(t, db, pgtype.UUID{Bytes: centerID, Valid: true})
	id := uuid.New()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO exercises (id, center_id, created_by, code, title, skill, tags, content, schema_version)
		 VALUES ($1, $2, $3, $4, 'AI target', 'reading', '{}', '{"sections":[]}', 1)`,
		id, centerID, author, "EX-AIGEN-"+id.String()[:8],
	); err != nil {
		t.Fatalf("seed worker exercise: %v", err)
	}
	return id
}

// SeedDeductedAIJob mimics production enqueue: a pending job + its -1
// job_deduction ledger row in the tenant tx (tenant context is (re)set to
// tenantID). Uses the generated queries so it exercises the same insert path the
// service does. Returns the new job id.
func SeedDeductedAIJob(t *testing.T, db *TxDB, tenantID, jobType string, params any) uuid.UUID {
	t.Helper()
	center := uuid.MustParse(tenantID)
	TenantContext(t, db, pgtype.UUID{Bytes: center, Valid: true})
	user := SeedExerciseAuthorForWorker(t, db)

	raw, err := json.Marshal(params)
	if err != nil {
		t.Fatalf("marshal job params: %v", err)
	}
	q := generated.New(db)
	job, err := q.InsertJob(context.Background(), generated.InsertJobParams{
		CenterID:            pgtype.UUID{Bytes: center, Valid: true},
		CreatedBy:           pgtype.UUID{Bytes: user, Valid: true},
		Type:                jobType,
		Params:              raw,
		ParamsSchemaVersion: model.AIJobParamsSchemaVersion,
	})
	if err != nil {
		t.Fatalf("seed deducted job: insert job: %v", err)
	}
	if err := q.InsertJobDeduction(context.Background(), generated.InsertJobDeductionParams{
		CenterID: pgtype.UUID{Bytes: center, Valid: true},
		UserID:   pgtype.UUID{Bytes: user, Valid: true},
		RefJobID: job.ID,
	}); err != nil {
		t.Fatalf("seed deducted job: deduction: %v", err)
	}
	return uuid.UUID(job.ID.Bytes)
}

// ForceJobProcessingSince wedges a job into 'processing' with a started_at in the
// past, so the 5-minute stuck-sweep can reclaim it. Tenant context must be set.
func ForceJobProcessingSince(t *testing.T, db *TxDB, jobID uuid.UUID, when time.Time) {
	t.Helper()
	if _, err := db.Exec(context.Background(),
		`UPDATE jobs SET status = 'processing', started_at = $2 WHERE id = $1`,
		jobID, when,
	); err != nil {
		t.Fatalf("force job processing: %v", err)
	}
}
