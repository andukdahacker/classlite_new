# Epic 5: Assignments, Student Attempts & Submissions

**Functional Requirements:** FR-27 through FR-32

---

## Story 5.1: Assignment Creation & Submission Lifecycle API

- **Size:** L | **Audience:** Backend | **Dependencies:** 4.1, 3.1

As a teacher, I want to create assignments and manage the submission lifecycle so that students can attempt exercises and their work progresses through defined states.

**API & Data:**
- `POST /api/assignments` to create assignments
- Assignment statuses: open / closed
- Student starts attempt → submission status `in_progress`
- Submit → status `submitted` + `late` flag calculated
- Late penalty math stored on submission
- Hard deadline locks submission (no further changes accepted)
- Submission lifecycle: `in_progress` → `submitted` → `ai_processing` → `graded`
- `assignments` table
- `submissions` table with JSONB `content` + `schema_version`
- Unique constraint: one submission per student per assignment

**Acceptance Criteria:**
- Given a teacher creates an assignment via `POST /api/assignments`, When valid data is provided, Then the assignment is created with status "open"
- Given an assignment is open, When a student starts an attempt, Then a submission is created with status "in_progress"
- Given a student submits their work, When the submission is processed, Then the status changes to "submitted" and a late flag is calculated based on the deadline
- Given a submission is late, When the late penalty is applied, Then the penalty math is stored on the submission record
- Given the hard deadline has passed, When a student attempts to modify their submission, Then the submission is locked and no further changes are accepted
- Given a submission is submitted, When it progresses through the lifecycle, Then it transitions through `in_progress` → `submitted` → `ai_processing` → `graded`
- Given a student and assignment pair, When a submission already exists, Then the unique constraint prevents creating a duplicate submission

---

## Story 5.2: Quiz Attempt Interface (Reading/Listening/Vocabulary)

- **Size:** L | **Audience:** Frontend | **Dependencies:** 5.1

As a student, I want to take quiz-style exercises with various question types so that I can complete reading, listening, and vocabulary assignments.

**Screens:** Split-pane quiz interface (s33).

**UI/UX:**
- Left pane: passage display or audio player
- Right pane: questions with input types:
  - Radio buttons for T/F/NG and MCQ
  - Text input for gap-fill and short answer
  - Drag-and-drop for matching
- Prev/Next navigation between questions
- Question flag toggle to mark questions for review
- Timer displayed with server-side start time as source of truth
- Incremental save every 30 seconds
- Listening variant with integrated audio player
- Submit confirmation dialog showing answered, unanswered, and flagged question counts

**API:**
- `PUT /api/submissions/{id}/progress` — incremental save
- `POST /api/submissions/{id}/submit` — final submission

**Acceptance Criteria:**
- Given a student opens a quiz attempt, When the interface loads, Then a split-pane layout shows the passage/audio on the left and questions on the right
- Given a T/F/NG or MCQ question, When the student answers, Then radio buttons are used for selection
- Given a gap-fill or short answer question, When the student answers, Then text input fields are used
- Given a matching question, When the student answers, Then drag-and-drop interaction is available
- Given the student is navigating questions, When they click Prev/Next, Then they move between questions sequentially
- Given a question, When the student flags it, Then the flag toggle marks it for later review
- Given the attempt has started, When the timer is displayed, Then it uses the server-side start time as the source of truth
- Given the attempt is in progress, When 30 seconds elapse since the last save, Then answers are incrementally saved via `PUT /api/submissions/{id}/progress`
- Given a listening exercise, When the student starts, Then an audio player is integrated into the left pane
- Given the student clicks submit, When the confirmation dialog appears, Then it shows counts of answered, unanswered, and flagged questions
- Given the student confirms submission, When the request is sent, Then `POST /api/submissions/{id}/submit` finalizes the attempt

**Failure-Path Acceptance Criteria:**
- Given a network drop during incremental save, When connection resumes, Then the next save includes all unsaved answers without data loss
- Given the timer expires while the student has unsaved answers, When auto-submit triggers, Then all current answers are saved before submission

---

## Story 5.3: Writing Attempt Interface

- **Size:** L | **Audience:** Frontend | **Dependencies:** 5.1

As a student, I want a writing interface to compose and submit written responses so that I can complete writing assignments with real-time feedback on my progress.

**Screens:** Writing attempt at `/assignments/{id}/write` (s34), Mobile (s78).

**UI/UX:**
- Rich text editor with formatting toolbar
- Live word count displayed
- Time-on-task tracker
- Due-date countdown visible
- Debounce autosave via TanStack Query mutations (NOT React Hook Form)
- Mobile (s78): phone-sized writing surface with sticky word counter
- Content stored as rich text in JSONB

**Acceptance Criteria:**
- Given a student opens `/assignments/{id}/write`, When the editor loads, Then a rich text editor with toolbar is displayed
- Given the student is typing, When text changes, Then a live word count is updated in real time
- Given the attempt is active, When the student is working, Then a time-on-task tracker records elapsed time
- Given the assignment has a due date, When the editor is open, Then a due-date countdown is visible
- Given the student makes edits, When they pause typing, Then changes are autosaved via debounced TanStack Query mutations
- Given the student is on mobile (s78), When they open the writing interface, Then a phone-sized writing surface is displayed with a sticky word counter
- Given the writing content, When it is persisted, Then it is stored as rich text in the submission's JSONB content column

