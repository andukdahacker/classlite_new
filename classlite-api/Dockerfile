# Build stage
FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o classlite-api ./cmd/api

# Runtime stage
FROM gcr.io/distroless/static-debian12
COPY --from=builder /app/classlite-api /classlite-api
EXPOSE 8080
ENTRYPOINT ["/classlite-api"]
