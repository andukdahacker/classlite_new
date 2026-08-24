// Package gemini abstracts the Google Gemini generateContent API for Story
// 4.3a. The worker depends on the Client interface (the ONE worker mock seam);
// production uses a real HTTPS impl and every PR test injects a deterministic
// MockClient — a real Gemini call is banned from CI (test-design-qa.md:57).
//
// EDGE-4 / R49: GEMINI_API_KEY lives in the env/config only. It is never placed
// in a struct serialized to JSON, a health check, an error, or a log line. The
// real client sends it in the x-goog-api-key request HEADER (never the URL, so it
// cannot leak via proxy/LB/APM URL logging or a %w-wrapped request-build error);
// wrapped errors carry the HTTP status, never the key or the prompt/response body.
package gemini

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// maxResponseBytes caps the Gemini response body read so a pathological or
// compromised upstream cannot OOM the worker (CQ-3 — no magic values).
const maxResponseBytes = 10 << 20 // 10 MiB

// textRequestTimeout bounds a text-only generateContent call (authoring + writing
// grade). audioRequestTimeout is the LONGER bound for the 6.3b speaking-grade audio
// path: a multimodal transcribe-then-grade request runs longer than a text prompt, so
// it gets its own client rather than bumping the shared text timeout (D2).
const (
	textRequestTimeout  = 60 * time.Second
	audioRequestTimeout = 120 * time.Second
)

// GenerateRequest is the provider-agnostic generation request the worker hands
// to the client. Prompt is the fully-built per-mode instruction; Mode is carried
// for observability only (never the prompt text). AudioData (6.3b) is optional
// inline audio the worker attaches for a speaking grade — when non-nil the client
// sends it as a second inlineData part with AudioMimeType (the 6.3b0 transcoder's
// output MIME, audio/ogg); text callers leave both zero and the wire is unchanged.
type GenerateRequest struct {
	Mode          string
	Prompt        string
	AudioData     []byte
	AudioMimeType string
}

// Client is the worker's dependency seam for AI generation. Generate returns the
// raw JSON body the model produced (the worker unmarshals it into a typed
// model.AI*Response); a non-nil error is a TRANSIENT provider failure the worker
// retries (AC5), while malformed-but-returned bytes are a terminal
// invalid_ai_response the worker detects at parse/validate time (AC6).
type Client interface {
	Generate(ctx context.Context, req GenerateRequest) (json.RawMessage, error)
}

// httpClient is the real Gemini generateContent client. It holds TWO http clients:
// httpClient for text-only calls (60s) and audioClient for the longer 6.3b audio path
// (120s) — so a speaking grade does not steal from, nor lend to, the text timeout (D2).
type httpClient struct {
	apiKey      string
	model       string
	httpClient  *http.Client
	audioClient *http.Client
	endpoint    string
}

// NewClient builds a production Gemini client. apiKey + model come from config;
// the key is held only in this struct and sent to Google in the x-goog-api-key
// header — it is never logged, serialized, or placed in the URL (EDGE-4/R49).
func NewClient(apiKey, model string) Client {
	return &httpClient{
		apiKey:      apiKey,
		model:       model,
		httpClient:  &http.Client{Timeout: textRequestTimeout},
		audioClient: &http.Client{Timeout: audioRequestTimeout},
		endpoint:    "https://generativelanguage.googleapis.com/v1beta/models",
	}
}

// geminiRequestBody is the minimal generateContent request envelope. We ask the
// model to emit JSON only (responseMimeType) so the worker can unmarshal it into
// the typed model.AI*Response structs.
type geminiRequestBody struct {
	Contents         []geminiContent        `json:"contents"`
	GenerationConfig geminiGenerationConfig `json:"generationConfig"`
}

type geminiContent struct {
	Parts []geminiPart `json:"parts"`
}

// geminiPart is one content part. Text carries `omitempty` (6.3b) so an AUDIO part
// (InlineData set, Text empty) does NOT marshal `"text":""` alongside inlineData —
// Gemini rejects a part carrying both an empty text and inline data as malformed
// (400). A text-only part still marshals `{"text":"..."}` exactly as before.
type geminiPart struct {
	Text       string            `json:"text,omitempty"`
	InlineData *geminiInlineData `json:"inlineData,omitempty"`
}

// geminiInlineData is a base64 inline blob part (6.3b — the transcoded speaking
// audio). Data is standard-base64; MimeType is the transcoder's output MIME.
type geminiInlineData struct {
	MimeType string `json:"mimeType"`
	Data     string `json:"data"`
}

type geminiGenerationConfig struct {
	ResponseMimeType string `json:"responseMimeType"`
}

// geminiResponseBody is the slice of the generateContent response we consume:
// the first candidate's first text part, which carries the JSON we asked for.
type geminiResponseBody struct {
	Candidates []struct {
		Content struct {
			Parts []struct {
				Text string `json:"text"`
			} `json:"parts"`
		} `json:"content"`
	} `json:"candidates"`
}

// Generate calls the Gemini generateContent endpoint and returns the model's raw
// JSON text. A transport error or non-2xx status is returned as a transient
// error carrying only the status code — never the key, prompt, or response body.
func (c *httpClient) Generate(ctx context.Context, req GenerateRequest) (json.RawMessage, error) {
	// Text prompt is always part 1. For the 6.3b audio path a second inlineData part
	// carries the (base64) transcoded recording; text callers emit a single text part
	// and the wire is byte-for-byte unchanged. base64 inflates ×1.33 but the 6.3b0
	// voice-Opus re-encode keeps the transcoded clip well under Gemini's 20MB inline cap.
	parts := []geminiPart{{Text: req.Prompt}}
	doer := c.httpClient
	if req.AudioData != nil {
		parts = append(parts, geminiPart{InlineData: &geminiInlineData{
			MimeType: req.AudioMimeType,
			Data:     base64.StdEncoding.EncodeToString(req.AudioData),
		}})
		doer = c.audioClient // the longer audio-path timeout (D2)
	}
	body := geminiRequestBody{
		Contents:         []geminiContent{{Parts: parts}},
		GenerationConfig: geminiGenerationConfig{ResponseMimeType: "application/json"},
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("gemini: marshal request: %w", err)
	}

	// Key goes in the header, never the URL — so it cannot leak via the %w-wrapped
	// build error below, proxy/LB access logs, or APM URL sampling (R49).
	url := fmt.Sprintf("%s/%s:generateContent", c.endpoint, c.model)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("gemini: build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-goog-api-key", c.apiKey)

	resp, err := doer.Do(httpReq)
	if err != nil {
		// Transport failure — transient. Do NOT echo the URL (it carries the key).
		return nil, fmt.Errorf("gemini: request failed")
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// Non-2xx — transient. Status code only; never the response body.
		return nil, fmt.Errorf("gemini: unexpected status %d", resp.StatusCode)
	}

	payload, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("gemini: read response")
	}
	var parsed geminiResponseBody
	if err := json.Unmarshal(payload, &parsed); err != nil {
		// A response envelope we cannot even parse is treated as transient (the
		// provider misbehaved); the typed-content parse in the worker is what
		// classifies a well-formed-but-invalid GENERATION as invalid_ai_response.
		return nil, fmt.Errorf("gemini: decode response envelope")
	}
	if len(parsed.Candidates) == 0 || len(parsed.Candidates[0].Content.Parts) == 0 {
		return nil, fmt.Errorf("gemini: empty candidate list")
	}
	return json.RawMessage(parsed.Candidates[0].Content.Parts[0].Text), nil
}
