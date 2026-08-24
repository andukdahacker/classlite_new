// Package media is a leaf capability: server-side audio transcoding of
// browser-recorded speaking clips into a Gemini-ingestible format.
//
// It has NO service/worker/store/DB import (mirrors internal/service/grading),
// so both the API and the 6-3b speaking-grade worker depend on it with no cycle.
// Bytes in → Gemini-ingestible bytes out; the caller enforces SEC-8/RLS before
// handing bytes here (Story 6.3b0).
//
// The core is AudioTranscoder (interface), FFmpegTranscoder (the real impl that
// shells out to a bundled ffmpeg over private, scrubbed temp files), and
// MockTranscoder (the downstream test seam 6-3b injects so real ffmpeg is banned
// in its worker suite). CheckFFmpegAvailable is the boot-time fail-fast check.
package media
