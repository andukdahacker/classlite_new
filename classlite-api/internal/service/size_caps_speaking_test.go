// Story 5.4 Task 1 (AC5,16, D3) — ATDD RED. The A9 25 MB speaking-audio cap.
//
// `.webm` is SHARED between listening (100 MB) and speaking (25 MB), so the cap
// MUST be disambiguated by feature — `MaxUploadBytes` can no longer key by
// extension alone. `.m4a` (iOS Safari's MediaRecorder container, D1) is newly
// allowlisted → `audio/mp4`, and capped at 25 MB under the speaking feature.
package service

import "testing"

func TestMaxUploadBytes_SpeakingCap(t *testing.T) {
	const wantSpeaking = 25 * 1024 * 1024
	const wantListening = 100 * 1024 * 1024

	cases := []struct {
		name    string
		feature string
		ext     string
		want    int64
		wantOK  bool
	}{
		// Speaking overrides the shared audio extensions to 25 MB.
		{"speaking webm → 25MB", "speaking", ".webm", wantSpeaking, true},
		{"speaking m4a → 25MB", "speaking", ".m4a", wantSpeaking, true},
		// Non-speaking audio keeps the 100 MB listening cap (NO regression).
		{"knowledge webm → 100MB", "knowledge", ".webm", wantListening, true},
		{"knowledge mp3 → 100MB", "knowledge", ".mp3", wantListening, true},
		{"knowledge wav → 100MB", "knowledge", ".wav", wantListening, true},
		// Non-audio caps untouched.
		{"knowledge pdf → 50MB", "knowledge", ".pdf", 50 * 1024 * 1024, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := MaxUploadBytes(tc.feature, tc.ext)
			if ok != tc.wantOK {
				t.Fatalf("MaxUploadBytes(%q,%q) ok = %v, want %v", tc.feature, tc.ext, ok, tc.wantOK)
			}
			if got != tc.want {
				t.Errorf("MaxUploadBytes(%q,%q) = %d, want %d", tc.feature, tc.ext, got, tc.want)
			}
		})
	}
}

// TestAllowedExtensions_M4A proves `.m4a` is allowlisted with its canonical MIME
// (D1). The presign exact-MIME lock rejects any other Content-Type for `.m4a`.
func TestAllowedExtensions_M4A(t *testing.T) {
	mime, ok := AllowedExtensions[".m4a"]
	if !ok {
		t.Fatal("`.m4a` must be allowlisted for speaking (iOS Safari records audio/mp4)")
	}
	if mime != "audio/mp4" {
		t.Errorf("`.m4a` canonical MIME = %q, want audio/mp4", mime)
	}
}
