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
	".mp3":  "audio/mpeg",
	".wav":  "audio/wav",
	".webm": "audio/webm",
	// Story 2.7 — bulk student import spreadsheets (feature `imports`).
	".csv":  "text/csv",
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

// AllowedFeatures is the set of object-key feature segments the presign path
// accepts. Reserved slugs are wired as features land.
var AllowedFeatures = map[string]bool{
	FeatureKnowledge: true,
	"speaking":       true,
	"avatars":        true,
	"imports":        true, // Story 2.7 — bulk student import uploads.
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
