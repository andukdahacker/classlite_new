// Story 5.1 — the v1 `SubmissionContent` contract (architecture §JSONB, GO-7).
// Mirrors exercise_content.go. The attempt payload SHAPE is owned by the attempt
// UIs (5.2–5.4); 5.1 treats `content` as an opaque, losslessly round-tripped JSON
// object carried through the versioned ladder. The ladder is an EMPTY v1
// passthrough (no upgraders) — it exists so a future v2 reshape has a home and so
// migrate-on-read never fights Epic 6's immutability trigger (D6).
package store

import (
	"encoding/json"
	"fmt"

	"github.com/ducdo/classlite-api/internal/model"
)

// CurrentSubmissionSchemaVersion is the production current version (v1).
const CurrentSubmissionSchemaVersion = 1

var (
	currentSubmissionSchemaVersion = CurrentSubmissionSchemaVersion
	submissionUpgraders            = map[int]model.UpgradeFunc{}
)

// ActiveSubmissionSchemaVersion returns the version the ladder currently upgrades TO.
func ActiveSubmissionSchemaVersion() int { return currentSubmissionSchemaVersion }

// ValidateSubmissionUpgradeChain reports whether the active submission upgrader
// chain covers every rung in [from, to).
func ValidateSubmissionUpgradeChain(from, to int) error {
	return model.ValidateChain(from, to, submissionUpgraders)
}

// OverrideSubmissionSchemaForTest installs a synthetic current version + upgrader
// chain and returns a restore func. TEST-ONLY (not concurrency-safe).
func OverrideSubmissionSchemaForTest(current int, upgraders map[int]model.UpgradeFunc) func() {
	prevVersion, prevUpgraders := currentSubmissionSchemaVersion, submissionUpgraders
	currentSubmissionSchemaVersion = current
	submissionUpgraders = upgraders
	return func() {
		currentSubmissionSchemaVersion = prevVersion
		submissionUpgraders = prevUpgraders
	}
}

// MaxSubmissionContentBytes caps the serialized `content` blob a save-progress may
// persist. Enforced pre-decode via http.MaxBytesReader on the request body (the
// content dominates the tiny JSON envelope) → 413 PAYLOAD_TOO_LARGE (AC9).
const MaxSubmissionContentBytes = 256 * 1024

// SubmissionContent is the v1 JSONB `content` blob (GO-7 — a typed carrier with a
// schema_version). Raw holds the opaque attempt payload; 5.1 never interprets it,
// only validates it is a JSON object, bounds its size, and round-trips it through
// the ladder losslessly.
type SubmissionContent struct {
	SchemaVersion int
	raw           json.RawMessage
}

// InvalidSubmissionContentError is the typed error returned when a stored (or
// submitted) blob cannot be interpreted under its column version.
type InvalidSubmissionContentError struct {
	Version int
	Reason  string
}

func (e InvalidSubmissionContentError) Error() string {
	return fmt.Sprintf("invalid submission content (schema_version=%d): %s", e.Version, e.Reason)
}

// NewSubmissionContentShell builds the empty v1 shell ("{}") for a fresh attempt.
func NewSubmissionContentShell() SubmissionContent {
	return SubmissionContent{SchemaVersion: CurrentSubmissionSchemaVersion, raw: json.RawMessage("{}")}
}

// NewSubmissionContentFromRaw wraps a client-supplied content blob for a save. It
// validates the payload is a well-formed JSON object (not an array/scalar/NULL);
// the byte-cap is enforced upstream via MaxBytesReader (AC9). The returned value
// is stamped at the current version — a save always writes current shape.
func NewSubmissionContentFromRaw(raw []byte) (SubmissionContent, error) {
	if len(raw) == 0 {
		return SubmissionContent{}, InvalidSubmissionContentError{
			Version: currentSubmissionSchemaVersion,
			Reason:  "content is empty",
		}
	}
	if !json.Valid(raw) {
		return SubmissionContent{}, InvalidSubmissionContentError{
			Version: currentSubmissionSchemaVersion,
			Reason:  "content is not valid JSON",
		}
	}
	if !isJSONObject(raw) {
		return SubmissionContent{}, InvalidSubmissionContentError{
			Version: currentSubmissionSchemaVersion,
			Reason:  "content must be a JSON object",
		}
	}
	// Copy so a caller mutating the backing array cannot corrupt the stored blob.
	buf := make(json.RawMessage, len(raw))
	copy(buf, raw)
	return SubmissionContent{SchemaVersion: currentSubmissionSchemaVersion, raw: buf}, nil
}

// Marshal renders the content to JSONB bytes for an insert/update param. An empty
// carrier serializes to "{}" so the NOT NULL column never sees a zero blob.
func (c SubmissionContent) Marshal() ([]byte, error) {
	if len(c.raw) == 0 {
		return []byte("{}"), nil
	}
	return c.raw, nil
}

// RawJSON exposes the opaque payload for the wire response (the handler emits it
// verbatim as the `content` field).
func (c SubmissionContent) RawJSON() json.RawMessage {
	if len(c.raw) == 0 {
		return json.RawMessage("{}")
	}
	return c.raw
}

// UnmarshalSubmissionContent decodes a raw JSONB blob under the version taken from
// the `schema_version` COLUMN and routes it through model.MigrateJSONB. With the
// empty v1 upgrader map this is a validated passthrough. Read-transform-only: it
// NEVER writes the migrated shape back (D6) — callers persist migrated shape only
// for in_progress rows via an explicit save.
func UnmarshalSubmissionContent(raw []byte, version int) (SubmissionContent, error) {
	if version < 1 || version > currentSubmissionSchemaVersion {
		return SubmissionContent{}, InvalidSubmissionContentError{
			Version: version,
			Reason:  fmt.Sprintf("schema version out of range (accepted: 1..%d)", currentSubmissionSchemaVersion),
		}
	}
	if len(raw) == 0 {
		return SubmissionContent{}, InvalidSubmissionContentError{
			Version: version,
			Reason:  "content blob is empty/NULL",
		}
	}
	upgraded, err := model.MigrateJSONB(raw, version, currentSubmissionSchemaVersion, submissionUpgraders)
	if err != nil {
		return SubmissionContent{}, InvalidSubmissionContentError{
			Version: version,
			Reason:  err.Error(),
		}
	}
	if !json.Valid(upgraded) {
		return SubmissionContent{}, InvalidSubmissionContentError{
			Version: version,
			Reason:  "malformed JSON after migration",
		}
	}
	buf := make(json.RawMessage, len(upgraded))
	copy(buf, upgraded)
	return SubmissionContent{SchemaVersion: currentSubmissionSchemaVersion, raw: buf}, nil
}

// isJSONObject reports whether raw decodes to a JSON object (`{...}`), rejecting
// arrays, scalars, and null.
func isJSONObject(raw []byte) bool {
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(raw, &probe); err != nil {
		return false
	}
	// `null` unmarshals into a nil map with no error — reject it (and arrays/
	// scalars, which fail the unmarshal above).
	return probe != nil
}
