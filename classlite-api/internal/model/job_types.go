// Story 4.3a — job-queue domain constants + the AI-generation job payloads.
//
// JobType mirrors the jobs.type text column. It stays a string (not a second
// enum) so Epic 6 adds ai_grade_* types by registering a handler, no migration
// (architecture.md:486). The retry/backoff/stuck constants are the dispatcher's
// named tunables (CQ-3 — no magic values). The CenterIDClaim field on each
// param struct is UNTRUSTED user input: the worker NEVER derives tenant identity
// from it — the job row's center_id is the sole trust anchor (R3/A7, SEC-6).
package model

import "time"

// JobType identifies a job's handler (jobs.type).
type JobType string

const (
	// JobTypeAIGenerateSection generates a full section (passage + question
	// groups) for an exercise.
	JobTypeAIGenerateSection JobType = "ai_generate_section"
	// JobTypeAIGenerateQuestions generates question groups appended to an
	// existing section.
	JobTypeAIGenerateQuestions JobType = "ai_generate_questions"
	// JobTypeAIGenerateDistractors generates distractor options for one MCQ
	// question.
	JobTypeAIGenerateDistractors JobType = "ai_generate_distractors"
	// JobTypeGradeReleaseEmail is the Story 6.1 transactional-outbox job: it is
	// INSERTed inside the grade-release tx (D2) and, once the tx commits, the
	// dispatcher publishes event.GradeReleased + sends the student's Resend email
	// (behind GRADE_RELEASE_EMAIL_ENABLED). Not an AI job — the handler ignores the
	// gemini client. Idempotency anchor: params.GradeID.
	JobTypeGradeReleaseEmail JobType = "grade_release_email"
)

// AIGenerationModeToJobType maps the enqueue request `mode` discriminator to its
// JobType. Only these three modes are valid in 4.3a — an unknown mode is a 422
// at the handler, never a job insert.
var AIGenerationModeToJobType = map[string]JobType{
	"section":     JobTypeAIGenerateSection,
	"questions":   JobTypeAIGenerateQuestions,
	"distractors": JobTypeAIGenerateDistractors,
}

// Job status values mirror the jobs.status enum (job_status).
const (
	JobStatusPending    = "pending"
	JobStatusProcessing = "processing"
	JobStatusComplete   = "complete"
	JobStatusFailed     = "failed"
)

// MaxJobRetries is the default retry ceiling (jobs.max_retries default). After
// this many retries a transient failure goes terminal + refunds (AC5/AC7).
const MaxJobRetries = 3

// AIJobParamsSchemaVersion stamps jobs.params_schema_version for AI-generation
// job payloads. This is the JOB-PARAMS schema line — independent of the exercise
// CONTENT schema (store.CurrentExerciseSchemaVersion); the two version
// independently, so they must not share a constant (Story 4.3a code review, P20).
const AIJobParamsSchemaVersion = 1

// JobRetryBackoffs is the exponential backoff schedule between retry attempts:
// 30s → 60s → 120s (AC5). Index i is the delay before the (i+1)-th retry — i.e.
// the delay applied when incrementing retry_count from i to i+1.
var JobRetryBackoffs = []time.Duration{
	30 * time.Second,
	60 * time.Second,
	120 * time.Second,
}

// StuckJobTimeout is how long a job may sit in 'processing' before the sweep
// marks it failed + refunds (AC7) — a worker that died mid-job leaves the row
// wedged and the credit stranded.
const StuckJobTimeout = 5 * time.Minute

// Terminal error_details sentinels (jobs.error_details).
const (
	// JobErrorInvalidAIResponse marks a job that failed because Gemini returned
	// unparseable/invalid output — terminal, NOT retried (AC6).
	JobErrorInvalidAIResponse = "invalid_ai_response"
	// JobErrorStuckTimeout marks a job the 5-minute sweep reclaimed (AC7).
	JobErrorStuckTimeout = "stuck_timeout"
	// JobErrorMaxRetries marks a transient job that exhausted its retries (AC5).
	JobErrorMaxRetries = "max_retries_exhausted"
)

// Credit-ledger reasons (ai_credit_ledger.reason). 4.3a writes only these two;
// Story 6.5 adds monthly_grant / addon_purchase / admin_adjustment.
const (
	CreditReasonJobDeduction    = "job_deduction"
	CreditReasonJobFailedRefund = "job_failed_refund"
)

// --- AI generation job params (the jobs.params payload, per mode) ---

// AIGenerateSectionParams is the payload for a section-generation job. Topic is
// the free-text prompt seed; ExerciseID is the target library exercise.
type AIGenerateSectionParams struct {
	ExerciseID string `json:"exerciseId"`
	Topic      string `json:"topic"`
	// CenterIDClaim is UNTRUSTED and IGNORED by the worker (R3/A7). It exists so
	// adversarial tests can prove the job-row center_id wins; production enqueue
	// leaves it empty.
	CenterIDClaim string `json:"centerId"`
}

// AIGenerateQuestionsParams is the payload for a questions-generation job —
// groups appended to SectionID within ExerciseID.
type AIGenerateQuestionsParams struct {
	ExerciseID    string `json:"exerciseId"`
	SectionID     string `json:"sectionId"`
	Count         int    `json:"count"`
	CenterIDClaim string `json:"centerId"`
}

// AIGenerateDistractorsParams is the payload for a distractors-generation job —
// options for the single MCQ QuestionID within ExerciseID.
type AIGenerateDistractorsParams struct {
	ExerciseID    string `json:"exerciseId"`
	QuestionID    string `json:"questionId"`
	Count         int    `json:"count"`
	CenterIDClaim string `json:"centerId"`
}

// GradeReleaseEmailParamsSchemaVersion stamps jobs.params_schema_version for the
// grade-release outbox payload. Independent of AIJobParamsSchemaVersion and of any
// content-schema version (GO-7 / P20).
const GradeReleaseEmailParamsSchemaVersion = 1

// GradeReleaseEmailParams is the Story 6.1 transactional-outbox payload (D2). It
// is written inside the grade tx and consumed post-commit by the dispatcher to
// publish event.GradeReleased and send the student's release email. GradeID is the
// idempotency anchor. The payload carries IDS ONLY — the recipient (student email
// + name) and assignment title are re-resolved from the tenant-scoped db at send
// time (chunk-1 code-review Decision B), so a rename/email-change since release is
// honored and no PII rests in jobs.params. No teacher identity is carried (privacy
// — StudentGradeView excludes graded_by).
type GradeReleaseEmailParams struct {
	GradeID      string `json:"gradeId"`
	SubmissionID string `json:"submissionId"`
	AssignmentID string `json:"assignmentId"`
}
