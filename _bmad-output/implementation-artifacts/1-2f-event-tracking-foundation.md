# Story 1.2f: Event Tracking Foundation

Status: review

## Story

As a developer,
I want a lightweight in-process event bus for domain events (grade released, assignment created, enrollment changed, etc.),
so that analytics (Epic 8) and notifications (Epic 10) can consume structured events without coupling to the producing code.

## Acceptance Criteria (BDD)

### AC1: Publish dispatches to handlers
Given the event bus is defined in internal/event/bus.go,
When Publish(ctx, event) is called with a domain event,
Then all registered handlers for that event type are invoked synchronously.

### AC2: Subscribe registers handlers
Given a handler is registered via Subscribe(eventType, handler),
When an event of that type is published,
Then the handler receives the event with fields Type, CenterID, UserID, Payload, and Timestamp.

### AC3: Events are logged
Given any event is published,
When the event bus processes it,
Then the event is logged via slog with all fields for future replay capability.

### AC4: No external infrastructure
Given no external message queue is configured (MVP),
When events are published,
Then they are processed in-process without requiring any external infrastructure.

## Tasks / Subtasks

- [x] Task 1: Create internal/event/ directory
- [x] Task 2: Create internal/event/bus.go (AC: #1, #2, #4)
  - [x] Event struct with Type, CenterID, UserID, Payload, Timestamp
  - [x] Handler type: func(ctx, Event) error
  - [x] Bus struct with sync.RWMutex-protected map[string][]Handler
  - [x] Subscribe + Publish (synchronous, fire-and-forget errors)
- [x] Task 3: Create internal/event/types.go (AC: #2)
  - [x] 6 constants: GradeReleased, AssignmentCreated, EnrollmentChanged, QuestionAsked, ScheduleChanged, PaymentFailed
- [x] Task 4: Add logging to Publish (AC: #3)
  - [x] slog.InfoContext on publish (Type, CenterID, UserID, Timestamp — no Payload per EDGE-4)
  - [x] slog.ErrorContext on handler failure
- [x] Task 5: Create internal/event/bus_test.go
  - [x] 5 tests: dispatch, multiple handlers, unregistered no-op, error doesn't stop others, auto-timestamp

## Dev Notes

### What to create (NEW files)
- `internal/event/bus.go` — event bus implementation
- `internal/event/types.go` — event type constants
- `internal/event/bus_test.go` — unit tests

### Design decisions
- Synchronous dispatch in MVP — keeps it simple, no goroutine leaks
- Handler errors are logged but don't propagate (fire-and-forget pattern)
- Event types are string constants, not an enum — allows easy extension
- Bus is instantiated once in main.go and passed via dependency injection
- No persistence layer — events are ephemeral in MVP (log replay is the recovery mechanism)

### Critical constraints
- Never log Payload content if it could contain PII (EDGE-4 principle) — log Type, CenterID, UserID only
- Bus must be goroutine-safe (sync.RWMutex on handler map)
- No external dependencies — stdlib only

### References
- [Source: _bmad-output/planning-artifacts/epics.md — Story 1.2f]
- [Source: docs/project-context.md — EDGE-4]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
N/A — clean implementation.

### Completion Notes List
- Event bus: synchronous in-process dispatch, sync.RWMutex-protected handler map, auto-timestamps zero values.
- Logging: InfoContext on publish (Type, CenterID, UserID, Timestamp — never Payload per EDGE-4), ErrorContext on handler failure.
- 6 event type constants using dot-separated naming (grade.released, etc.).
- 5 tests covering all ACs: dispatch, multiple handlers, unregistered no-op, error resilience, auto-timestamp.
- Stdlib only — no external dependencies.
- All 48 tests pass with -race. go vet clean.

### File List
- classlite-api/internal/event/bus.go (NEW — Bus, Event, Handler, Subscribe, Publish)
- classlite-api/internal/event/types.go (NEW — 6 event type constants)
- classlite-api/internal/event/bus_test.go (NEW — 5 tests)
