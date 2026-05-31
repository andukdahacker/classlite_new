## Epic 6: Grading & AI-Assisted Grading

Teachers can grade all submission types — Writing with anchored inline comments, Speaking with timestamp-pinned feedback, auto-graded Reading/Listening with override capability. AI suggests band scores and comments, cutting grading time from ~12 to ~3 minutes.

**FRs:** FR-33, FR-34, FR-35, FR-36, FR-37

### Story 6.1: Writing Grading with Anchored Comments

**Size:** L | **Audience:** Full-stack | **Dependencies:** 5.1

As a Teacher,
I want to grade Writing submissions with inline comments anchored to specific text spans,
So that I can give students precise, contextualized feedback on their essays.

**Acceptance Criteria:**

**Given** a Teacher navigating to a Writing grading view (`/classes/{id}/grading/{aid}/{sid}`, s23)
**When** the grading interface renders
**Then** the student's essay is displayed with the full rich text content
**And** a highlight-and-pin system allows the teacher to select text spans and attach comments

**Given** the comment system
**When** the teacher creates a comment
**Then** three comment types are available: Error (red), Praise (green), Suggestion (yellow)
**And** each comment is tagged by grading criterion: Task Response, Coherence & Cohesion, Lexical Resource, Grammatical Range & Accuracy
**And** comments are anchored to specific text spans or paragraphs with visual pin indicators

**Given** the band score inputs
**When** grading
**Then** four criterion inputs are displayed: Task Response, Coherence & Cohesion, Lexical Resource, Grammatical Range & Accuracy
**And** each accepts band scores from 1.0–9.0 in 0.5 increments
**And** the overall band is calculated automatically from the four criteria

**Given** the grading queue
**When** the teacher finishes grading one submission
**Then** "Prev student / Next student" navigation buttons enable queue-based grading without returning to the list
**And** the grading queue shows: student name, assignment, class, and overdue flag

**Given** the teacher clicking "Submit grade & notify student"
**When** the grade is released
**Then** the submission status changes to "graded" with graded_at timestamp
**And** the student receives a notification that their grade is available
**And** the graded submission becomes immutable (NFR-6)

**Given** the grading API
**When** POST `/api/submissions/{id}/grade` is called
**Then** the request body includes: `{ "criterionScores": { "taskResponse": 6.5, ... }, "overallBand": 6.5, "comments": [{ "type", "criterion", "anchorStart", "anchorEnd", "text" }], "feedback" (optional text) }`
**And** grades are stored in a `grades` table: id, submission_id, center_id, graded_by, criterion_scores (JSONB), overall_band, comments (JSONB), feedback, created_at
**And** the submission's status is updated to "graded"

**Given** inline comments on mobile (s79)
**When** the student views graded feedback on a phone
**Then** comments appear inline within the essay text (not as a side rail)
**And** tapping a comment expands it to show full feedback

### Story 6.2: AI-Assisted Writing Grading

**Size:** L | **Audience:** Full-stack | **Dependencies:** 6.1, 4.3 (job queue)

As a Teacher,
I want AI to propose band scores and inline comments for Writing submissions,
So that I can grade essays in ~3 minutes instead of ~12 by reviewing AI suggestions.

**Acceptance Criteria:**

**Given** a teacher opening a Writing submission for grading
**When** they click "Run AI Grading" (or it runs automatically if configured)
**Then** a job is created via POST `/api/submissions/{id}/ai-grade` with type `ai_grade_writing`
**And** the response returns `{ "jobId": "..." }`
**And** the frontend polls GET `/api/jobs/{jobId}` with progressive backoff (2s → 4s → 8s)

**Given** a completed AI grading job
**When** the results are returned
**Then** the AI proposes: a band score per criterion with written rationale, and inline comments (error/praise/suggestion) anchored to specific text spans
**And** each suggestion has a confidence level: High or Medium
**And** a disclaimer is always visible: "Suggestion — teacher always decides the final band."

**Given** the AI suggestions in the grading UI
**When** the teacher reviews them
**Then** each AI suggestion (band score or comment) can be individually Accepted, Edited, or Dismissed
**And** a bulk "Accept all praise" action is available for quickly accepting positive comments
**And** accepted suggestions populate the grading form — the teacher can still modify before submitting

**Given** AI grading credit consumption
**When** AI grading is triggered
**Then** credits are deducted from the center's monthly allocation
**And** the credit cost is shown before confirming

**Given** the AI grading worker (`internal/worker/ai_grade_writing.go`)
**When** processing a writing grading job
**Then** the worker sends the student's essay + IELTS Writing rubric to Google Gemini
**And** parses the response into structured band scores, rationales, and anchored comments
**And** stores the result in the job's result JSONB
**And** the result is also stored on the submission for reference

**Given** the first AI grade experience (UX-DR21)
**When** a new teacher clicks the "Try AI grading" card on their dashboard
**Then** a pre-loaded sample IELTS Writing essay opens in the grading view
**And** a single CTA triggers AI grading
**And** results appear with subtle transition after ~15–30 seconds (no celebratory modal)
**And** the teacher experiences the 12→3 minute promise before grading real submissions

**Failure-Path Acceptance Criteria:**

