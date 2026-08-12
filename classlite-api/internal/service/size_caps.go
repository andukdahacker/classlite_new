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
	// speakingAudioMaxBytes is the A9 cap for a student's in-browser speaking
	// recording (Story 5.4, D3). Tighter than the 100 MB listening cap because a
	// short spoken response is small — and the client derives its max recording
	// duration from this budget so the ceiling is never discovered post-take
	// (AC7). `.webm`/`.m4a` are SHARED with listening (100 MB), so this cap can
	// only be selected by the `speaking` feature — see MaxUploadBytes.
	speakingAudioMaxBytes int64 = 25 * 1024 * 1024
)

// oneMiB converts a byte cap to whole MB for the 413 FILE_TOO_LARGE message
// (AC6 requires the cap surfaced in MB so the UI can render it).
const oneMiB = 1024 * 1024

// uploadSizeCaps keys the A9 cap by extension for every feature EXCEPT the
// per-feature overrides in MaxUploadBytes. Most extensions belong to exactly one
// feature class, so the extension alone disambiguates; the exception is the
// audio containers `.webm`/`.m4a`, which are shared between listening (100 MB via
// this map) and speaking (25 MB via the feature override). `.m4a` defaults to the
// listening cap here so a stray `.m4a` under a non-speaking feature is still
// bounded (Story 5.4). `.csv`/`.xlsx` reuse the import parse cap.
var uploadSizeCaps = map[string]int64{
	".pdf":  knowledgePDFMaxBytes,
	".png":  knowledgeImageMaxBytes,
	".jpg":  knowledgeImageMaxBytes,
	".jpeg": knowledgeImageMaxBytes,
	".svg":  knowledgeImageMaxBytes,
	".mp3":  listeningAudioMaxBytes,
	".wav":  listeningAudioMaxBytes,
	".webm": listeningAudioMaxBytes,
	".m4a":  listeningAudioMaxBytes,
	".csv":  maxImportFileBytes,
	".xlsx": maxImportFileBytes,
}

// MaxUploadBytes returns the A9 size cap for a (feature, ext) upload and whether
// the extension is recognized. The `speaking` feature overrides every audio
// container to the tighter 25 MB speaking cap (Story 5.4, D3) — this is the ONLY
// disambiguation of the `.webm`/`.m4a` extensions shared with 100 MB listening
// audio. All other features fall through to the extension-keyed map.
func MaxUploadBytes(feature, ext string) (int64, bool) {
	if feature == FeatureSpeaking {
		// A speaking recording is capped regardless of container. `ok=true`
		// because a speaking upload always carries an audio extension; an
		// unknown ext under `speaking` still gets the speaking ceiling (defense
		// in depth) rather than falling through to "no cap".
		return speakingAudioMaxBytes, true
	}
	cap, ok := uploadSizeCaps[strings.ToLower(ext)]
	return cap, ok
}
