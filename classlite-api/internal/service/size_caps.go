// Story 4.4a — the locked A9 per-file size caps (named constants, CQ-3). Shared
// by the presign size pre-check (layer 2, before signing) and the confirm
// HeadObject re-validation (layer 4, authoritative — layer 3's signed
// Content-Length-Range was DROPPED after the T3a spike found R2 does not
// enforce it on an S3-compatible presigned PUT).
package service

import "strings"

// A9 per-file caps. MiB, not decimal MB — 50 MB PDF = 50 * 1024 * 1024.
const (
	knowledgePDFMaxBytes   int64 = 50 * 1024 * 1024  // Knowledge Hub PDF
	knowledgeImageMaxBytes int64 = 15 * 1024 * 1024  // PNG / JPG / SVG
	listeningAudioMaxBytes int64 = 100 * 1024 * 1024 // MP3 / WAV / WebM
)

// oneMiB converts a byte cap to whole MB for the 413 FILE_TOO_LARGE message
// (AC6 requires the cap surfaced in MB so the UI can render it).
const oneMiB = 1024 * 1024

// uploadSizeCaps keys the A9 cap by extension. The caps are extension-driven —
// each extension belongs to exactly one feature class, so no (feature, ext)
// tuple is needed to disambiguate. `.csv`/`.xlsx` reuse the import parse cap.
var uploadSizeCaps = map[string]int64{
	".pdf":  knowledgePDFMaxBytes,
	".png":  knowledgeImageMaxBytes,
	".jpg":  knowledgeImageMaxBytes,
	".jpeg": knowledgeImageMaxBytes,
	".svg":  knowledgeImageMaxBytes,
	".mp3":  listeningAudioMaxBytes,
	".wav":  listeningAudioMaxBytes,
	".webm": listeningAudioMaxBytes,
	".csv":  maxImportFileBytes,
	".xlsx": maxImportFileBytes,
}

// MaxUploadBytes returns the A9 size cap for a (feature, ext) upload and whether
// the extension is recognized. feature is accepted for call-site clarity and
// future per-feature overrides; today the cap is keyed by extension alone.
func MaxUploadBytes(feature, ext string) (int64, bool) {
	cap, ok := uploadSizeCaps[strings.ToLower(ext)]
	return cap, ok
}
