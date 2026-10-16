// Story 11-8a — AC5 (SEC-7 confused-deputy closed; FU-11-1A-MIGRATOR-BYPASSRLS).
//
// The two Epic-9 tenant-resolution resolvers (polar_center_by_subscription_id /
// polar_center_by_checkout_id, migrations 20260930120600/700) are SECURITY DEFINER
// functions that MUST read FORCE-RLS tables (subscriptions / billing_checkout_intents)
// ACROSS tenants with no tenant GUC — the webhook receiver runs pre-tenant. A SECURITY
// DEFINER function executes with the privileges of its OWNER. In prod the owner is the
// dedicated migrator role, which this story provisions NOSUPERUSER BYPASSRLS. The leak
// AC5 closes: if that owner lacks BYPASSRLS, FORCE RLS applies, the resolver returns NULL,
// and the webhook receiver silently falls back to the SPOOFABLE metadata.center_id — a
// confused deputy that can redirect a paid grant to an attacker's center.
//
// These are TEST-ONLY PINNING + role-privilege regression tests (DF-D): they do NOT change
// the behavior of the two immutable resolvers. They are green TODAY (the CI/test migrator
// already carries BYPASSRLS, mirroring the prod role this story provisions) and stand as a
// permanent regression guard — they RED the moment the migrator loses BYPASSRLS, is made a
// SUPERUSER, or the resolvers are re-owned, or FORCE RLS is dropped from the two tables.
//
// TEETH (AC5, DF-B):
//   (i)   POSITIVE — resolvers return the correct cross-tenant center_id when called with
//         NO tenant GUC, through a non-bypass caller (classlite_app), proving the SECURITY
//         DEFINER elevation to the non-superuser BYPASSRLS owner is what makes it work.
//   (i')  NEGATIVE CONTROL — a byte-identical twin resolver owned by a role WITHOUT BYPASSRLS
//         (classlite_app) returns NULL for the SAME row, proving (a) FORCE RLS is actually on
//         and (b) BYPASSRLS on the owner is the CAUSE, not an accident.
//   (i'') FORCE assertion — relforcerowsecurity is true on both tables (direct pg_catalog).
//   (ii)  RECEIVER-FALLBACK — when the resolver returns a real center_id the receiver uses it
//         and does NOT consult metadata.center_id; a disagreeing spoofed metadata is ignored
//         (the persisted mapping wins — the positive half of the confused-deputy guard).
//   (iii) pg_roles — the actually-provisioned migrator role is rolsuper=false, rolbypassrls=true,
//         AND it OWNS both resolver functions (catches a later SUPERUSER re-grant / re-own drift).
//
// The prod-role equivalent of (iii) cannot be reached from a Go test; the runbook documents
// the identical pg_roles / pg_proc.proowner assertion to run against the prod railway DB.

package test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ducdo/classlite-api/internal/store/generated"
)

// setSubscriptionPolarID binds a known polar_subscription_id to a center's subscription
// (superuser/raw, bypassing RLS — the row is committed by newBillingCenter).
func setSubscriptionPolarID(t *testing.T, centerID pgtype.UUID, polarSubID string) {
	t.Helper()
	if _, err := SuperuserPool(t).Exec(context.Background(),
		`UPDATE subscriptions SET polar_subscription_id = $2 WHERE center_id = $1`,
		centerID, polarSubID,
	); err != nil {
		t.Fatalf("bind polar_subscription_id: %v", err)
	}
}

// seedCheckoutIntent plants a billing_checkout_intents row keyed by a polar_checkout_id
// (superuser/raw). Cleaned up with the center it belongs to via newBillingCenter's cleanup
// (ON DELETE CASCADE from centers), plus an explicit delete here for determinism.
func seedCheckoutIntent(t *testing.T, centerID pgtype.UUID, polarCheckoutID string) {
	t.Helper()
	ctx := context.Background()
	if _, err := SuperuserPool(t).Exec(ctx,
		`INSERT INTO billing_checkout_intents (center_id, kind, target_plan, target_billing_cycle, polar_checkout_id)
		 VALUES ($1, 'upgrade', 'pro', 'monthly', $2)`,
		centerID, polarCheckoutID,
	); err != nil {
		t.Fatalf("seed checkout intent: %v", err)
	}
	t.Cleanup(func() {
		_, _ = SuperuserPool(t).Exec(ctx, `DELETE FROM billing_checkout_intents WHERE polar_checkout_id = $1`, polarCheckoutID)
	})
}

