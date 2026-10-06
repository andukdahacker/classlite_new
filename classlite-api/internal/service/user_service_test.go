// Story 9.4 — ChangePassword unit tests (white-box: they set the unexported
// cpStore seam to a hand-written fake, the repo idiom for MockHasher/-Storage).
//
// AC10(b)(1) — the mock-store-seam proof that a password CHANGE never calls
// DeleteAllRefreshTokensForUser (the contrast with password RESET, AC4). AC4 —
// wrong-current typed, OAuth-null-hash typed non-500, no-tx hashing.
package service

import (
	"context"
	"errors"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// fakeChangePasswordStore is the hand-written seam (no testify in this repo). It
// INCLUDES DeleteAllRefreshTokensForUser so the test can prove it is never
// invoked — the equivalent of testify's AssertNotCalled.
type fakeChangePasswordStore struct {
	user         generated.User
	getErr       error
	updateCalls  int
	deleteCalls  int
	lastPassHash string
}

func (f *fakeChangePasswordStore) GetUserByID(_ context.Context, _ pgtype.UUID) (generated.User, error) {
	if f.getErr != nil {
		return generated.User{}, f.getErr
	}
	return f.user, nil
}

func (f *fakeChangePasswordStore) UpdateUserPassword(_ context.Context, arg generated.UpdateUserPasswordParams) error {
	f.updateCalls++
	f.lastPassHash = arg.PasswordHash.String
	return nil
}

func (f *fakeChangePasswordStore) DeleteAllRefreshTokensForUser(_ context.Context, _ pgtype.UUID) error {
	f.deleteCalls++
	return nil
}

func newChangePasswordSvc(t *testing.T, fake *fakeChangePasswordStore) *UserService {
	t.Helper()
	svc := &UserService{
		hasher:  BcryptHasher{Cost: 4},
		clk:     clock.RealClock{},
		cpStore: fake,
	}
	return svc
}

func userWithPassword(t *testing.T, plaintext string) (generated.User, pgtype.UUID) {
	t.Helper()
	hash, err := (BcryptHasher{Cost: 4}).Hash([]byte(plaintext))
	if err != nil {
		t.Fatalf("hash fixture password: %v", err)
	}
	id := pgtype.UUID{Bytes: uuid.New(), Valid: true}
	return generated.User{
		ID:           id,
		PasswordHash: pgtype.Text{String: string(hash), Valid: true},
	}, id
}

func selfTC(id pgtype.UUID) model.TenantContext {
	return model.TenantContext{UserID: uuid.UUID(id.Bytes).String(), CenterID: uuid.NewString(), EmailVerified: true}
}

func TestChangePassword_DoesNotDeleteRefreshTokens(t *testing.T) {
	user, id := userWithPassword(t, "current-pass-123")
	fake := &fakeChangePasswordStore{user: user}
	svc := newChangePasswordSvc(t, fake)

	if err := svc.ChangePassword(context.Background(), selfTC(id), "current-pass-123", "a-brand-new-pass-456"); err != nil {
		t.Fatalf("ChangePassword: unexpected error: %v", err)
	}
	// AC4 / AC10b(1) — the password was rewritten but NO session nuke happened.
	if fake.updateCalls != 1 {
		t.Fatalf("expected 1 UpdateUserPassword call, got %d", fake.updateCalls)
	}
	if fake.deleteCalls != 0 {
		t.Fatalf("AC4 VIOLATION: ChangePassword called DeleteAllRefreshTokensForUser %d time(s) — other sessions must survive", fake.deleteCalls)
	}
	if fake.lastPassHash == user.PasswordHash.String {
		t.Fatal("expected a freshly-hashed password, got the old hash")
	}
}

func TestChangePassword_WrongCurrentTyped(t *testing.T) {
	user, id := userWithPassword(t, "the-real-current")
	fake := &fakeChangePasswordStore{user: user}
	svc := newChangePasswordSvc(t, fake)

	err := svc.ChangePassword(context.Background(), selfTC(id), "WRONG-current", "a-brand-new-pass-456")
	var typed *InvalidCurrentPasswordError
	if !errors.As(err, &typed) {
		t.Fatalf("expected *InvalidCurrentPasswordError, got %v", err)
	}
	if fake.updateCalls != 0 {
		t.Fatalf("AC4 VIOLATION: a wrong current password still wrote a new one (%d calls)", fake.updateCalls)
	}
	if fake.deleteCalls != 0 {
		t.Fatalf("a wrong current password must not touch refresh tokens (%d calls)", fake.deleteCalls)
	}
}

func TestChangePassword_OAuthNullHashTyped(t *testing.T) {
	id := pgtype.UUID{Bytes: uuid.New(), Valid: true}
	fake := &fakeChangePasswordStore{user: generated.User{ID: id, PasswordHash: pgtype.Text{Valid: false}}}
	svc := newChangePasswordSvc(t, fake)

	err := svc.ChangePassword(context.Background(), selfTC(id), "anything", "a-brand-new-pass-456")
	var typed *PasswordNotSetError
	if !errors.As(err, &typed) {
		t.Fatalf("AC4 VIOLATION: OAuth-only user must get a typed *PasswordNotSetError (not a 500), got %v", err)
	}
	if fake.updateCalls != 0 || fake.deleteCalls != 0 {
		t.Fatal("an OAuth-only account must not mutate any password/token state")
	}
}

func TestChangePassword_NewPasswordValidated(t *testing.T) {
	user, id := userWithPassword(t, "current-pass-123")
	fake := &fakeChangePasswordStore{user: user}
	svc := newChangePasswordSvc(t, fake)

	err := svc.ChangePassword(context.Background(), selfTC(id), "current-pass-123", "short")
	var verr model.ValidationError
	if !errors.As(err, &verr) {
		t.Fatalf("expected a ValidationError for a too-short new password, got %v", err)
	}
	if fake.updateCalls != 0 {
		t.Fatal("a too-short new password must not be written")
	}
}