**Failure-Path Acceptance Criteria:**
- Given a network drop during autosave, When the student continues typing, Then a "Offline — changes saved locally" indicator appears, and local changes sync when connection resumes
- Given the browser tab is closed during an active attempt, When the student returns, Then their last autosaved content is restored
- Given MSW (in component test) or real network throttling (in E2E) simulates intermittent autosave failures, When the test runs, Then: (a) the draft persists to localStorage as fallback; (b) the "Saving / Saved / Error" indicator transitions through all three states correctly; (c) on page reload, the draft recovers from localStorage; (d) on reconnect, the local draft sync-merges with server state (server wins on conflict, user warned via non-blocking toast). (R42 mitigation.)
- Given a multi-tab scenario where the same student opens the same writing attempt in two tabs, When tab 1 submits, Then `BroadcastChannel` notifies tab 2 with a "Submitted in another session — view result" overlay; tab 2's editor becomes read-only. (UX-DR19 cross-reference.)

---

## Story 5.4: Speaking Attempt Interface

- **Size:** M | **Audience:** Frontend | **Dependencies:** 5.1, 1.2e (presigned uploads)

As a student, I want to record and submit speaking responses so that I can complete speaking assignments with audio recordings.

**Screens:** Speaking attempt interface, Mobile variant.

**UI/UX:**
- Cue card displayed with preparation countdown timer
- Recording window activates after prep time
- Playback preview of recording before submission
- Re-record unlimited times
- Upload recording to R2 via presigned URL: `{center_id}/speaking/{uuid}.webm`
- Mobile: large thumb-friendly controls for recording

**API:**
- `PUT /api/submissions/{id}/progress` — save progress
- `POST /api/submissions/{id}/submit` — final submission

**Acceptance Criteria:**
- Given a student starts a speaking attempt, When the cue card is shown, Then a preparation countdown timer begins
- Given the prep time expires, When the recording window activates, Then the student can record their response
- Given a recording is complete, When the student finishes, Then they can preview the playback before submitting
- Given the student is not satisfied with their recording, When they choose to re-record, Then they can re-record unlimited times
- Given a recording is ready for upload, When the student submits, Then the audio is uploaded to R2 via presigned URL at `{center_id}/speaking/{uuid}.webm`
- Given the student is on mobile, When they use the speaking interface, Then large thumb-friendly controls are available for recording
- Given the attempt is in progress, When progress is saved, Then `PUT /api/submissions/{id}/progress` is called
- Given the student submits, When the final recording is uploaded, Then `POST /api/submissions/{id}/submit` finalizes the attempt

**Failure-Path Acceptance Criteria:**
- Given microphone permission is denied, When the student starts a speaking attempt, Then a clear message explains how to enable microphone access with browser-specific instructions
- Given the R2 upload fails, When the student clicks submit, Then the upload retries automatically (up to 3 times) with progress indicator, and on permanent failure shows "Upload failed — your recording is saved locally, please try again"
- Given the Speaking audio per-file cap (locked A9), When the student attempts to upload a file >25 MB, Then the same defense-in-depth enforcement applies as Knowledge Hub (Story 4.4): client pre-check, server pre-check at `/uploads/presign` returns 413 `FILE_TOO_LARGE`, R2 `Content-Length-Range` constraint, server post-check at `/uploads/confirm`.

### Release-Gate Manual Checklist (Real-Device Verification)

The Speaking pipeline depends on `MediaRecorder` API behavior that is NOT covered by Playwright WebKit (the iOS Simulator uses a desktop-class WebKit backend, NOT iOS Safari's real media pipeline). Before Epic 5 ships, the following checklist MUST pass on REAL iPhone (Safari) AND REAL Android (Chrome) — Playwright WebKit alone is NOT sufficient. ~20 minutes manual sweep per release. (A5 mitigation.)

- [ ] Speaking recorder: record / re-record / upload on real iPhone (Safari)
- [ ] Speaking recorder: record / re-record / upload on real Android (Chrome)
- [ ] Microphone permission denial → graceful UX with browser-specific recovery instructions
- [ ] Interrupted by incoming call → recording state preserved or cleanly aborted (no orphan recording state)
- [ ] Recording survives backgrounding the tab for 30 seconds
- [ ] Submitted audio playable on a different device + browser combo (cross-device codec compatibility check)

---

## Story 5.5: Submission Result View

- **Size:** M | **Audience:** Frontend | **Dependencies:** 5.1, 6.1

As a student, I want to view my submission results so that I can see my grades, feedback, and understand my performance.

**Screens:** Result view at `/assignments/{id}/result` (s35), Mobile (s79).

**UI/UX:**
- Overall band score displayed
- Per-criterion breakdown with individual scores
- Feedback text with inline anchored comments
- On-time / late submission status visible
- Late penalty math displayed when applicable
- Unreleased results show "Pending grading" message
- Class average hidden from student view
- Mobile (s79): hero band score at top, inline comments, vertical criterion stack

**API:**
- `GET /api/submissions/{id}/result` — returns 404 if results not yet released

**Acceptance Criteria:**
- Given a student opens `/assignments/{id}/result`, When results are released, Then the overall band score is displayed
- Given results are displayed, When per-criterion scores exist, Then a breakdown with individual scores is shown
- Given feedback has been provided, When the student views results, Then feedback text with inline anchored comments is visible
- Given the submission timing, When the student views results, Then on-time or late status is clearly indicated
- Given a late submission, When penalty was applied, Then the late penalty math is visible to the student
- Given results have not been released, When the student visits the result page, Then "Pending grading" is displayed
- Given the result view, When class average data exists, Then it is hidden from the student view
- Given the student is on mobile (s79), When they view results, Then a hero band score is shown at top with inline comments and a vertical criterion stack
- Given results are not yet released, When the API is called via `GET /api/submissions/{id}/result`, Then it returns 404
