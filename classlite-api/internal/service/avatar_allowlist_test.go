// Story 9.4 (D8) — per-feature MIME allowlist + avatar size cap unit tests.
package service

import "testing"

func TestFeatureAllowsExtension_Avatars(t *testing.T) {
	cases := []struct {
		feature string
		ext     string
		want    bool
		why     string
	}{
		{FeatureAvatars, ".png", true, "png is an allowed avatar type"},
		{FeatureAvatars, ".jpg", true, "jpg is an allowed avatar type"},
		{FeatureAvatars, ".jpeg", true, "jpeg is an allowed avatar type"},
		{FeatureAvatars, ".webp", true, "webp was unallowlisted before 9.4 (D8) — now allowed"},
		{FeatureAvatars, ".svg", false, "SVG must be REJECTED for avatars (stored-SVG XSS)"},
		{FeatureAvatars, ".pdf", false, "pdf is not an image"},
		// Knowledge keeps its WIDE behavior — SVG still allowed there (D8 the whole point).
		{FeatureKnowledge, ".svg", true, "SVG stays allowed for Knowledge Hub"},
		{FeatureKnowledge, ".pdf", true, "pdf stays allowed for Knowledge Hub"},
	}
	for _, c := range cases {
		if got := FeatureAllowsExtension(c.feature, c.ext); got != c.want {
			t.Errorf("FeatureAllowsExtension(%q, %q) = %v, want %v — %s", c.feature, c.ext, got, c.want, c.why)
		}
	}
}

func TestWebpGloballyAllowlisted(t *testing.T) {
	if mime, ok := AllowedExtensions[".webp"]; !ok || mime != "image/webp" {
		t.Fatalf(".webp must map to image/webp globally (D8), got %q ok=%v", mime, ok)
	}
}

func TestMaxUploadBytes_Avatars5MB(t *testing.T) {
	got, ok := MaxUploadBytes(FeatureAvatars, ".png")
	if !ok {
		t.Fatal("avatars feature should have a size cap")
	}
	if want := int64(5 * 1024 * 1024); got != want {
		t.Fatalf("avatar cap = %d, want %d (5 MB)", got, want)
	}
}
