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

// slugRaceWaitTimeout is the wall-clock ceiling for both CreateCenter
// goroutines to complete. Under a healthy environment this test runs in
// <1s; the 30s cap surfaces goroutine hangs (connection-pool exhaustion,
// DB stall) as a clean test failure instead of blocking the whole
// binary until go test's default 10-minute deadline expires. Added by
// /bmad-tea TA 2-1 per RV finding.
const slugRaceWaitTimeout = 30 * time.Second

func TestCenters_SlugCollisionRegeneration(t *testing.T) {
	pool := SetupRawPool(t)
	ctx := context.Background()

	// Two synthetic users tagged with a run-scoped nonce so parallel test
	// runs don't collide on unique-email. Emails carry the full UUID
	// (128 bits) — no length constraint. The center name uses a shorter
	// hex-only slice so its Slugify output stays under the 30-char
	// slugMaxLen: otherwise the base slug itself gets truncated on the
	// happy-path insert and the "winning-base + suffix" invariant this
	// test asserts no longer holds. 12 hex chars = 48 bits — well over
	// 2^24 tests before the birthday-paradox 50% collision line, which
	// is ~16M runs; ample for realistic suite growth (RV isolation nit).
	fullNonce := uuid.NewString()
	nameNonce := strings.ReplaceAll(fullNonce, "-", "")[:12]
	emailA := "slug-race-a-" + fullNonce + "@example.com"
	emailB := "slug-race-b-" + fullNonce + "@example.com"
	scopedCenterName := "Race " + nameNonce

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

	guidA := MustParseUUID(t, UUIDString(uidA))
	guidB := MustParseUUID(t, UUIDString(uidB))

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
	// wg.Wait() with a deterministic ceiling — see slugRaceWaitTimeout comment.
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(slugRaceWaitTimeout):
		t.Fatalf("slug race test hung — one or both CreateCenter goroutines did not complete within %s", slugRaceWaitTimeout)
	}

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

