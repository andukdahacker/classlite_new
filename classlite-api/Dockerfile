# Build stage
FROM golang:1.25-alpine AS builder
WORKDIR /app
# git is needed for `go install` of sqlc (fetches its modules).
RUN apk add --no-cache git
COPY go.mod go.sum ./
RUN go mod download
# The sqlc store (internal/store/generated) is gitignored, so it is absent from a
# fresh checkout. Generate it at build time — mirrors CI's "Generate sqlc store"
# step (cd classlite-api && sqlc generate) — so the image is self-contained.
# Pinned to match the version used in development.
# GOTOOLCHAIN=auto lets Go fetch the toolchain sqlc requires to build (it needs a
# newer Go than this builder image pins); only affects building sqlc, not the app.
RUN GOTOOLCHAIN=auto go install github.com/sqlc-dev/sqlc/cmd/sqlc@v1.31.1
COPY . .
RUN sqlc generate
RUN CGO_ENABLED=0 GOOS=linux go build -o classlite-api ./cmd/api

# ============================================================================
# Story 6.3b0 — bundled ffmpeg (⚠️ HUMAN-REVIEW INFRA CHANGE — Winston/D3).
#
# The AI speaking-grade worker (6-3b) transcodes browser-recorded clips
# (webm/mp4) into Gemini-ingestible Opus/Ogg via internal/media, which shells
# out to ffmpeg. The runtime base is `gcr.io/distroless/static-debian12` (no
# libc, no shell), so we use APPROACH (a) from the story: multi-stage COPY of a
# FULLY STATIC ffmpeg into the hardened distroless-static base — smallest image,
# keeps the CVE-minimal base, no libc dependency.
#
# Source: mwader/static-ffmpeg — a widely-used, reproducible static ffmpeg/ffprobe
# build. PINNED to a specific ffmpeg version tag below (bump deliberately, not
# floating). The binaries are genuinely static (verify with `ldd` → "not a
# dynamic executable") so they run under distroless-static.
#
# Human review should confirm: (1) the pinned version + its CVE posture, (2) the
# image-size delta, (3) that the copied binary is static. See docs/manual-setup.md.
# ============================================================================
FROM mwader/static-ffmpeg:7.1 AS ffmpeg

# Runtime stage
FROM gcr.io/distroless/static-debian12
COPY --from=builder /app/classlite-api /classlite-api
# Static ffmpeg/ffprobe → on PATH at /usr/local/bin (distroless-static's PATH
# includes it). CLASSLITE_FFMPEG_PATH pins the absolute path so the boot-time
# CheckFFmpegAvailable + the transcoder never rely on PATH resolution.
COPY --from=ffmpeg /ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg /ffprobe /usr/local/bin/ffprobe
ENV CLASSLITE_FFMPEG_PATH=/usr/local/bin/ffmpeg
EXPOSE 8080
ENTRYPOINT ["/classlite-api"]
