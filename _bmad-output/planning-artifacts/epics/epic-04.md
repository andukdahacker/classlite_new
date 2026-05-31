# Epic 4: Exercise Authoring, AI Content Generation & Knowledge Hub

**Functional Requirements:** FR-20 through FR-26, FR-54, FR-55

---

## Story 4.1: Exercise Library & CRUD API

- **Size:** M | **Audience:** Full-stack | **Dependencies:** 2.6

As a teacher, I want to browse, create, edit, and delete exercises so that I can build a library of reusable content for my classes.

**Screens:** Exercise library at `/exercises` (s15).

**UI/UX:**
- Table view with columns: title, code, sections, questions, skills, tags, classes, last modified
- Filters by skill, tag, class, and assignment status

**API & Data:**
- Full CRUD endpoints for exercises
- `exercises` table with JSONB `content` column + `schema_version`
- Content schema:
  ```json
  {
    "sections": [{
      "type": "",
      "title": "",
      "content": "",
      "questionGroups": [{
        "questions": [{
          "text": "",
          "type": "",
          "options": [],
          "correctAnswer": "",
          "acceptedVariants": []
        }]
      }]
    }]
  }
  ```
- Go typed struct unmarshal for content deserialization

**Acceptance Criteria:**
- Given a teacher navigates to `/exercises`, When the page loads, Then a table displays all exercises with title, code, sections, questions, skills, tags, classes, and last modified columns
- Given the exercise library is displayed, When the teacher applies filters by skill, tag, class, or assignment status, Then only matching exercises are shown
- Given a teacher clicks "Create Exercise", When they submit the form with valid data, Then a new exercise is created with a JSONB content column and schema_version
- Given an exercise exists, When a teacher edits it via the CRUD endpoint, Then the exercise content is updated and schema_version is preserved
- Given an exercise exists, When a teacher deletes it, Then the exercise is removed from the library
- Given the JSONB content is retrieved, When Go deserializes it, Then the typed struct unmarshal correctly parses the content schema

---

## Story 4.2: Exercise Editor — Structure, Questions & Settings

- **Size:** L | **Audience:** Full-stack | **Dependencies:** 4.1

As a teacher, I want a structured editor for exercises so that I can define sections, question groups, and configure settings like time limits and answer matching.

**Screens:** Two-panel editor at `/exercises/{id}/edit` (s16).

**UI/UX:**
- Left sidebar: metadata editing
- Right panel: sections with question groups
- Section types: Reading passage, Listening audio, Writing prompt, Speaking cue card
- Question types: T/F/NG, Gap-fill, Matching Headings, MCQ, Short Answer
- Settings: time limit toggle, answer matching mode (case-insensitive, hyphen/whitespace normalization)
- Locked state for assigned+submitted exercises with Clone/Unfinalize options
- Drag-and-drop reorder for sections and questions
- Debounce autosave

**Acceptance Criteria:**
- Given a teacher opens `/exercises/{id}/edit`, When the editor loads, Then a two-panel layout is displayed with metadata sidebar on the left and sections on the right
- Given the editor is open, When the teacher adds a section, Then they can choose from Reading passage, Listening audio, Writing prompt, or Speaking cue card types
- Given a section exists, When the teacher adds questions, Then they can choose from T/F/NG, Gap-fill, Matching Headings, MCQ, or Short Answer types
- Given the settings panel, When the teacher configures time limit and answer matching mode, Then the settings are persisted (case-insensitive, hyphen/whitespace normalization options available)
- Given an exercise is assigned and has submissions, When the teacher opens the editor, Then the exercise is in a locked state with Clone and Unfinalize options visible
- Given multiple sections or questions exist, When the teacher drags and drops items, Then the order is updated and persisted
- Given the teacher makes edits, When they stop typing, Then changes are autosaved after a debounce delay

---

## Story 4.3: AI Content Generation Pipeline

- **Size:** L | **Audience:** Full-stack | **Dependencies:** 4.1, 1.2e (presigned uploads)

As a teacher, I want to generate exercise content using AI so that I can quickly create high-quality sections and questions without manual effort.

**Screens:** AI generation dialog (s17).

**UI/UX:**
- Section generation with parameters: type, topic, band level, question count, type mix
- Credit cost displayed before generation
- Preview generated content before accept/edit/dismiss
- Question generation for existing sections
- Distractor generation for MCQ options

**API & Data:**
- Job created via `POST /api/exercises/{id}/ai-generate`
- Frontend polls `GET /api/jobs/{jobId}` with progressive backoff (2s → 4s → 8s)
- `jobs` table:
  - `id`, `center_id`, `type` (enum), `status` (pending/processing/complete/failed)
  - `params` JSONB, `result` JSONB, `error_details`
  - `retry_count`, `max_retries`
  - `created_at`, `started_at`, `completed_at`
