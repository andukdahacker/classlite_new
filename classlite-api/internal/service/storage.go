package service

import (
	"context"
	"strings"
	"time"

	"github.com/ducdo/classlite-api/internal/model"
)

// ObjectMeta contains metadata about a stored object.
type ObjectMeta struct {
	Key         string `json:"key"`
	ContentType string `json:"contentType"`
	Size        int64  `json:"size"`
}

// PresignGetOpts controls the response headers baked into a presigned GET URL.
// The zero value serves the object inline — the shape the Knowledge Hub preview
// relies on so one URL can back `<img>`/`<audio>`/`<embed>`. Forcing
// Attachment on that same URL would make browsers refuse to inline-render a
// PDF `<embed>`, so downloads use a distinct opted-in URL.
type PresignGetOpts struct {
	// Attachment forces Content-Disposition: attachment (a download) instead of
	// inline rendering.
	Attachment bool
	// Filename is the download name presented when Attachment is set. Empty
	// falls back to the object key's basename (a UUID). Ignored when Attachment
	// is false.
	Filename string
}

// StorageService abstracts object storage operations for presigned uploads.
type StorageService interface {
	// Presign generates a presigned PUT URL for direct browser upload.
	Presign(ctx context.Context, key, contentType string, expiry time.Duration) (string, error)

	// PresignGet generates a short-lived presigned GET URL for direct browser
	// download/preview of a stored object (Story 4.4b — Knowledge Hub file
	// preview). Like GetObject it bypasses RLS — the object key IS the access
	// boundary (SEC-8), so callers MUST enforce the tenant-key prefix guard
	// before invoking it. opts controls the response Content-Disposition: the
	// zero value serves inline (so one URL can back the preview tags), while
	// opts.Attachment forces a download under opts.Filename.
	PresignGet(ctx context.Context, key string, expiry time.Duration, opts PresignGetOpts) (string, error)

	// PresignGetOwned is the SEC-8-guarded inline GET presign (Story 5.5a). It
	// re-asserts the object key lives under the caller's own center prefix
	// (tc.CenterID+"/") BEFORE signing, then delegates to PresignGet — so the
	// object-key access boundary (SEC-8) lives in ONE auditable place shared by
	// every owned-artifact reader (submission audio playback, Knowledge Hub
	// inline preview). A foreign-prefix key returns KeyPrefixMismatchError (403
	// R2_KEY_PREFIX_MISMATCH) having signed nothing. Callers still enforce their
	// OWN upstream authz (role / ownership / enrollment) before invoking it.
	PresignGetOwned(ctx context.Context, key string, tc model.TenantContext, expiry time.Duration) (string, error)

	// HeadObject checks if an object exists and returns its metadata.
	HeadObject(ctx context.Context, key string) (*ObjectMeta, error)

	// GetObject downloads the full object body server-side (Story 2.7 — the
	// bulk-import parser reads the uploaded CSV/XLSX back off R2). It bypasses
	// RLS entirely — the object key IS the access boundary (SEC-8), so callers
	// MUST enforce the tenant-key prefix guard before invoking it.
	GetObject(ctx context.Context, key string) ([]byte, error)

	// Delete removes an object from storage (Story 4.4a). Best-effort cleanup on
	// the confirm delete-on-mismatch (AC9) and storage-full (AC12) paths: an
	// upload that fails post-PUT validation must not linger in R2. A Delete
	// failure is surfaced (not swallowed) so the caller can emit the
	// `orphaned_object` telemetry counter for a later reaper sweep.
	Delete(ctx context.Context, key string) error
}

// presignGetOwned is the single implementation of the SEC-8 owned-GET invariant
// shared by every StorageService implementation (R2 + mock): a key MUST live
// under the caller's center prefix before an inline GET is signed. Kept as a
// free function (not duplicated per impl) so the prefix guard has exactly one
// auditable home (Story 5.5a — Winston STRONG).
func presignGetOwned(ctx context.Context, s StorageService, key string, tc model.TenantContext, expiry time.Duration) (string, error) {
	if !strings.HasPrefix(key, tc.CenterID+"/") {
		return "", KeyPrefixMismatchError{}
	}
	return s.PresignGet(ctx, key, expiry, PresignGetOpts{})
}
