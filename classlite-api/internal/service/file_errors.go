// Story 4.4a — Knowledge Hub / upload-hardening typed errors. These are VALUE
// types (value receiver) so the mapper + tests match with
// errors.As(err, &service.XxxError{}) — consistent with the model.* legacy
// value errors, and required by the quota-race test's
// errors.As(err, &service.StorageFullError{}).
package service

import "fmt"

// StorageFullError → 409 STORAGE_FULL. used + requested exceeds the center
// ceiling. Enforced at confirm INSIDE the per-center serialized tx (AC12).
type StorageFullError struct {
	UsedBytes      int64
	LimitBytes     int64
	RequestedBytes int64
}

func (e StorageFullError) Error() string {
	return fmt.Sprintf("storage full: %d used + %d requested exceeds the %d byte ceiling",
		e.UsedBytes, e.RequestedBytes, e.LimitBytes)
}

// FileTooLargeError → 413 FILE_TOO_LARGE. The message surfaces the cap in MB so
// the UI can render it (AC6). Raised at presign (declared size, layer 2) and at
// confirm (stored size via HeadObject, layer 4 — authoritative).
type FileTooLargeError struct {
	Feature    string
	Ext        string
	LimitBytes int64
	GotBytes   int64
}

func (e FileTooLargeError) Error() string {
	return fmt.Sprintf("file exceeds the %d MB limit for %s uploads", e.LimitBytes/oneMiB, e.Ext)
}

// ContentTypeMismatchError → 422 CONTENT_TYPE_MISMATCH. The stored object's
// Content-Type (HeadObject) differs from the type locked into the presigned
// request — a client sidestepped the lock. The object is best-effort deleted.
type ContentTypeMismatchError struct {
	Expected string
	Got      string
}

func (e ContentTypeMismatchError) Error() string {
	return fmt.Sprintf("stored content type %q does not match the locked type %q", e.Got, e.Expected)
}

// UploadVerificationFailedError → 502 UPLOAD_VERIFICATION_FAILED. HeadObject
// returned a transport error (network/5xx), NOT a mismatch. Fail closed: no row,
// no delete (never phantom-delete an object that may be fine — AC9).
type UploadVerificationFailedError struct {
	Key string
}

func (e UploadVerificationFailedError) Error() string {
	return "could not verify the uploaded object with storage"
}

// KeyPrefixMismatchError → 403 R2_KEY_PREFIX_MISMATCH. The confirm key's
// {center_id} prefix does not match the caller's JWT tenant (AC9a). The handler
// audits this before returning; storage is never touched.
type KeyPrefixMismatchError struct{}

func (e KeyPrefixMismatchError) Error() string {
	return "object key does not belong to your center"
}

// FolderCycleError → 422 FOLDER_CYCLE. A move would place a folder inside its
// own descendant — the 4.4b tree render must terminate (AC2).
type FolderCycleError struct{}

func (e FolderCycleError) Error() string {
	return "cannot move a folder into its own descendant"
}

// FolderMaxDepthError → 422 FOLDER_MAX_DEPTH. A create/move would nest beyond
// the depth limit (AC2).
type FolderMaxDepthError struct {
	Max int
}

func (e FolderMaxDepthError) Error() string {
	return fmt.Sprintf("folder nesting exceeds the maximum depth of %d", e.Max)
}