- Index on `(status, created_at)`
- Worker goroutines with `SELECT FOR UPDATE SKIP LOCKED`
- AI credit metering per generation

**Acceptance Criteria:**
- Given a teacher opens the AI generation dialog, When they configure section parameters (type, topic, band, question count, type mix), Then the credit cost is displayed before confirming
- Given the teacher confirms generation, When the job is created via `POST /api/exercises/{id}/ai-generate`, Then a job record is inserted with status "pending" and the frontend begins polling
- Given the frontend is polling, When it calls `GET /api/jobs/{jobId}`, Then it uses progressive backoff (2s → 4s → 8s) to reduce server load
- Given the job completes, When the result is returned, Then the teacher sees a preview of generated content and can accept, edit, or dismiss it
- Given an existing section, When the teacher requests question generation or distractor generation, Then AI generates appropriate questions or MCQ distractors for that section
- Given worker goroutines are processing jobs, When a worker picks up a job, Then it uses `SELECT FOR UPDATE SKIP LOCKED` to avoid contention
- Given AI credits are consumed, When a generation completes, Then the credit meter is updated for the center

**Failure-Path Acceptance Criteria:**
- Given a job stuck in "processing" for more than 5 minutes, When the frontend polls, Then the UI shows "Taking longer than expected" with a "Cancel and retry" option
- Given Gemini API returns an error or is unreachable, When the worker processes the job, Then the job is marked failed with `error_details`, `retry_count` incremented, retried with exponential backoff (30s, 60s, 120s) up to `max_retries` (3)
- Given `max_retries` exhausted, When the job permanently fails, Then the teacher sees "Generation failed — please try again or create content manually" with a direct link to manual creation
- Given Gemini returns malformed/unparseable output, When the worker processes it, Then the job fails with `error_details="invalid_ai_response"` and is NOT auto-retried (requires different prompt, not same retry)

---

## Story 4.4: Knowledge Hub & File Management

- **Size:** L | **Audience:** Full-stack | **Dependencies:** 1.2e (presigned uploads)

As a teacher, I want a Knowledge Hub to upload, organize, and manage files so that I can reference them in class materials and exercises.

**Screens:** Knowledge Hub at `/knowledge-hub` (s26), File detail at `/knowledge-hub/files/{slug}` (s27).

**UI/UX:**
- Folder-based file browser
- File upload via presigned URL flow:
  1. `POST /api/uploads/presign` — get presigned URL
  2. Direct upload to R2
  3. `POST /api/uploads/confirm` — confirm upload
- Supported file types: PDF, PNG, JPG, SVG, MP3, WAV, WebM
- File size validated against plan storage limits
- File detail view with preview, metadata, linked locations, and view rate
- "From Knowledge Hub" picker integrated in class materials and exercise editor

**API & Data:**
- `files` table for file metadata
- `folders` table for folder structure
- `file_views` table for tracking view analytics

**Acceptance Criteria:**
- Given a teacher navigates to `/knowledge-hub`, When the page loads, Then a folder-based file browser is displayed
- Given the teacher clicks upload, When they select a file, Then a presigned URL is obtained via `POST /api/uploads/presign`, the file is uploaded directly to R2, and confirmed via `POST /api/uploads/confirm`
- Given a file is being uploaded, When the file type is checked, Then only PDF, PNG, JPG, SVG, MP3, WAV, and WebM files are accepted
- Given a file is being uploaded, When the size is checked, Then it is validated against the center's plan storage limits
- Given a file exists, When the teacher opens `/knowledge-hub/files/{slug}`, Then a detail view shows preview, metadata, linked locations, and view rate
- Given the teacher is editing class materials or an exercise, When they use the "From Knowledge Hub" picker, Then they can browse and select files from the Knowledge Hub
- Given file views are tracked, When a file is viewed, Then the `file_views` table is updated for analytics

---

## Story 4.5: JSONB Schema Migration Strategy

- **Size:** S | **Audience:** Backend | **Dependencies:** 4.1

As a developer, I want a strategy for migrating JSONB content schemas (exercises, AI responses, submissions) when the schema evolves, so that existing data remains readable without manual intervention.

**Acceptance Criteria:**
- Given exercise content JSONB with `schema_version=1`, When the application reads it and current schema is v2, Then a lazy migration function upgrades the content in-memory and writes the updated version back on next save
- Given a batch migration script in `scripts/migrate-jsonb.sh`, When run with `--entity=exercises --from=1 --to=2`, Then all rows are updated in batches of 100 with progress logging
- Given any JSONB column with a `schema_version`, When the Go code unmarshals it, Then the unmarshal function dispatches by version and upgrades to current before returning typed struct
- Schema versions are monotonically increasing integers, never skipped
