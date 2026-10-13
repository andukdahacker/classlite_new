package seed

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// CredentialsEntry is one raw login input 11-2 POSTs to /api/auth/login. It is
// DISTINCT from the .playwright/auth.json session blob (11-2's output). Field
// names are camelCase for the TypeScript/Playwright consumer.
type CredentialsEntry struct {
	Role            string `json:"role"`
	Email           string `json:"email"`
	Password        string `json:"password"`
	CenterShortCode string `json:"centerShortCode"`
	CenterID        string `json:"centerId"`
}

// WriteCredentials serializes one entry per seeded role across both tenants to
// path (creating parent dirs), 0600 since it holds plaintext passwords.
func WriteCredentials(result *Result, path string) error {
	if result == nil {
		return fmt.Errorf("write credentials: result is nil")
	}
	// Non-nil init so an empty result serializes to `[]`, never JSON `null` —
	// 11-2's TypeScript consumer iterates the array and would throw on null.
	entries := []CredentialsEntry{}
	for _, c := range result.Centers {
		for _, m := range c.Members {
			entries = append(entries, CredentialsEntry{
				Role:            m.Role,
				Email:           m.Email,
				Password:        m.Password,
				CenterShortCode: c.ShortCode,
				CenterID:        c.ID,
			})
		}
	}
	raw, err := json.MarshalIndent(entries, "", "  ")
	if err != nil {
		return fmt.Errorf("write credentials: marshal: %w", err)
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("write credentials: mkdir: %w", err)
	}
	// Atomic write: a crash mid-write must never leave a truncated creds file the
	// next consumer reads as corrupt JSON. Write a temp sibling, then rename.
	tmp, err := os.CreateTemp(dir, ".credentials-*.json.tmp")
	if err != nil {
		return fmt.Errorf("write credentials: create temp: %w", err)
	}
	tmpName := tmp.Name()
	defer func() { _ = os.Remove(tmpName) }() // no-op after a successful rename
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("write credentials: chmod temp: %w", err)
	}
	if _, err := tmp.Write(raw); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("write credentials: write temp: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("write credentials: close temp: %w", err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("write credentials: rename %s: %w", path, err)
	}
	return nil
}

// fataler is the minimal *testing.T surface RepoRoot needs, so this production
// package does not import the testing package. A *testing.T satisfies it.
type fataler interface {
	Helper()
	Fatalf(format string, args ...any)
}

// RepoRoot walks up from the working directory to the repository root — the
// nearest ancestor that contains BOTH a .gitignore and a classlite-api/
// directory — so tests can resolve repo-relative paths (e.g. .gitignore, the
// credentials dir) regardless of which package directory `go test` runs from.
func RepoRoot(t fataler) string {
	t.Helper()
	root, err := FindRepoRoot()
	if err != nil {
		t.Fatalf("repo root: %v", err)
		return ""
	}
	return root
}

// FindRepoRoot is the non-testing resolver RepoRoot and cmd/seed share: the
// nearest ancestor of the working directory containing both .gitignore and a
// classlite-api/ directory.
func FindRepoRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("getwd: %w", err)
	}
	for {
		_, gitignoreErr := os.Stat(filepath.Join(dir, ".gitignore"))
		apiInfo, apiErr := os.Stat(filepath.Join(dir, "classlite-api"))
		if gitignoreErr == nil && apiErr == nil && apiInfo.IsDir() {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("no ancestor with .gitignore + classlite-api/ found from working dir")
		}
		dir = parent
	}
}
