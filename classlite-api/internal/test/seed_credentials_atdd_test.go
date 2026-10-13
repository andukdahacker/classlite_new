// seed_credentials_atdd_test.go — Story 11-1a ATDD (AC4 · DD3). The
// seed emits tests/e2e/.auth/credentials.json — the RAW login inputs 11-2 POSTs
// to /api/auth/login — DISTINCT from the .playwright/auth.json session blob
// (11-2's OUTPUT). The .auth/ dir is gitignored.
//
// RED: `//go:build atdd_red_phase`; compile-fails on the GREENFIELD internal/seed
// seams (Run, WriteCredentials, CredentialsEntry, DefaultCredentialsPath).
//
// GREEN SEAMS (dev — Task 3):
//
//	seed.DefaultCredentialsPath string — "tests/e2e/.auth/credentials.json"
//	seed.CredentialsEntry{ Role, Email, Password, CenterShortCode, CenterID string }
//	seed.WriteCredentials(result *seed.Result, path string) error
//	  — writes one entry per seeded role across both tenants.
package test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/seed"
)

// AC4 — credentials.json is emitted with one entry per seeded role, with the
// raw login inputs (incl. password), at the canonical .auth path.
func TestSeed_EmitsCredentialsJSON(t *testing.T) {
	cleanupSeedTenants(t)
	pool := SetupRawPool(t)
	ctx := context.Background()
	result, err := seed.Run(ctx, pool, seed.Options{Clean: true})
	if err != nil {
		t.Fatalf("seed run: %v", err)
	}

	path := filepath.Join(t.TempDir(), "credentials.json")
	if err := seed.WriteCredentials(result, path); err != nil {
		t.Fatalf("write credentials: %v", err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read credentials: %v", err)
	}
	var entries []seed.CredentialsEntry
	if err := json.Unmarshal(raw, &entries); err != nil {
		t.Fatalf("unmarshal credentials: %v", err)
	}

	roles := map[string]bool{}
	for _, e := range entries {
		if e.Email == "" || e.Password == "" || e.CenterID == "" || e.CenterShortCode == "" {
			t.Errorf("credentials entry incomplete: %+v", e)
		}
		roles[e.Role] = true
	}
	for _, want := range []string{"owner", "admin", "teacher", "student"} {
		if !roles[want] {
			t.Errorf("credentials.json missing a %q entry for 11-2 login", want)
		}
	}

	// DD3 — the canonical path is the .auth dir, distinct from .playwright/auth.json.
	if !strings.HasSuffix(seed.DefaultCredentialsPath, "tests/e2e/.auth/credentials.json") {
		t.Errorf("DefaultCredentialsPath should be the .auth login-input file, got %q", seed.DefaultCredentialsPath)
	}
	if strings.Contains(seed.DefaultCredentialsPath, ".playwright") {
		t.Errorf("credentials.json must NOT be the .playwright storageState blob (DD3)")
	}
}

// AC4 — tests/e2e/.auth/ is gitignored (raw creds never committed).
func TestSeed_AuthDirIsGitignored(t *testing.T) {
	// Repo root is two levels up from classlite-api/internal/test at run time;
	// resolve from the module root marker instead of hardcoding.
	root := repoRootFromGitignore(t)
	raw, err := os.ReadFile(filepath.Join(root, ".gitignore"))
	if err != nil {
		t.Fatalf("read .gitignore: %v", err)
	}
	if !strings.Contains(string(raw), "tests/e2e/.auth") {
		t.Errorf(".gitignore must ignore tests/e2e/.auth/ (raw credentials never committed, DD3)")
	}
}

// repoRootFromGitignore is a GREENFIELD helper the dev adds alongside the seed
// (or this test is relocated); referenced here to pin the gitignore assertion.
// RED: undefined until Task 3 — part of the documented compile-fail.
func repoRootFromGitignore(t *testing.T) string { return seed.RepoRoot(t) }
