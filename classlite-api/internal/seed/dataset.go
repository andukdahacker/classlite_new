package seed

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// seedEpoch anchors every seeded timestamp so even the time columns are
// deterministic (the content-hash oracle excludes them anyway, but a fixed epoch
// keeps the data readable and reproducible across machines).
var seedEpoch = time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)

// skills seeded, one exercise + assignment + submission per skill, so the
// coverage oracle sees all four (AC1).
var seededSkills = []string{"reading", "listening", "writing", "speaking"}

// submissionStatuses pairs 1:1 with seededSkills so the dataset carries all four
// attempt lifecycle states (in_progress → submitted → ai_processing → graded).
// Index 0 (reading) is the graded one that receives a released grade.
var submissionStatuses = []string{"graded", "submitted", "ai_processing", "in_progress"}

// buildTenant writes the full Epics 1–8 dataset for one tenant inside a single
// tenant-scoped transaction and returns its credential-bearing summary.
func buildTenant(ctx context.Context, pool *pgxpool.Pool, p tenantPlan, passwordHash string) (SeededCenter, error) {
	center := SeededCenter{ID: p.centerID, Name: p.name, ShortCode: p.shortCode}

	// Global rows (centers/users have no RLS) + all tenant rows go in one tx so a
	// mid-build failure leaves nothing partially committed.
	err := withTenantTx(ctx, pool, p.centerID, func(tx pgx.Tx) error {
		do := func(sql string, args ...any) error {
			if _, e := tx.Exec(ctx, sql, args...); e != nil {
				return fmt.Errorf("%s: %w", firstLine(sql), e)
			}
			return nil
		}

		// --- Epic 1: center -------------------------------------------------
		if err := do(
			`INSERT INTO centers (id, name, short_code) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`,
			p.centerID, p.name, p.shortCode,
		); err != nil {
			return err
		}

		// --- Epic 2/7: users + center_members (all roles) -------------------
		type roleSpec struct {
			role  string
			n     int
			local string
			name  string
			creds bool // emit a credentials.json login row for this identity
		}
		roles := []roleSpec{
			{"owner", 1, "owner", "Owner Fixture", true},
			{"admin", 2, "admin", "Admin Fixture", true},
			{"teacher", 3, "teacher", "Teacher Fixture", true},
			// teacher2 (D1, Story 11-2): a SECOND teacher in the SAME center assigned
			// to NO class, so it is out-of-scope for every student here. This lets
			// 11-2's AC2 prove a TRUE same-tenant role-scope 404 (STUDENT_NOT_FOUND),
			// not the weaker cross-tenant RLS 404. Reaches credentials.json via creds.
			{"teacher", 6, "teacher2", "Teacher Two Fixture", true},
			{"student", 4, "student1", "Student Fixture", true},
			{"student", 5, "student2", "Student Fixture", false},
		}
		for _, r := range roles {
			uid := seedUUID(blockUser, p.letter, r.n)
			email := fmt.Sprintf("%s%s-%s%s", "seed-fake-", r.local, p.tag, SyntheticEmailDomain)
			fullName := fmt.Sprintf("%s%s %s%d", SyntheticMarker, r.name, p.tag, r.n)
			if err := do(
				`INSERT INTO users (id, email, password_hash, full_name, email_verified)
				 VALUES ($1,$2,$3,$4,true) ON CONFLICT (id) DO NOTHING`,
				uid, email, passwordHash, fullName,
			); err != nil {
				return err
			}
			if err := do(
				`INSERT INTO center_members (user_id, center_id, role)
				 VALUES ($1,$2,$3) ON CONFLICT (user_id, center_id) DO NOTHING`,
				uid, p.centerID, r.role,
			); err != nil {
				return err
			}
			// One credential per creds-flagged identity. student2 is extra coverage
			// (not a creds row); teacher2 (D1) IS a creds row so 11-2's AC2 can
			// authenticate it. An explicit flag, not a positional index, so adding
			// a non-consecutive identity never silently drops it from the manifest.
			if r.creds {
				center.Members = append(center.Members, SeededMember{
					Role: r.role, Email: email, Password: seedPassword, UserID: uid,
				})
			}
		}
		teacherID := seedUUID(blockUser, p.letter, 3)
		student1 := seedUUID(blockUser, p.letter, 4)
		student2 := seedUUID(blockUser, p.letter, 5)

		// --- Epic 3: classes (active + ended) -------------------------------
		classActive := seedUUID(blockClass, p.letter, 1)
		classEnded := seedUUID(blockClass, p.letter, 2)
		if err := do(
			`INSERT INTO classes (id, center_id, name, target_band, primary_skill, status, teacher_id, start_date)
			 VALUES ($1,$2,$3,$4::numeric,$5,'active',$6,$7::date) ON CONFLICT (id) DO NOTHING`,
			classActive, p.centerID, SyntheticMarker+"Class Active "+p.tag, "6.5", "writing", teacherID, "2026-01-06",
		); err != nil {
			return err
		}
		if err := do(
			`INSERT INTO classes (id, center_id, name, target_band, primary_skill, status, teacher_id, start_date, ended_at)
			 VALUES ($1,$2,$3,$4::numeric,$5,'ended',$6,$7::date,$8) ON CONFLICT (id) DO NOTHING`,
			classEnded, p.centerID, SyntheticMarker+"Class Ended "+p.tag, "6.0", "reading", teacherID, "2025-10-01", seedEpoch,
		); err != nil {
			return err
		}

		// --- Epic 3.5b: a session on the active class (for attendance) ------
		session1 := seedUUID(blockSession, p.letter, 1)
		if err := do(
			`INSERT INTO sessions (id, center_id, class_id, topic, starts_at, ends_at)
			 VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
			session1, p.centerID, classActive, SyntheticMarker+"Session 1 "+p.tag,
			seedEpoch, seedEpoch.Add(90*time.Minute),
		); err != nil {
			return err
		}

		// --- Epic 3.4.5: enrollments ----------------------------------------
		for i, sid := range []string{student1, student2} {
			if err := do(
				`INSERT INTO enrollments (id, center_id, student_id, class_id)
				 VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
				seedUUID(blockEnrollment, p.letter, i+1), p.centerID, sid, classActive,
			); err != nil {
				return err
			}
		}

		// --- Epic 4/5: exercises × 4 skills, assignments, submissions -------
		for i, skill := range seededSkills {
			n := i + 1
			exID := seedUUID(blockExercise, p.letter, n)
			if err := do(
				`INSERT INTO exercises (id, center_id, created_by, code, title, skill, content)
				 VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT (id) DO NOTHING`,
				exID, p.centerID, teacherID,
				fmt.Sprintf("%s%s-%s-%02d", SyntheticMarker, p.tag, skill[:1], n),
				fmt.Sprintf("%sExercise %s %s", SyntheticMarker, skill, p.tag),
				skill, `{"sections":[]}`,
			); err != nil {
				return err
			}
			asID := seedUUID(blockAssignment, p.letter, n)
			if err := do(
				`INSERT INTO assignments (id, center_id, exercise_id, class_id, created_by, deadline_at, instructions)
				 VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
				asID, p.centerID, exID, classActive, teacherID,
				seedEpoch.Add(7*24*time.Hour), SyntheticMarker+"Instructions "+skill,
			); err != nil {
				return err
			}
			subID := seedUUID(blockSubmission, p.letter, n)
			if err := do(
				`INSERT INTO submissions (id, center_id, assignment_id, student_id, status, content)
				 VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT (id) DO NOTHING`,
				subID, p.centerID, asID, student1, submissionStatuses[i],
				fmt.Sprintf(`{"marker":%q}`, SyntheticMarker),
			); err != nil {
				return err
			}
		}

		// --- Epic 6: a released grade on the graded (reading) submission ----
		gradedSub := seedUUID(blockSubmission, p.letter, 1)
		if err := do(
			`INSERT INTO grades
			   (id, submission_id, center_id, graded_by, version, criterion_scores, overall_band, comments, feedback, released_at)
			 VALUES ($1,$2,$3,$4,1,$5::jsonb,$6::numeric,$7::jsonb,$8,$9) ON CONFLICT (id) DO NOTHING`,
			seedUUID(blockGrade, p.letter, 1), gradedSub, p.centerID, teacherID,
			`{"task_response":6.5,"coherence":6.5}`, "6.5", `[]`,
			SyntheticMarker+"synthetic examiner feedback — NOT ground truth (DD12)",
			seedEpoch.Add(8*24*time.Hour),
		); err != nil {
			return err
		}

		// --- Epic 3.5b: attendance ------------------------------------------
		if err := do(
			`INSERT INTO attendance (id, center_id, session_id, student_id, status, marked_by)
			 VALUES ($1,$2,$3,$4,'present',$5) ON CONFLICT (id) DO NOTHING`,
			seedUUID(blockAttendance, p.letter, 1), p.centerID, session1, student1, teacherID,
		); err != nil {
			return err
		}

		// --- Epic 4.4: a knowledge-hub file ---------------------------------
		fileID := seedUUID(blockFile, p.letter, 1)
		if err := do(
			`INSERT INTO files (id, center_id, name, slug, object_key, content_type, size_bytes, uploaded_by)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
			fileID, p.centerID,
			SyntheticMarker+"Handout "+p.tag,
			SyntheticMarker+"handout-"+p.tag,
			fmt.Sprintf("%s/knowledge/%s.pdf", p.centerID, fileID),
			"application/pdf", int64(12345), teacherID,
		); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return SeededCenter{}, err
	}
	return center, nil
}

// firstLine trims a multi-line SQL string to its first line for error context.
func firstLine(sql string) string {
	sql = strings.TrimSpace(sql)
	if i := strings.IndexByte(sql, '\n'); i >= 0 {
		return strings.TrimSpace(sql[:i])
	}
	return sql
}
