// Story 4.5 — the generic JSONB version-dispatch upgrade ladder (AC3, AC4).
//
// This is the ONE engine every column- or blob-versioned JSONB entity upgrades
// through on read. It lives in `package model` because the dependency direction
// is store → model (never the reverse; see ai_response.go), so both `store`
// (exercises, column-sourced) and `model` (onboarding, blob-sourced) can call
// it. Story 4.5 ships ZERO production upgraders — every entity is v1, so the
// chain is empty and v1 is a direct passthrough. The ladder, its guards, and
// its tests ARE the deliverable; a real vN→vN+1 rung is a future story's job.
//
// GO-7: schema migration happens at/below the store decode boundary before a
// typed struct reaches the service — the service never sees a legacy version.
// The GOVERNING INVARIANT (lazy read-path ladder = correctness, batch tool =
// optimization) is documented as the package doc of tools/jsonbmigrate.
package model

import (
	"encoding/json"
	"fmt"
)

// SchemaVersionError is the typed error MigrateJSONB returns for an out-of-range
// request or a missing rung. It is NEVER a panic — an unknown/corrupt version is
// a data condition each caller maps to its own surface (the store wraps it as
// InvalidExerciseContentError; the batch tool treats it as a poison-row abort).
type SchemaVersionError struct {
	From    int
	Current int
	Reason  string
}

// Error implements error. The message names the from/current versions so a log
// line or a 500 breadcrumb pins exactly which row/version pairing failed.
func (e SchemaVersionError) Error() string {
	return fmt.Sprintf("schema migration from v%d to v%d: %s", e.From, e.Current, e.Reason)
}

// UpgradeFunc transforms a JSONB blob from schema version v to v+1. It operates
// on raw bytes (type-erased) so the ladder needn't keep every historical vN Go
// struct alive forever ("struct archaeology") — the price of that erasure is a
// mandatory per-rung contract test (AC4) proving rung[v]'s output blob decodes
// cleanly into rung[v+1]'s expected input.
type UpgradeFunc func(json.RawMessage) (json.RawMessage, error)

// MigrateJSONB walks the upgrade chain from fromVersion to currentVersion,
// applying EXACTLY ONE rung per step (monotonic, never v→v+2), and returns the
// blob at currentVersion. upgraders[v] upgrades v→v+1; the caller does the final
// json.Unmarshal into its typed struct.
//
// The stepwise `for v := fromVersion; v < currentVersion; v++` loop STRUCTURALLY
// enforces the AC4 "one rung at a time, never skip" guarantee — a version can
// only advance through a registered rung. It returns a typed SchemaVersionError
// (never panics) when:
//   - fromVersion < 1                (a NULL/0 column reads as from<1)
//   - fromVersion > currentVersion   (a row ahead of the running code)
//   - a rung in [fromVersion, currentVersion) is missing (a gap)
//
// fromVersion == currentVersion is a no-op: raw is returned byte-identical and
// no upgrader runs (the v1-at-current common path pays nothing).
func MigrateJSONB(raw json.RawMessage, fromVersion, currentVersion int, upgraders map[int]UpgradeFunc) (json.RawMessage, error) {
	if err := ValidateChain(fromVersion, currentVersion, upgraders); err != nil {
		return nil, err
	}
	for v := fromVersion; v < currentVersion; v++ {
		upgraded, err := upgraders[v](raw)
		if err != nil {
			return nil, fmt.Errorf("apply schema upgrade v%d→v%d: %w", v, v+1, err)
		}
		raw = upgraded
	}
	return raw, nil
}

// ValidateChain checks the bounds and rung-coverage of an upgrade from
// fromVersion to currentVersion WITHOUT running any transform or touching a
// blob. It returns the same typed SchemaVersionError MigrateJSONB would (from<1,
// from>current, or a gap), so a caller can fail fast — e.g. the batch tool runs
// it once up front, turning a chain-configuration error into a clean pre-flight
// exit instead of a per-row "poison row" abort that mislabels a config gap as
// data corruption. fromVersion == currentVersion validates clean (no-op).
func ValidateChain(fromVersion, currentVersion int, upgraders map[int]UpgradeFunc) error {
	if fromVersion < 1 {
		return SchemaVersionError{From: fromVersion, Current: currentVersion, Reason: "fromVersion must be >= 1"}
	}
	if fromVersion > currentVersion {
		return SchemaVersionError{From: fromVersion, Current: currentVersion, Reason: "fromVersion is ahead of currentVersion"}
	}
	for v := fromVersion; v < currentVersion; v++ {
		if _, ok := upgraders[v]; !ok {
			return SchemaVersionError{
				From: fromVersion, Current: currentVersion,
				Reason: fmt.Sprintf("missing upgrader for v%d→v%d (gap in the chain)", v, v+1),
			}
		}
	}
	return nil
}
