// Story 10-1a · Task 0.4 / AC8 / DD4 — storage-threshold 95% crossing fires
// exactly ONE owner notification + ONE Upgrade email, published POST-COMMIT, and
// the crossing predicate IS the dedup.
//
// Raw pool (committed) so the real ConfirmUpload tx commits and the subscriber's
// own pooled tenant tx can read live usage — a SetupDB savepoint would serialize
// and false-green the post-commit publish.
//
// RED (`//go:build atdd_red_phase`): compile-FAILS on
//
//	service.NewNotificationService / .Register (n101Wire),
//	(*service.FileService).SetEventBus  (the DD4/Task-3.1 bus injection — chosen
//	as a setter to avoid churning the GREEN 4-arg NewFileService callsites), and
//	it RUNTIME-depends on green wiring ConfirmUpload to publish
//	event.StorageThresholdCrossed on a 94→95% crossing.
package test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/event"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestNotification_StorageThresholdCrossing_OneOwnerRowAndEmail_ATDD(t *testing.T) {
	ctx := context.Background()
	pool := SetupRawPool(t)
	clk := clock.NewMockClock(time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC))

	// SEAM + contract pin: the net-new event constant the producer publishes.
	if event.StorageThresholdCrossed != "storage.threshold.crossed" {
		t.Fatalf("event.StorageThresholdCrossed = %q, want storage.threshold.crossed", event.StorageThresholdCrossed)
	}

	// limit 50 MB → threshold 95% = 47.5 MB. File sizes stay under the 50 MB
	// per-file .pdf cap (A9) while still exercising the 94→95% crossing scenario.
	const limit = 50 * oneMB
	center := n101NewCenter(t, limit)
	owner := n101SeedMemberOnPool(t, center, "n101-stor-owner-"+UUIDString(center)[:8]+"@example.com", "Storage Owner", "owner")

	mockEmail := &service.MockEmailSender{}
	bus, _ := n101Wire(t, pool, clk, mockEmail)

	mock := service.NewMockStorageService()
	fileSvc := service.NewFileService(pool, mock, service.NewAuditService(pool), clk)
	fileSvc.SetEventBus(bus) // SEAM: green wires ConfirmUpload → post-commit publish

	// Owner-less tenant context (UserID empty → confirm skips audit). The owner
	// row is routed via GetCenterOwnerUserID, NOT via the uploader identity.
	tc := model.TenantContext{CenterID: UUIDString(center), Role: string(model.RoleOwner)}
	confirm := func(suffix string, size int64) pgtype.UUID {
		key := UUIDString(center) + "/knowledge/" + suffix + ".pdf"
		mock.Objects[key] = &service.ObjectMeta{Key: key, ContentType: "application/pdf", Size: size}
		row, err := fileSvc.ConfirmUpload(ctx, tc, service.ConfirmUploadInput{ObjectKey: key, Name: suffix, SizeBytes: size})
		if err != nil {
			t.Fatalf("confirm %s (%d bytes): %v", suffix, size, err)
		}
		return row.ID
	}

	sp := SuperuserPool(t)

	// (1) Seed below threshold — one 45 MB upload. 45 < 47.5 → NO crossing.
	first := confirm("a", 45*oneMB)
	if got := n101CountByType(t, sp, center, owner, n101TypeStorageThreshold); got != 0 {
		t.Fatalf("no crossing below threshold, expected 0 storage_threshold rows, got %d", got)
	}

	// (2) Cross the threshold — a 3 MB upload. 45 < 47.5 and 45+3 >= 47.5 → EXACTLY one crossing.
	confirm("b", 3*oneMB)
	if got := n101CountByType(t, sp, center, owner, n101TypeStorageThreshold); got != 1 {
		t.Fatalf("crossing 95%% must create exactly 1 owner storage_threshold row, got %d", got)
	}
	_, _, link, metaRaw, found := n101FirstByType(t, sp, center, owner, n101TypeStorageThreshold)
	if !found {
		t.Fatalf("storage_threshold row not found for owner")
	}
	if link != "/settings/storage" {
		t.Errorf("storage_threshold link = %q, want /settings/storage", link)
	}
	meta := n101Metadata(t, metaRaw)
	if _, ok := meta["usedBytes"]; !ok {
		t.Errorf("metadata must carry usedBytes (value-scan), got %v", meta)
	}
	if _, ok := meta["limitBytes"]; !ok {
		t.Errorf("metadata must carry limitBytes (value-scan), got %v", meta)
	}

	// Exactly one Upgrade email to the owner (EN; VN deferred FU-9-4-EMAIL-LOCALE).
	sent := mockEmail.Snapshot()
	if len(sent) != 1 {
		t.Fatalf("exactly one storage email expected, got %d", len(sent))
	}
	if !strings.Contains(strings.ToLower(sent[0].Subject+sent[0].HTML), "upgrade") {
		t.Errorf("storage email must carry the Upgrade CTA, got subject=%q", sent[0].Subject)
	}
	// Code-review fix: the email CTA must be an ABSOLUTE href (a relative path does
	// not resolve in a mail client). The in-app row link (above) stays relative.
	if !strings.Contains(sent[0].HTML, `href="`+n101StorageSettingsURL+`"`) {
		t.Errorf("storage email Upgrade CTA must use the absolute settings URL %q, got HTML=%q", n101StorageSettingsURL, sent[0].HTML)
	}

	// (3) A second upload while ALREADY >= threshold → no new row (predicate dedup).
	confirm("c", 1*oneMB)
	if got := n101CountByType(t, sp, center, owner, n101TypeStorageThreshold); got != 1 {
		t.Errorf("upload while already >=threshold must NOT add a row, still want 1, got %d", got)
	}

	// (4) Delete-then-re-cross → one NEW row (a new crossing is a new signal — DD4).
	if err := fileSvc.SoftDeleteFile(ctx, tc, mustUUID(t, first)); err != nil {
		t.Fatalf("soft-delete to drop below threshold: %v", err)
	}
	confirm("d", 45*oneMB) // usage drops to ~4 MB then re-crosses
	if got := n101CountByType(t, sp, center, owner, n101TypeStorageThreshold); got != 2 {
		t.Errorf("delete-then-re-cross must fire a NEW row (total 2), got %d", got)
	}
}

// TestStorage_ConcurrentCrossing_DoubleFires_FU_10_1_STORAGE_RACE greps the
// accepted-v1 residual race: two truly-concurrent uploads that both read
// pre-crossing usage before either commits could double-fire. The advisory lock
// in ConfirmUpload collapses MOST of the window (upload2 can't read `used` until
// upload1 commits + releases), so this is deferred, not fixed.
func TestStorage_ConcurrentCrossing_DoubleFires_FU_10_1_STORAGE_RACE(t *testing.T) {
	t.Skip("FU-10-1-STORAGE-RACE: concurrent crossing double-fires; accepted v1")
}
