package seed

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// GoldenDigest is the committed golden content-hash over both deterministic
// tenants (CenterAID + CenterBID) after a clean seed. The determinism oracle
// (AC1/DD14) asserts hash(run1)==hash(run2) AND ==GoldenDigest, catching the
// failure modes row-count equality misses: re-randomized FKs, a partial first
// run masked by ON CONFLICT DO NOTHING, or a drifted updatable column. It is
// regenerated whenever the seeded dataset's deterministic shape changes.
const GoldenDigest = "ea51380547ae2c174d7bb7220503113ce1ee580d5984cf4da4163af9f64304d5"

// hashQueries is the fixed, ordered set of SELECTs whose canonical text
// serialization forms the content hash. Every column is cast to text and every
// query is ORDER BY'd so the serialization is stable across runs and machines.
// NON-DETERMINISTIC columns (bcrypt password_hash, server-default timestamps,
// gen-defaulted created_at/updated_at) are deliberately EXCLUDED (Winston c /
// DD14) — idempotency means "don't duplicate", not "byte-identical".
var hashQueries = []struct {
	label string
	sql   string
}{
	{"center_members", `SELECT user_id::text, role FROM center_members WHERE center_id=$1 ORDER BY user_id, role`},
	{"users", `SELECT u.id::text, u.email, u.full_name FROM users u JOIN center_members m ON m.user_id=u.id WHERE m.center_id=$1 ORDER BY u.id`},
	{"classes", `SELECT id::text, name, status, coalesce(target_band::text,''), coalesce(primary_skill,'') FROM classes WHERE center_id=$1 ORDER BY id`},
	{"sessions", `SELECT id::text, class_id::text, coalesce(topic,'') FROM sessions WHERE center_id=$1 ORDER BY id`},
	{"enrollments", `SELECT id::text, class_id::text, student_id::text, status FROM enrollments WHERE center_id=$1 ORDER BY id`},
	{"exercises", `SELECT id::text, code, title, skill FROM exercises WHERE center_id=$1 ORDER BY id`},
	{"assignments", `SELECT id::text, class_id::text, exercise_id::text, status FROM assignments WHERE center_id=$1 ORDER BY id`},
	{"submissions", `SELECT id::text, assignment_id::text, student_id::text, status FROM submissions WHERE center_id=$1 ORDER BY id`},
	{"current_grades", `SELECT id::text, submission_id::text, overall_band::text, coalesce(feedback,''), (released_at IS NOT NULL)::text FROM current_grades WHERE center_id=$1 ORDER BY id`},
	{"attendance", `SELECT id::text, session_id::text, student_id::text, status FROM attendance WHERE center_id=$1 ORDER BY id`},
	{"files", `SELECT id::text, name, slug, object_key, size_bytes::text FROM files WHERE center_id=$1 ORDER BY id`},
}

// ContentHash returns a stable SHA-256 over the canonical serialization of the
// seeded rows for the given centers, in deterministic order. It runs each
// center under its own RLS tenant context so it works against either the app or
// a superuser pool, and filters by center_id explicitly so it never relies on
// RLS alone for correctness.
func ContentHash(ctx context.Context, pool *pgxpool.Pool, centerIDs ...pgtype.UUID) (string, error) {
	h := sha256.New()
	for _, cid := range centerIDs {
		idStr := uuidStr(cid)
		if err := hashCenter(ctx, pool, idStr, cid, h); err != nil {
			return "", err
		}
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func hashCenter(ctx context.Context, pool *pgxpool.Pool, idStr string, cid pgtype.UUID, h interface{ Write([]byte) (int, error) }) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("content hash: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, "SET LOCAL ROLE classlite_app"); err != nil {
		return fmt.Errorf("content hash: set role: %w", err)
	}
	if err := store.SetTenantContext(ctx, tx, model.TenantContext{CenterID: idStr}); err != nil {
		return err
	}

	// hash.Hash.Write never errors; discard explicitly for errcheck.
	_, _ = fmt.Fprintf(h, "center:%s\n", idStr)
	for _, q := range hashQueries {
		_, _ = fmt.Fprintf(h, "table:%s\n", q.label)
		rows, err := tx.Query(ctx, q.sql, cid)
		if err != nil {
			return fmt.Errorf("content hash: query %s: %w", q.label, err)
		}
		for rows.Next() {
			vals, err := rows.Values()
			if err != nil {
				rows.Close()
				return fmt.Errorf("content hash: scan %s: %w", q.label, err)
			}
			for i, v := range vals {
				if i > 0 {
					_, _ = h.Write([]byte("|"))
				}
				_, _ = fmt.Fprintf(h, "%v", v)
			}
			_, _ = h.Write([]byte("\n"))
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return fmt.Errorf("content hash: rows %s: %w", q.label, err)
		}
		rows.Close()
	}
	return nil
}

// uuidStr renders a pgtype.UUID as a canonical hyphenated string.
func uuidStr(u pgtype.UUID) string {
	b := u.Bytes
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