**Given** Gemini returns band scores outside 1.0–9.0 range or non-0.5 increments
**When** the worker parses the response
**Then** the job fails with `error_details="invalid_band_scores"` and the teacher sees "AI produced invalid scores — please grade manually" with all form fields empty (not pre-filled with bad data)

**Given** Gemini returns anchored comments with text positions that don't map to the student's essay
**When** displayed
**Then** orphaned comments are shown as general (unanchored) feedback rather than silently dropped

**Given** AI grading takes longer than 60 seconds
**When** the frontend is polling
**Then** after 30s show "Taking longer than expected — AI is still working", after 60s show "This is unusually slow — you can start grading manually and AI suggestions will appear when ready"

**Given** the teacher starts manual grading while AI is still processing
**When** AI results arrive
**Then** they are presented as a non-blocking overlay: "AI suggestions are ready — Review?" with option to merge into existing work

### Story 6.3: Speaking Grading & AI-Assisted Speaking Grading

**Size:** L | **Audience:** Full-stack | **Dependencies:** 5.4

As a Teacher,
I want to grade Speaking submissions with an audio player and timestamp-pinned comments, with AI assistance for transcription and band proposals,
So that I can efficiently evaluate spoken responses with precise feedback.

**Acceptance Criteria:**

**Given** a Teacher navigating to a Speaking grading view (s24)
**When** the grading interface renders
**Then** an audio player is displayed with: waveform visualization, play/pause, seek, and playback speed control (0.5x, 1x, 1.5x, 2x)
**And** band score inputs are shown for: Fluency & Coherence, Lexical Resource, Grammatical Range & Accuracy, Pronunciation
**And** an overall band is calculated from the four criteria

**Given** the timestamp-pinned comment system
**When** the teacher clicks on the waveform at a specific position
**Then** a comment is created anchored to that timestamp
**And** the comment can be typed with the same three types: Error, Praise, Suggestion
**And** comments appear as pins along the waveform timeline

**Given** the AI-assisted Speaking grading feature (FR-36)
**When** the teacher triggers AI grading via POST `/api/submissions/{id}/ai-grade` with type `ai_grade_speaking`
**Then** the AI auto-transcribes the audio recording
**And** proposes band scores per criterion with rationale
**And** identifies specific moments: hesitations, grammatical errors, strong delivery, pronunciation issues — each with a timestamp and confidence level

**Given** the AI transcription result
**When** displayed in the grading view
**Then** transcription time and audio duration are shown
**And** a "View transcript" button shows the full text
**And** each AI-flagged moment can be Accepted, Edited, or Dismissed individually
**And** teacher-saved notes and AI draft notes appear together chronologically along the timeline

**Given** the speaking grading API
**When** POST `/api/submissions/{id}/grade` is called for a speaking submission
**Then** the request body includes criterion scores, overall band, timestamped comments, and optional transcript reference
**And** the grade is stored and the submission status changes to "graded"

**Failure-Path Acceptance Criteria:**

**Given** audio transcription fails (inaudible, too noisy, unsupported codec)
**When** the AI worker processes it
**Then** the job partially succeeds: transcription marked as "unavailable" but band score proposals are still attempted based on audio analysis alone

**Given** the audio file is corrupted or missing from R2
**When** the teacher opens the grading view
**Then** a clear error explains the file issue with "Ask student to re-record" as the suggested action

### Story 6.4: Auto-Grading (Reading/Listening/Vocabulary)

**Size:** M | **Audience:** Backend | **Dependencies:** 5.2

As a Teacher,
I want Reading, Listening, and Vocabulary submissions to be auto-marked against the answer key with my ability to override,
So that objective assessments are graded instantly while I retain control over edge cases.

**Acceptance Criteria:**

**Given** a student submitting a Reading/Listening/Vocabulary assignment
**When** the submission is received
**Then** it is automatically marked against the exercise's answer key immediately
**And** the auto-grade produces: raw score (e.g., 11/14), percentage, and provisional band score

**Given** the auto-grade result
**When** the teacher views it in the grading view (s25)
**Then** a per-answer breakdown is shown: each question, student's answer, correct answer, and mark (correct/wrong/flagged)
**And** spelling variants are flagged for teacher review (e.g., "hydro-electric" vs "hydroelectric") rather than auto-rejected

**Given** a flagged or incorrectly marked answer
**When** the teacher overrides
**Then** they can mark any answer as correct or wrong with a single click
**And** the final score updates immediately after overrides
**And** the override is recorded (who overrode, when)

**Given** the teacher reviewing auto-graded results
**When** they are satisfied with the scores
**Then** clicking "Release result & notify" makes the grade visible to the student and sends a notification
**And** until released, the student sees only "Pending grading" — auto-grade results are not auto-released

**Given** the auto-grading logic in the Go backend
**When** processing a quiz submission
**Then** answer comparison uses the exercise's answer matching mode: case-insensitive by default, normalization strips hyphens and extra whitespace
**And** multiple accepted variants per question are checked
**And** the band conversion follows standard IELTS score-to-band tables

**Given** the auto-grading API
**When** the submission is auto-graded
**Then** the provisional grade is stored in the `grades` table with `graded_by: "system"`
**And** the submission status changes to "graded" but `released_at` remains null until the teacher releases
**And** POST `/api/submissions/{id}/release` sets `released_at` and triggers student notification