// TestSEC7_ResolversBypassRLSAsNonSuperuserMigratorOwner is teeth (i)/(i')/(i'').
func TestSEC7_ResolversBypassRLSAsNonSuperuserMigratorOwner(t *testing.T) {
	ctx := context.Background()

	// Two tenants, each with its own bound subscription + checkout intent. "Cross-tenant"
	// is proven by resolving each center's id with NO tenant GUC set on the connection.
	centerA, _ := newBillingCenter(t, "pro", 0, 0, 0, billingEpoch.AddDate(0, 1, 0))
	centerB, _ := newBillingCenter(t, "pro", 0, 0, 0, billingEpoch.AddDate(0, 1, 0))
	subA, subB := newPolarSubID(), newPolarSubID()
	coA, coB := "co_"+uuid.NewString(), "co_"+uuid.NewString()
	setSubscriptionPolarID(t, centerA, subA)
	setSubscriptionPolarID(t, centerB, subB)
	seedCheckoutIntent(t, centerA, coA)
	seedCheckoutIntent(t, centerB, coB)

	// --- (i) POSITIVE: real resolvers, non-bypass caller (classlite_app), no GUC ------------
	// SetupRawPool connects as classlite_app (DATABASE_URL) — a NON-bypass, RLS-enforced role.
	// The resolvers nonetheless return the right center because they run as their BYPASSRLS
	// migrator OWNER (SECURITY DEFINER). This IS the production webhook-receiver path.
	q := generated.New(SetupRawPool(t))

	gotSubA, err := q.PolarCenterBySubscriptionID(ctx, subA)
	if err != nil {
		t.Fatalf("PolarCenterBySubscriptionID(A): %v", err)
	}
	if !gotSubA.Valid || UUIDString(gotSubA) != UUIDString(centerA) {
		t.Errorf("subscription resolver returned %v, want center A %s (cross-tenant bypass broken)", gotSubA, UUIDString(centerA))
	}
	gotSubB, err := q.PolarCenterBySubscriptionID(ctx, subB)
	if err != nil {
		t.Fatalf("PolarCenterBySubscriptionID(B): %v", err)
	}
	if !gotSubB.Valid || UUIDString(gotSubB) != UUIDString(centerB) {
		t.Errorf("subscription resolver returned %v, want center B %s", gotSubB, UUIDString(centerB))
	}
	gotCoA, err := q.PolarCenterByCheckoutID(ctx, coA)
	if err != nil {
		t.Fatalf("PolarCenterByCheckoutID(A): %v", err)
	}
	if !gotCoA.Valid || UUIDString(gotCoA) != UUIDString(centerA) {
		t.Errorf("checkout resolver returned %v, want center A %s", gotCoA, UUIDString(centerA))
	}

	// --- (i'') FORCE RLS is actually on (direct pg_catalog) ---------------------------------
	for _, tbl := range []string{"subscriptions", "billing_checkout_intents"} {
		var forced bool
		if err := SuperuserPool(t).QueryRow(ctx,
			`SELECT relforcerowsecurity FROM pg_class WHERE relname = $1`, tbl,
		).Scan(&forced); err != nil {
			t.Fatalf("read relforcerowsecurity for %s: %v", tbl, err)
		}
		if !forced {
			t.Errorf("%s: FORCE ROW LEVEL SECURITY is OFF — the SEC-7 negative control is vacuous", tbl)
		}
	}

	// --- (i') NEGATIVE CONTROL: byte-identical twin resolver owned by a NON-bypass role -----
	// The ONLY difference from the real resolver is the owner's BYPASSRLS attribute. With a
	// non-bypass owner (classlite_app) + FORCE RLS + no GUC, the twin returns NULL for the
	// exact row the real resolver resolved. Proves BYPASSRLS on the owner is the cause.
	sp := SuperuserPool(t)
	if _, err := sp.Exec(ctx, `
		CREATE FUNCTION sec7_neg_control_sub(p_polar_sub_id text) RETURNS uuid
		LANGUAGE sql SECURITY DEFINER STABLE SET search_path = pg_catalog, public
		AS $fn$ SELECT center_id FROM subscriptions WHERE polar_subscription_id = p_polar_sub_id LIMIT 1; $fn$;`); err != nil {
		t.Fatalf("create negative-control twin: %v", err)
	}
	t.Cleanup(func() { _, _ = sp.Exec(context.Background(), `DROP FUNCTION IF EXISTS sec7_neg_control_sub(text)`) })
	if _, err := sp.Exec(ctx, `ALTER FUNCTION sec7_neg_control_sub(text) OWNER TO classlite_app`); err != nil {
		t.Fatalf("chown negative-control twin to classlite_app: %v", err)
	}

	var twinResult pgtype.UUID
	if err := sp.QueryRow(ctx, `SELECT sec7_neg_control_sub($1)`, subA).Scan(&twinResult); err != nil {
		t.Fatalf("call negative-control twin: %v", err)
	}
	if twinResult.Valid {
		t.Errorf("NEGATIVE CONTROL FAILED: a non-BYPASSRLS owner resolved %s — FORCE RLS is not blocking it, so BYPASSRLS is not the load-bearing lever", UUIDString(twinResult))
	}
}

