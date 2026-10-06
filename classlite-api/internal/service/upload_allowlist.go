// Story 4.4a — the presigned-upload allowlist + object-key parsing shared by
// the presign handler (before signing) and the confirm path (HeadObject
// re-validation). Centralized here (was handler-local in Story 1.2e) so the
// server-side MIME allowlist + extension↔Content-Type lock live in ONE place
// (SEC-8 / A10) and both entry points agree byte-for-byte.
package service

import (
	"path/filepath"
	"strings"
)

// FeatureKnowledge is the object-key feature segment for Knowledge Hub uploads.
// A confirmed `knowledge` upload creates a `files` row (AC4); other features
// (imports/speaking/avatars) verify + return metadata without a Hub file.
const FeatureKnowledge = "knowledge"

// FeatureSpeaking is the object-key feature segment for a student's in-browser
// speaking recording (Story 5.4). A confirmed speaking upload writes no `files`
// row (verify-only), so the authoritative A9 25 MB cap gate lives on the
// mandatory /progress path. This is a named constant so the security-relevant
// feature checks in the confirm re-check (upload_handler) and the /progress gate
// (submission_service) cannot silently drift on a typo'd literal.
const FeatureSpeaking = "speaking"

// FeatureAvatars is the object-key feature segment for a user's profile avatar
// (Story 9.4). A confirmed avatar upload writes no `files` row (verify-only);
// the authoritative size/type re-check (D7) runs in the user service on persist
// (HeadObject), because the avatar flow skips POST /api/uploads/confirm. Named
// constant so the per-feature allowlist (D8), the 5 MB cap, and the service-side
// prefix guard cannot drift on a typo'd literal.
const FeatureAvatars = "avatars"

// AllowedExtensions maps a lower-cased file extension to its single canonical
// MIME type. The presign path rejects any extension absent from this map and
// rejects a Content-Type that does not match the extension's canonical type
// (A10 #3). `.jpeg` and `.jpg` share image/jpeg.
var AllowedExtensions = map[string]string{
	".pdf":  "application/pdf",
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".svg":  "image/svg+xml",
	// Story 9.4 (D8) — `.webp` was unallowlisted, so a presign for a WebP avatar
	// was rejected outright. Added globally (any feature may presign it); the
	// per-feature avatar subset below is what keeps SVG out of avatars.
	".webp": "image/webp",
	".mp3":  "audio/mpeg",
	".wav":  "audio/wav",
	".webm": "audio/webm",
	// Story 5.4 (D1) — iOS Safari's MediaRecorder emits `audio/mp4` (not webm),
	// so a speaking recording lands as `.m4a`. Audio-specific canonical MIME; we
	// deliberately do NOT allowlist `.mp4` (video-ambiguous). Note the widening:
	// `.m4a` is now globally allowlisted (any feature could presign it, capped at
	// the 100 MB listening default for non-speaking) — consistent with `.webm`
	// already being global.
	".m4a": "audio/mp4",
	// Story 2.7 — bulk student import spreadsheets (feature `imports`).
	".csv":  "text/csv",
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

// AllowedFeatures is the set of object-key feature segments the presign path
// accepts. Reserved slugs are wired as features land.
var AllowedFeatures = map[string]bool{
	FeatureKnowledge: true,
	FeatureSpeaking:  true,
	"avatars":        true,
	"imports":        true, // Story 2.7 — bulk student import uploads.
}

// FeatureAllowedExtensions restricts specific features to a SUBSET of the global
// AllowedExtensions. The global map asserts "this ext↔MIME pair is valid
// somewhere"; a per-feature entry asserts "this feature accepts ONLY these
// exts". A feature ABSENT from this map falls back to the full global allowlist
// (knowledge / imports / speaking keep their current wide behavior). Story 9.4
// (D8): avatars ⊆ {png, jpeg, webp} so SVG is rejected for AVATARS (stored-SVG
// XSS) WITHOUT loosening SVG for the Knowledge Hub — the global allowlist alone
// could not express that distinction.
var FeatureAllowedExtensions = map[string]map[string]bool{
	FeatureAvatars: {".png": true, ".jpg": true, ".jpeg": true, ".webp": true},
}

// FeatureAllowsExtension reports whether `feature` accepts `ext`. It first
// requires the ext to be globally allowlisted (ext↔MIME known), then — if the
// feature declares a per-feature subset — requires membership in that subset.
// ext is matched case-insensitively and includes the leading dot.
func FeatureAllowsExtension(feature, ext string) bool {
	ext = strings.ToLower(ext)
	if _, ok := AllowedExtensions[ext]; !ok {
		return false
	}
	if subset, ok := FeatureAllowedExtensions[feature]; ok {
		return subset[ext]
	}
	return true
}

// ParseObjectKey splits an R2 key of the form {center_id}/{feature}/{uuid}.{ext}
// into its parts. ok is false when the key is not in that shape or has no
// extension. ext is lower-cased and includes the leading dot.
func ParseObjectKey(key string) (centerID, feature, ext string, ok bool) {
	parts := strings.SplitN(key, "/", 3)
	if len(parts) < 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return "", "", "", false
	}
	ext = strings.ToLower(filepath.Ext(parts[2]))
	if ext == "" {
		return "", "", "", false
	}
	return parts[0], parts[1], ext, true
}
