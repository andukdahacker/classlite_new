// Story 4.5 — MigrateJSONB ladder units (AC3, AC4). Pure functions, no DB.
//
// The ladder ships with ZERO production upgraders (every entity is v1). These
// synthetic 1→2→3 upgraders exist ONLY to prove the mechanism: stepwise order,
// gap rejection, bounds, no-op at current, and the per-rung contract that a
// type-erased (RawMessage→RawMessage) chain cannot enforce at compile time.
package model

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"
)

// --- synthetic multi-version entity (test-only) ---

type synthV1 struct {
	Name string `json:"name"`
}

type synthV2 struct {
	Name     string `json:"name"`
	FullName string `json:"fullName"`
}

// synthV3 is the "current" synthetic struct: it DROPS name and adds revision.
type synthV3 struct {
	FullName string `json:"fullName"`
	Revision int    `json:"revision"`
}

const synthCurrentVersion = 3

// synthUpgrade1to2 derives fullName from name (an additive rung).
func synthUpgrade1to2(raw json.RawMessage) (json.RawMessage, error) {
	var in synthV1
	if err := json.Unmarshal(raw, &in); err != nil {
		return nil, err
	}
	return json.Marshal(synthV2{Name: in.Name, FullName: in.Name + " (full)"})
}

// synthUpgrade2to3 drops name and stamps revision (a reshaping rung — the kind
// that can silently drop a field if a rung is authored wrong; AC4 guards it).
func synthUpgrade2to3(raw json.RawMessage) (json.RawMessage, error) {
	var in synthV2
	if err := json.Unmarshal(raw, &in); err != nil {
		return nil, err
	}
	return json.Marshal(synthV3{FullName: in.FullName, Revision: synthCurrentVersion})
}

func synthUpgraders() map[int]UpgradeFunc {
	return map[int]UpgradeFunc{
		1: synthUpgrade1to2,
		2: synthUpgrade2to3,
	}
}

func TestMigrateJSONB_AppliesFullChainToCurrent(t *testing.T) {
	raw := json.RawMessage(`{"name":"Bob"}`)
	out, err := MigrateJSONB(raw, 1, synthCurrentVersion, synthUpgraders())
	if err != nil {
		t.Fatalf("MigrateJSONB 1→%d: %v", synthCurrentVersion, err)
	}
	var got synthV3
	if err := json.Unmarshal(out, &got); err != nil {
		t.Fatalf("unmarshal current: %v", err)
	}
	want := synthV3{FullName: "Bob (full)", Revision: synthCurrentVersion}
	if got != want {
		t.Fatalf("chain result = %+v, want %+v", got, want)
	}
}

func TestMigrateJSONB_AppliesRungsInStepwiseOrder(t *testing.T) {
	var order []int
	ups := map[int]UpgradeFunc{
		1: func(raw json.RawMessage) (json.RawMessage, error) { order = append(order, 1); return raw, nil },
		2: func(raw json.RawMessage) (json.RawMessage, error) { order = append(order, 2); return raw, nil },
		3: func(raw json.RawMessage) (json.RawMessage, error) { order = append(order, 3); return raw, nil },
	}
	if _, err := MigrateJSONB(json.RawMessage(`{}`), 1, 4, ups); err != nil {
		t.Fatalf("stepwise run: %v", err)
	}
	if want := []int{1, 2, 3}; !reflect.DeepEqual(order, want) {
		t.Fatalf("rung order = %v, want %v (each rung once, v→v+1, no skip)", order, want)
	}
}

func TestMigrateJSONB_MissingRungIsGapError(t *testing.T) {
	// Register 1→2 only, then ask for 1→3: rung 2 is a gap → typed error, never
	// a silent skip or panic (AC4).
	ups := map[int]UpgradeFunc{1: synthUpgrade1to2}
	out, err := MigrateJSONB(json.RawMessage(`{"name":"Bob"}`), 1, 3, ups)
	if err == nil {
		t.Fatalf("expected a gap error for the missing 2→3 rung, got out=%s", out)
	}
	var svErr SchemaVersionError
	if !errors.As(err, &svErr) {
		t.Fatalf("gap error = %T (%v), want SchemaVersionError", err, err)
	}
}

func TestMigrateJSONB_FromBelowOneIsError(t *testing.T) {
	for _, from := range []int{0, -1} {
		if _, err := MigrateJSONB(json.RawMessage(`{}`), from, synthCurrentVersion, synthUpgraders()); err == nil {
			t.Fatalf("from=%d: expected error (fromVersion must be >= 1), got nil", from)
		}
	}
}

func TestMigrateJSONB_FromAheadOfCurrentIsError(t *testing.T) {
	if _, err := MigrateJSONB(json.RawMessage(`{}`), 4, synthCurrentVersion, synthUpgraders()); err == nil {
		t.Fatalf("from=4 current=%d: expected error (from ahead of current), got nil", synthCurrentVersion)
	}
}

func TestMigrateJSONB_FromEqualsCurrentIsNoOp(t *testing.T) {
	// An upgrader that would blow up if the ladder ran it — proves from==current
	// touches nothing and returns the blob byte-identical.
	poison := map[int]UpgradeFunc{
		synthCurrentVersion: func(json.RawMessage) (json.RawMessage, error) {
			t.Fatal("no rung must run when from == current")
			return nil, nil
		},
	}
	in := json.RawMessage(`{"fullName":"Bob","revision":3}`)
	out, err := MigrateJSONB(in, synthCurrentVersion, synthCurrentVersion, poison)
	if err != nil {
		t.Fatalf("no-op migrate: %v", err)
	}
	if string(out) != string(in) {
		t.Fatalf("no-op result = %s, want byte-identical %s", out, in)
	}
}

// TestMigrateJSONB_PerRungContract is the AC4 discipline the RawMessage→RawMessage
// signature cannot enforce at compile time: each rung's OUTPUT blob must unmarshal
// cleanly into the NEXT rung's expected input struct (and the final rung's output
// into the current typed struct) with no silently dropped field.
func TestMigrateJSONB_PerRungContract(t *testing.T) {
	// rung 1→2 output must decode into synthV2 (rung 2's input) with fields intact.
	v1 := json.RawMessage(`{"name":"Bob"}`)
	out12, err := synthUpgrade1to2(v1)
	if err != nil {
		t.Fatalf("rung 1→2: %v", err)
	}
	var asV2 synthV2
	if err := json.Unmarshal(out12, &asV2); err != nil {
		t.Fatalf("rung 1→2 output does not decode into synthV2 input: %v", err)
	}
	if asV2.Name != "Bob" || asV2.FullName != "Bob (full)" {
		t.Fatalf("rung 1→2 dropped/garbled a field: %+v", asV2)
	}

	// rung 2→3 output must decode into synthV3 (the current struct).
	out23, err := synthUpgrade2to3(out12)
	if err != nil {
		t.Fatalf("rung 2→3: %v", err)
	}
	var asV3 synthV3
	if err := json.Unmarshal(out23, &asV3); err != nil {
		t.Fatalf("final rung output does not decode into current synthV3: %v", err)
	}
	if asV3.FullName != "Bob (full)" || asV3.Revision != synthCurrentVersion {
		t.Fatalf("final rung dropped/garbled a field: %+v", asV3)
	}
}