// TestSEC7_MigratorRoleAttributesAndOwnership is teeth (iii): the provisioned migrator role
// is NOSUPERUSER BYPASSRLS and OWNS both resolvers. RED on a prod SUPERUSER re-grant, a
// dropped BYPASSRLS, or a resolver re-owned away from the migrator.
func TestSEC7_MigratorRoleAttributesAndOwnership(t *testing.T) {
	ctx := context.Background()
	sp := SuperuserPool(t)

	var isSuper, bypassRLS bool
	if err := sp.QueryRow(ctx,
		`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'classlite_migrator'`,
	).Scan(&isSuper, &bypassRLS); err != nil {
		t.Fatalf("read classlite_migrator attributes: %v", err)
	}
	if isSuper {
		t.Error("classlite_migrator is SUPERUSER — AC5 requires NOSUPERUSER (a superuser bypasses RLS for the wrong reason and masks a missing BYPASSRLS grant)")
	}
	if !bypassRLS {
		t.Error("classlite_migrator lacks BYPASSRLS — the SEC-7 resolvers will return NULL in prod and the receiver falls back to spoofable metadata.center_id")
	}

	for _, fn := range []string{"polar_center_by_subscription_id", "polar_center_by_checkout_id"} {
		var owner string
		if err := sp.QueryRow(ctx,
			`SELECT r.rolname FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE p.proname = $1`, fn,
		).Scan(&owner); err != nil {
			t.Fatalf("read owner of %s: %v", fn, err)
		}
		if owner != "classlite_migrator" {
			t.Errorf("%s is owned by %q, want classlite_migrator — a SECURITY DEFINER resolver owned by anyone else resolves with the wrong role's privileges", fn, owner)
		}
	}
}

// TestSEC7_ReceiverUsesResolverCenterNotSpoofedMetadata is teeth (ii): the POSITIVE half of
// the confused-deputy guard. When a subscription id is already bound to center A, a signed
// event whose data.id → A but whose metadata.center_id = B applies to A (the resolver's
// center), NOT to the spoofed B. Complements TestPolarTenantResolution_ConfusedDeputy
// (which asserts B is untouched) by asserting A IS the one that changed — i.e. the resolver
// result, not metadata, drove the write.
func TestSEC7_ReceiverUsesResolverCenterNotSpoofedMetadata(t *testing.T) {
	ctx := context.Background()
	svc := newPolarEventService(t)

	// Bind a subscription id to center A via its first event (through its checkout intent anchor).
	centerA, tcA := newBillingCenter(t, "free", 0, 0, 0, billingEpoch.AddDate(0, 1, 0))
	polarSubID := newPolarSubID()
	if _, err := svc.CreateCheckout(ctx, tcA, "upgrade", "pro", "monthly", ""); err != nil {
		t.Fatalf("CreateCheckout for A: %v", err)
	}
	bind := polarSubscriptionUpdated(centerA, polarSubID, "pro", "monthly",
		billingEpoch, billingEpoch.AddDate(0, 1, 0))
	if err := svc.ProcessPolarEvent(ctx, newWebhookEventID(), "subscription.updated", bind); err != nil {
		t.Fatalf("bind A's subscription: %v", err)
	}

	// Center B: the attacker-named victim.
	centerB, _ := newBillingCenter(t, "free", 0, 0, 0, billingEpoch.AddDate(0, 1, 0))

	// A SIGNED event whose data.id ∈ A but whose metadata.center_id = B, upgrading to studio.
	// The resolver maps data.id → A (persisted mapping wins), so the studio change must land on A.
	spoof := polarSubscriptionUpdated(centerB, polarSubID, "studio", "annual",
		billingEpoch, billingEpoch.AddDate(1, 0, 0))
	if err := svc.ProcessPolarEvent(ctx, newWebhookEventID(), "subscription.updated", spoof); err != nil {
		t.Fatalf("ProcessPolarEvent (spoofed metadata): %v", err)
	}

	// A MUST have changed to studio — proving the resolver's center (A) drove the write.
	if planA, _, _, _ := readSubscriptionPlan(t, centerA); planA != "studio" {
		t.Errorf("center A plan = %q, want studio — the resolver's center_id did NOT drive the write (receiver consulted metadata?)", planA)
	}
	// B MUST be untouched — the spoofed metadata.center_id was ignored.
	if planB, _, _, _ := readSubscriptionPlan(t, centerB); planB != "free" {
		t.Errorf("CONFUSED-DEPUTY LEAK: center B plan = %q, want unchanged free (spoofed metadata applied to B)", planB)
	}
}
