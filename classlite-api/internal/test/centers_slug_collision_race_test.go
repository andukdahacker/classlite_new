// Story 2.1 Task 10.3 — TestCenters_SlugCollisionRegeneration
//
// Two concurrent CreateCenter calls with identical names MUST both succeed:
// one keeps the base slug, the other retries with a random suffix. The
// test MUST use SetupRawPool because SetupDB wraps everything in a single
// pgx.Tx that serializes goroutine writes — no race can materialize.
//
// Reference: internal/service/refresh_atdd_test.go:235 (Story 1.5's
// concurrent-rotation ATDD test — the canonical raw-pool concurrent-write
// pattern in this codebase).

package test

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// mockAccessTokenIssuer is a minimal accessTokenIssuer that returns a
// static token. The slug-collision test does not care about token content.
type mockAccessTokenIssuer struct{}

func (mockAccessTokenIssuer) MintAccessToken(
	_ context.Context, _ uuid.UUID, _ *uuid.UUID, _ string,
) (string, time.Time, error) {
	return "mock-token", time.Now().Add(15 * time.Minute), nil
}

func TestCenters_SlugCollisionRegeneration(t *testing.T) {
	pool := SetupRawPool(t)
	ctx := context.Background()

	// Two synthetic users tagged with a run-scoped nonce so parallel test
	// runs don't collide on unique-email. The center name also embeds the
	// nonce so previous runs' leftover rows can't preempt the base slug.
	nonce := uuid.NewString()[:8]
	emailA := "slug-race-a-" + nonce + "@example.com"
	emailB := "slug-race-b-" + nonce + "@example.com"
	scopedCenterName := "Race " + nonce

	var uidA, uidB pgtype.UUID
	if err := pool.QueryRow(ctx,
		`INSERT INTO users (email, full_name, email_verified) VALUES ($1, $2, true) RETURNING id`,
		emailA, "Race A",
	).Scan(&uidA); err != nil {
		t.Fatalf("insert user A: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`INSERT INTO users (email, full_name, email_verified) VALUES ($1, $2, true) RETURNING id`,
		emailB, "Race B",
	).Scan(&uidB); err != nil {
		t.Fatalf("insert user B: %v", err)
	}

	t.Cleanup(func() {
		// PurgeUserAndOwnedCenters uses the superuser pool internally so
		// RLS on center_members + audit_logs doesn't silently block the
		// DELETE (leaving residue that breaks TestCreateCenter's global
		// count assertion).
		PurgeUserAndOwnedCenters(t, pool, uidA)
		PurgeUserAndOwnedCenters(t, pool, uidB)
	})

	auditSvc := service.NewAuditService(pool)
	centerSvc := service.NewCenterService(pool, auditSvc, mockAccessTokenIssuer{}, clock.RealClock{})

	guidA, _ := uuid.Parse(UUIDString(uidA))
	guidB, _ := uuid.Parse(UUIDString(uidB))

	type outcome struct {
		short string
		err   error
	}
	var (
		wg       sync.WaitGroup
		outcomes [2]outcome
	)
	wg.Add(2)
	go func() {
		defer wg.Done()
		res, err := centerSvc.CreateCenter(ctx, guidA, service.CreateCenterInput{Name: scopedCenterName})
		if err == nil {
			outcomes[0] = outcome{short: res.ShortCode}
		} else {
			outcomes[0] = outcome{err: err}
		}
	}()
	go func() {
		defer wg.Done()
		res, err := centerSvc.CreateCenter(ctx, guidB, service.CreateCenterInput{Name: scopedCenterName})
		if err == nil {
			outcomes[1] = outcome{short: res.ShortCode}
		} else {
			outcomes[1] = outcome{err: err}
		}
	}()
	wg.Wait()

	for i, o := range outcomes {
		if o.err != nil {
			t.Fatalf("goroutine %d: CreateCenter unexpected error: %v", i, o.err)
		}
		if o.short == "" {
			t.Fatalf("goroutine %d: empty shortCode", i)
		}
	}

	baseSlug := service.Slugify(scopedCenterName)
	if outcomes[0].short == outcomes[1].short {
		t.Fatalf("slug collision NOT resolved: both goroutines wrote %q", outcomes[0].short)
	}

	// Exactly one goroutine keeps the base slug; the other carries a
	// random suffix (`<base>-<4 chars>`). We do NOT assert which
	// goroutine won — the pool assignment is non-deterministic.
	if !(outcomes[0].short == baseSlug || outcomes[1].short == baseSlug) {
		t.Errorf("neither goroutine kept the base slug %q; got %+v", baseSlug, outcomes)
	}
	suffixed := outcomes[0].short
	if suffixed == baseSlug {
		suffixed = outcomes[1].short
	}
	if !strings.HasPrefix(suffixed, baseSlug+"-") {
		t.Errorf("suffixed slug %q does not start with %q-", suffixed, baseSlug)
	}
	if len(suffixed) < len(baseSlug)+2 {
		t.Errorf("suffixed slug %q too short — expected base + '-' + random", suffixed)
	}
}

