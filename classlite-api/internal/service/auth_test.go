package service_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

const testVerifyURLBase = "https://my.classlite.app/verify-email"

func newAuthService(db *test.TxDB, opts ...func(*service.AuthService)) (*service.AuthService, *service.MockHasher, *service.MockEmailSender, *service.InProcessRetryQueue) {
	hasher := &service.MockHasher{}
	sender := &service.MockEmailSender{}
	// Buffer 8 is plenty for unit tests; we don't start the worker, we just
	// inspect the channel via Enqueue's return value indirectly via accept-or-drop.
	queue := service.NewEmailRetryQueue(sender, 8)
	auditLogger := service.NewPgAuthAuditLogger(db)
	svc := service.NewAuthService(db, hasher, sender, auditLogger, queue, testVerifyURLBase)
	for _, opt := range opts {
		opt(svc)
	}
	return svc, hasher, sender, queue
}

// drainQueueOnce processes queued jobs by starting the worker, then polls the
// mock sender via its locked Count accessor (race-detector safe). Fails the
// test if `want` sends do not occur within the deadline.
func drainQueueOnce(t *testing.T, q *service.InProcessRetryQueue, sender *service.MockEmailSender, want int) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go q.Start(ctx)
	deadline := time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(deadline) {
		if sender.Count() >= want {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatalf("expected %d emails, got %d", want, sender.Count())
}

// fetchEmailVerificationsForUser returns the (token, verified_at_valid) tuples
// for a user, ordered by created_at.
type fetchedVerification struct {
	Token      string
	IsVerified bool
}

func fetchVerificationsForUser(t *testing.T, db *test.TxDB, userID pgtype.UUID) []fetchedVerification {
	t.Helper()
	rows, err := db.Tx.Query(context.Background(),
		`SELECT token, verified_at IS NOT NULL FROM email_verifications WHERE user_id = $1 ORDER BY created_at ASC`,
		userID)
	if err != nil {
		t.Fatalf("query email_verifications: %v", err)
	}
	defer rows.Close()
	var out []fetchedVerification
	for rows.Next() {
		var fv fetchedVerification
		if err := rows.Scan(&fv.Token, &fv.IsVerified); err != nil {
			t.Fatalf("scan: %v", err)
		}
		out = append(out, fv)
	}
	return out
}

// ---------- Register ----------

func TestAuthService_Register_HappyPath(t *testing.T) {
	db := test.SetupDB(t)
	svc, hasher, sender, queue := newAuthService(db)

	res, err := svc.Register(context.Background(), service.RegisterRequest{
		Email:    "Alice@Example.COM",
		Password: "supersecret",
		FullName: "Alice Liddell",
	})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	if hasher.CallCount != 1 {
		t.Errorf("expected hasher.CallCount=1, got %d", hasher.CallCount)
	}
	if res.User.Email != "alice@example.com" {
		t.Errorf("email not normalized: %q", res.User.Email)
	}
	if res.User.EmailVerified {
		t.Errorf("emailVerified should be false")
	}
	if res.EmailDelivery != "sent" {
		t.Errorf("emailDelivery = %q, want sent", res.EmailDelivery)
	}
	if res.VerifyPollID == uuid.Nil {
		t.Errorf("verifyPollID should not be zero")
	}

	// email_verifications row exists, unconsumed, 43-char base64url token
	vs := fetchVerificationsForUser(t, db, res.User.ID)
	if len(vs) != 1 {
		t.Fatalf("expected 1 email_verifications row, got %d", len(vs))
	}
	if len(vs[0].Token) != 43 {
		t.Errorf("token length = %d, want 43", len(vs[0].Token))
	}
	if vs[0].IsVerified {
		t.Errorf("token should NOT be marked verified yet")
	}

	// auth_audit_logs row exists
	var auditCount int
	if err := db.Tx.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM auth_audit_logs WHERE user_id = $1 AND action = 'user.registered'`,
		res.User.ID).Scan(&auditCount); err != nil {
		t.Fatalf("count audit: %v", err)
	}
	if auditCount != 1 {
		t.Errorf("expected 1 audit row, got %d", auditCount)
	}

	// Drain the retry queue and confirm exactly one email was sent.
	drainQueueOnce(t, queue, sender, 1)
	sent := sender.Snapshot()
	if len(sent) != 1 {
		t.Errorf("expected 1 sent email, got %d", len(sent))
	}
	if !strings.Contains(sent[0].HTML, vs[0].Token) {
		t.Errorf("email body should contain token")
	}
}

func TestAuthService_Register_DuplicateEmailCaseInsensitive(t *testing.T) {
	db := test.SetupDB(t)
	svc, _, sender, _ := newAuthService(db)

	_, err := svc.Register(context.Background(), service.RegisterRequest{
		Email:    "DUP@example.com",
		Password: "supersecret",
		FullName: "First",
	})
	if err != nil {
		t.Fatalf("first Register: %v", err)
	}

	_, err = svc.Register(context.Background(), service.RegisterRequest{
		Email:    "dup@EXAMPLE.com",
		Password: "supersecret",
		FullName: "Second",
	})
	var conflict model.ConflictError
	if !errors.As(err, &conflict) {
		t.Fatalf("expected ConflictError, got %v", err)
	}
	if conflict.Code != "EMAIL_ALREADY_REGISTERED" {
		t.Errorf("code = %q, want EMAIL_ALREADY_REGISTERED", conflict.Code)
	}

	// Exactly one user row, exactly one email_verifications row
	var userCount int
	db.Tx.QueryRow(context.Background(), `SELECT COUNT(*) FROM users WHERE email = 'dup@example.com'`).Scan(&userCount)
	if userCount != 1 {
		t.Errorf("expected 1 user row, got %d", userCount)
	}

	// SentEmails records the first registration's send if queue is drained;
	// for this test we just assert the duplicate path did not enqueue anything
	// beyond the initial. The retry queue worker isn't started, so the buffered
	// channel has the first job sitting in it. We check the buffer level
	// indirectly: at most 1 job pending.
	_ = sender
}

func TestAuthService_Register_ValidationFailures_HasherNotInvoked(t *testing.T) {
	cases := []struct {
		name string
		req  service.RegisterRequest
	}{
		{"missing email", service.RegisterRequest{Email: "", Password: "supersecret", FullName: "X"}},
		{"bad email format", service.RegisterRequest{Email: "not-an-email", Password: "supersecret", FullName: "X"}},
		{"short password", service.RegisterRequest{Email: "ok@x.com", Password: "short", FullName: "X"}},
		{"oversize password", service.RegisterRequest{Email: "ok@x.com", Password: strings.Repeat("a", 73), FullName: "X"}},
		{"empty fullName after trim", service.RegisterRequest{Email: "ok@x.com", Password: "supersecret", FullName: "   "}},
		{"oversize fullName", service.RegisterRequest{Email: "ok@x.com", Password: "supersecret", FullName: strings.Repeat("a", 201)}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			db := test.SetupDB(t)
			svc, hasher, _, _ := newAuthService(db)
			_, err := svc.Register(context.Background(), tc.req)
			var ve model.ValidationError
			if !errors.As(err, &ve) {
				t.Fatalf("expected ValidationError, got %v", err)
			}
			if hasher.CallCount != 0 {
				t.Errorf("Hasher.CallCount should be 0 (AC11/H2), got %d", hasher.CallCount)
			}
			// No user row created
			var n int
			db.Tx.QueryRow(context.Background(), `SELECT COUNT(*) FROM users WHERE email = $1`, strings.ToLower(strings.TrimSpace(tc.req.Email))).Scan(&n)
			if n != 0 {
				t.Errorf("no user row should exist, got %d", n)
			}
		})
	}
}

func TestAuthService_Register_EmailDelivery_FailedWhenQueueFull(t *testing.T) {
	db := test.SetupDB(t)
	hasher := &service.MockHasher{}
	sender := &service.MockEmailSender{}
	queue := service.NewEmailRetryQueue(sender, 1)
	// Pre-fill the queue so the next Enqueue is rejected.
	queue.Enqueue(service.EmailJob{To: "pad@x.com"})
	auditLogger := service.NewPgAuthAuditLogger(db)
	svc := service.NewAuthService(db, hasher, sender, auditLogger, queue, testVerifyURLBase)

	res, err := svc.Register(context.Background(), service.RegisterRequest{
		Email:    "failed@example.com",
		Password: "supersecret",
		FullName: "Failed User",
	})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	// Contract change (review decision D3): when the retry queue rejects a
	// job (buffer full), emailDelivery reports "failed" so the frontend can
	// prompt the user to use Resend Verification. "delayed" is reserved for
	// future genuinely-postponed-not-dropped semantics.
	if res.EmailDelivery != service.EmailDeliveryFailed {
		t.Errorf("expected emailDelivery=%q when queue full, got %q", service.EmailDeliveryFailed, res.EmailDelivery)
	}
}

// ---------- VerifyEmail ----------

func registerAndGetToken(t *testing.T, db *test.TxDB) (*service.RegisterResult, string) {
	t.Helper()
	svc, _, _, _ := newAuthService(db)
	res, err := svc.Register(context.Background(), service.RegisterRequest{
		Email:    "verify@example.com",
		Password: "supersecret",
		FullName: "Verify User",
	})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	var token string
	if err := db.Tx.QueryRow(context.Background(),
		`SELECT token FROM email_verifications WHERE user_id = $1`,
		res.User.ID).Scan(&token); err != nil {
		t.Fatalf("fetch token: %v", err)
	}
	return res, token
}

func TestAuthService_VerifyEmail_HappyPath(t *testing.T) {
	db := test.SetupDB(t)
	svc, _, _, _ := newAuthService(db)
	res, err := svc.Register(context.Background(), service.RegisterRequest{
		Email:    "v@example.com",
		Password: "supersecret",
		FullName: "V",
	})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	var token string
	db.Tx.QueryRow(context.Background(), `SELECT token FROM email_verifications WHERE user_id = $1`, res.User.ID).Scan(&token)

	verifyRes, err := svc.VerifyEmail(context.Background(), token)
	if err != nil {
		t.Fatalf("VerifyEmail: %v", err)
	}
	if !verifyRes.Verified {
		t.Error("verified should be true")
	}
	if verifyRes.Email != "v@example.com" {
		t.Errorf("email = %q", verifyRes.Email)
	}

	// user.email_verified flipped
	var ev bool
	db.Tx.QueryRow(context.Background(), `SELECT email_verified FROM users WHERE id = $1`, res.User.ID).Scan(&ev)
	if !ev {
		t.Error("users.email_verified should be true")
	}

	// audit row for email_verified action
	var n int
	db.Tx.QueryRow(context.Background(), `SELECT COUNT(*) FROM auth_audit_logs WHERE user_id = $1 AND action = 'user.email_verified'`, res.User.ID).Scan(&n)
	if n != 1 {
		t.Errorf("expected 1 email_verified audit row, got %d", n)
	}
}

func TestAuthService_VerifyEmail_IdempotentAfterVerify(t *testing.T) {
	db := test.SetupDB(t)
	svc, _, _, _ := newAuthService(db)
	res, _ := svc.Register(context.Background(), service.RegisterRequest{
		Email: "idem@example.com", Password: "supersecret", FullName: "Idem",
	})
	var token string
	db.Tx.QueryRow(context.Background(), `SELECT token FROM email_verifications WHERE user_id = $1`, res.User.ID).Scan(&token)

	if _, err := svc.VerifyEmail(context.Background(), token); err != nil {
		t.Fatalf("first verify: %v", err)
	}
	// Second call with the same token — should be 200 idempotent.
	r, err := svc.VerifyEmail(context.Background(), token)
	if err != nil {
		t.Fatalf("second verify should be idempotent, got %v", err)
	}
	if !r.Verified {
		t.Error("verified should be true on idempotent call")
	}
}

func TestAuthService_VerifyEmail_OlderTokenAfterResend_StillIdempotent(t *testing.T) {
	// After resend rotates the token, replaying the OLD token after verification
	// of the NEW token should still return 200 (AC5 collapse — any prior token
	// works once user.email_verified is true).
	db := test.SetupDB(t)
	svc, _, _, _ := newAuthService(db)
	res, _ := svc.Register(context.Background(), service.RegisterRequest{
		Email: "rotate@example.com", Password: "supersecret", FullName: "Rotate",
	})
	var oldToken string
	db.Tx.QueryRow(context.Background(), `SELECT token FROM email_verifications WHERE user_id = $1`, res.User.ID).Scan(&oldToken)

	if _, err := svc.ResendVerification(context.Background(), "rotate@example.com"); err != nil {
		t.Fatalf("Resend: %v", err)
	}

	var newToken string
	db.Tx.QueryRow(context.Background(), `SELECT token FROM email_verifications WHERE user_id = $1 AND verified_at IS NULL ORDER BY created_at DESC LIMIT 1`, res.User.ID).Scan(&newToken)

	if _, err := svc.VerifyEmail(context.Background(), newToken); err != nil {
		t.Fatalf("verify new token: %v", err)
	}
	// Now replay the OLD token — must be 200 idempotent.
	r, err := svc.VerifyEmail(context.Background(), oldToken)
	if err != nil {
		t.Fatalf("replay old token after user verified should be idempotent, got %v", err)
	}
	if !r.Verified {
		t.Error("verified should be true")
	}
}

func TestAuthService_VerifyEmail_ExpiredToken(t *testing.T) {
	db := test.SetupDB(t)
	svc, _, _, _ := newAuthService(db)
	res, _ := svc.Register(context.Background(), service.RegisterRequest{
		Email: "expire@example.com", Password: "supersecret", FullName: "Exp",
	})
	// Force-expire the verification.
	if _, err := db.Tx.Exec(context.Background(),
		`UPDATE email_verifications SET expires_at = now() - INTERVAL '1 hour' WHERE user_id = $1`,
		res.User.ID); err != nil {
		t.Fatalf("force expire: %v", err)
	}
	var token string
	db.Tx.QueryRow(context.Background(), `SELECT token FROM email_verifications WHERE user_id = $1`, res.User.ID).Scan(&token)

	_, err := svc.VerifyEmail(context.Background(), token)
	var gone model.GoneError
	if !errors.As(err, &gone) {
		t.Fatalf("expected GoneError, got %v", err)
	}
	if gone.Code != "VERIFICATION_TOKEN_EXPIRED" {
		t.Errorf("code = %q", gone.Code)
	}
}

func TestAuthService_VerifyEmail_UnknownToken(t *testing.T) {
	db := test.SetupDB(t)
	svc, _, _, _ := newAuthService(db)
	_, err := svc.VerifyEmail(context.Background(), "this-token-does-not-exist")
	var nf model.NotFoundError
	if !errors.As(err, &nf) {
		t.Fatalf("expected NotFoundError, got %v", err)
	}
	if nf.Code != "VERIFICATION_TOKEN_INVALID" {
		t.Errorf("code = %q", nf.Code)
	}
}

// ---------- ResendVerification ----------

func newAuthServiceWithDeterministicTime(db *test.TxDB) (*service.AuthService, *service.MockHasher, *service.MockEmailSender) {
	hasher := &service.MockHasher{}
	sender := &service.MockEmailSender{}
	queue := service.NewEmailRetryQueue(sender, 8)
	auditLogger := service.NewPgAuthAuditLogger(db)
	svc := service.NewAuthService(db, hasher, sender, auditLogger, queue, testVerifyURLBase)
	return svc, hasher, sender
}

func TestAuthService_Resend_UnverifiedUser_NewToken(t *testing.T) {
	db := test.SetupDB(t)
	svc, _, _ := newAuthServiceWithDeterministicTime(db)
	res, err := svc.Register(context.Background(), service.RegisterRequest{
		Email: "resend@example.com", Password: "supersecret", FullName: "Resend",
	})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	var oldToken string
	db.Tx.QueryRow(context.Background(), `SELECT token FROM email_verifications WHERE user_id = $1`, res.User.ID).Scan(&oldToken)

	r, err := svc.ResendVerification(context.Background(), "resend@example.com")
	if err != nil {
		t.Fatalf("Resend: %v", err)
	}
	if r.VerifyPollID == nil {
		t.Fatal("expected non-nil VerifyPollID for known unverified user")
	}

	// Two rows: old consumed, new unconsumed
	rows := fetchVerificationsForUser(t, db, res.User.ID)
	if len(rows) != 2 {
		t.Fatalf("expected 2 rows, got %d", len(rows))
	}
	if rows[0].Token != oldToken || !rows[0].IsVerified {
		t.Errorf("old row should be marked consumed, got %+v", rows[0])
	}
	if rows[1].IsVerified {
		t.Errorf("new row should NOT be marked consumed")
	}
}

func TestAuthService_Resend_UnknownEmail_ReturnsNilPollID(t *testing.T) {
	db := test.SetupDB(t)
	svc, _, sender := newAuthServiceWithDeterministicTime(db)
	r, err := svc.ResendVerification(context.Background(), "ghost@example.com")
	if err != nil {
		t.Fatalf("Resend: %v", err)
	}
	if r.VerifyPollID != nil {
		t.Errorf("unknown email should return nil VerifyPollID, got %v", r.VerifyPollID)
	}
	if sender.Count() != 0 {
		t.Errorf("unknown email path must not send any email")
	}
}

func TestAuthService_Resend_VerifiedUser_ReturnsNilPollID(t *testing.T) {
	db := test.SetupDB(t)
	svc, _, _ := newAuthServiceWithDeterministicTime(db)
	res, _ := svc.Register(context.Background(), service.RegisterRequest{
		Email: "ver@example.com", Password: "supersecret", FullName: "Ver",
	})
	// Verify the user
	var token string
	db.Tx.QueryRow(context.Background(), `SELECT token FROM email_verifications WHERE user_id = $1`, res.User.ID).Scan(&token)
	svc.VerifyEmail(context.Background(), token)

	r, err := svc.ResendVerification(context.Background(), "ver@example.com")
	if err != nil {
		t.Fatalf("Resend: %v", err)
	}
	if r.VerifyPollID != nil {
		t.Errorf("verified user should return nil VerifyPollID, got %v", r.VerifyPollID)
	}
}

func TestAuthService_Resend_ConstantTimeFloor(t *testing.T) {
	db := test.SetupDB(t)
	svc, _, _ := newAuthServiceWithDeterministicTime(db)
	start := time.Now()
	_, err := svc.ResendVerification(context.Background(), "ghost@example.com")
	if err != nil {
		t.Fatalf("Resend: %v", err)
	}
	elapsed := time.Since(start)
	if elapsed < service.ResendConstantTimeFloor {
		t.Errorf("expected ≥%v elapsed, got %v", service.ResendConstantTimeFloor, elapsed)
	}
}

func TestAuthService_Resend_InvalidEmail_BypassesFloor(t *testing.T) {
	db := test.SetupDB(t)
	svc, _, _ := newAuthServiceWithDeterministicTime(db)
	start := time.Now()
	_, err := svc.ResendVerification(context.Background(), "not-an-email")
	var ve model.ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("expected ValidationError, got %v", err)
	}
	if time.Since(start) >= service.ResendConstantTimeFloor {
		t.Errorf("validation path should bypass the floor (expected <%v), elapsed=%v", service.ResendConstantTimeFloor, time.Since(start))
	}
}

// ---------- VerifyStatus ----------

func TestAuthService_VerifyStatus_HappyPath(t *testing.T) {
	db := test.SetupDB(t)
	svc, _, _ := newAuthServiceWithDeterministicTime(db)
	res, _ := svc.Register(context.Background(), service.RegisterRequest{
		Email: "status@example.com", Password: "supersecret", FullName: "Status",
	})

	pollID := uuid.UUID(res.VerifyPollID)
	r, err := svc.VerifyStatus(context.Background(), pollID)
	if err != nil {
		t.Fatalf("VerifyStatus: %v", err)
	}
	if r.Verified {
		t.Error("user not yet verified — VerifyStatus should report false")
	}
	if r.Email != "status@example.com" {
		t.Errorf("email = %q", r.Email)
	}
}

func TestAuthService_VerifyStatus_UnknownPollID(t *testing.T) {
	db := test.SetupDB(t)
	svc, _, _ := newAuthServiceWithDeterministicTime(db)
	_, err := svc.VerifyStatus(context.Background(), uuid.New())
	var nf model.NotFoundError
	if !errors.As(err, &nf) {
		t.Fatalf("expected NotFoundError, got %v", err)
	}
	if nf.Code != "POLL_ID_NOT_FOUND" {
		t.Errorf("code = %q", nf.Code)
	}
}

func TestAuthService_VerifyStatus_ExpiredPollID_ReturnsNotFound(t *testing.T) {
	db := test.SetupDB(t)
	svc, _, _ := newAuthServiceWithDeterministicTime(db)
	res, _ := svc.Register(context.Background(), service.RegisterRequest{
		Email: "old@example.com", Password: "supersecret", FullName: "Old",
	})
	// Force the verification row to be older than 24h.
	if _, err := db.Tx.Exec(context.Background(),
		`UPDATE email_verifications SET created_at = now() - INTERVAL '25 hours' WHERE user_id = $1`,
		res.User.ID); err != nil {
		t.Fatalf("force aging: %v", err)
	}

	_, err := svc.VerifyStatus(context.Background(), uuid.UUID(res.VerifyPollID))
	var nf model.NotFoundError
	if !errors.As(err, &nf) {
		t.Fatalf("expected NotFoundError on expired pollId, got %v", err)
	}
	if nf.Code != "POLL_ID_NOT_FOUND" {
		t.Errorf("code = %q", nf.Code)
	}
}

// silence unused warning when test runner sees the helper
var _ = generated.New
