// search_query_handling_atdd_test.go — Story 8-4a (AC2/AC3/AC4/AC5/AC11 · D6/D7/D9/D11
// · R-3/R-4 · WF-8 HARD GATE). Query handling: min-length/trim/rune, wildcard escape,
// accent-insensitivity, max-5/hasMore/tiebreak + the PROVISIONAL contract value-scan,
// and the student fan-out-one-row guard.
//
// GREEN-PHASE (authored red-first per [[reference_atdd_red_convention]]; committed
// un-tagged). All callers are owners (simplest scope) unless the AC needs a student.
// Value-scan asserts (Murat C6): type matches the array, slug non-null ONLY for a
// file, classId non-null ONLY for an assignment.
package test

import (
	"strings"
	"testing"
)

// AC2 — a blank/whitespace/<3-rune/missing q returns 200 with every category empty
// (non-null items) — trim applied, rune-not-byte counted, "type more" is not a 422.
func TestSearch_MinLength_ResponseShape_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)
	teacher := CreateUser(t, db, "t@ml.test", "Teacher ML")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")
	owner := CreateUser(t, db, "o@ml.test", "Owner ML")
	CreateCenterMember(t, db, owner.ID, center.ID, "owner")
	tID := dashPGToUUID(t, teacher.ID)
	// A class matching "abc" so the trim case has a positive control.
	searchSeedClass(t, db, cid, tID, "abc Delta Class")

	srv := NewSearchTestServerForRole(t, db, owner.ID, UUIDString(center.ID), "owner")

	// Empty categories, non-null items, 200 — for blank / short / rune-not-byte.
	for _, q := range []string{"", "   ", "ab", " é"} {
		rec, env := searchDo(t, srv, q)
		if rec.Code != 200 {
			t.Errorf("AC2 q=%q want 200, got %d", q, rec.Code)
			continue
		}
		if strings.Contains(rec.Body.String(), `"items":null`) {
			t.Errorf("AC2 q=%q emitted a null items array — must be [] (GO-5)", q)
		}
		for name, cat := range map[string]int{
			"classes": len(env.Data.Classes.Items), "students": len(env.Data.Students.Items),
			"exercises": len(env.Data.Exercises.Items), "assignments": len(env.Data.Assignments.Items),
			"files": len(env.Data.Files.Items),
		} {
			if cat != 0 {
				t.Errorf("AC2 q=%q: %s must be empty, got %d items", q, name, cat)
			}
		}
	}

	// Trim: "  abc  " → "abc" (3 runes) matches the seeded class (a would-match control
	// — proves the <3 empties above are the floor, not missing data).
	rec, env := searchDo(t, srv, "  abc  ")
	if rec.Code != 200 {
		t.Fatalf("AC2 trim want 200, got %d", rec.Code)
	}
	if !searchCategoryHasTitle(env.Data.Classes, "abc Delta Class") {
		t.Errorf("AC2 trim control: q=\"  abc  \" must match the seeded \"abc Delta Class\" (trim applied)")
	}
}

// AC3 — LIKE metacharacters are escaped before the ILIKE pattern: literal `_` matches
// only the literal; `%` is not a live wildcard; a trailing `\` is 200 not 500; the
// escape order (`\` first) makes a `\`+`%` query match its literal.
func TestSearch_WildcardEscaping_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)
	teacher := CreateUser(t, db, "t@wc.test", "Teacher WC")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")
	owner := CreateUser(t, db, "o@wc.test", "Owner WC")
	CreateCenterMember(t, db, owner.ID, center.ID, "owner")
	tID := dashPGToUUID(t, teacher.ID)

	searchSeedClass(t, db, cid, tID, "a_b")       // literal underscore
	searchSeedClass(t, db, cid, tID, "axb")       // must NOT match "a_b"
	searchSeedClass(t, db, cid, tID, "Alpha One") // % must not sweep it in
	searchSeedExercise(t, db, cid, tID, `a\%z`)   // literal backslash+percent+z
	searchSeedExercise(t, db, cid, tID, "abcz")   // must NOT match the \% query

	srv := NewSearchTestServerForRole(t, db, owner.ID, UUIDString(center.ID), "owner")

	// literal underscore matches only "a_b", not "axb".
	_, env := searchDo(t, srv, "a_b")
	if !searchCategoryHasTitle(env.Data.Classes, "a_b") {
		t.Errorf("AC3: q=\"a_b\" must match literal \"a_b\"")
	}
	if searchCategoryHasTitle(env.Data.Classes, "axb") {
		t.Errorf("AC3 WILDCARD LEAK: q=\"a_b\" matched \"axb\" — the `_` was not escaped")
	}

	// "%%%" (3 runes) is not a live wildcard — it must NOT sweep in "Alpha One".
	_, env = searchDo(t, srv, "%%%")
	if searchCategoryHasTitle(env.Data.Classes, "Alpha One") {
		t.Errorf("AC3 WILDCARD LEAK: q=\"%%%%%%\" returned everything — the `%%` was not escaped")
	}

	// Trailing backslash → 200, not a 500.
	if rec, _ := searchDo(t, srv, `ab\`); rec.Code != 200 {
		t.Errorf("AC3: q ending in backslash must be 200 (escaped), got %d", rec.Code)
	}

	// Escape order (`\` first): a `\`+`%` query matches its literal, not "abcz".
	_, env = searchDo(t, srv, `a\%z`)
	if !searchCategoryHasTitle(env.Data.Exercises, `a\%z`) {
		t.Errorf(`AC3: q=%q must match the literal exercise (escape order: \ first)`, `a\%z`)
	}
	if searchCategoryHasTitle(env.Data.Exercises, "abcz") {
		t.Errorf(`AC3 ESCAPE-ORDER BUG: q=%q matched "abcz"`, `a\%z`)
	}
}

// AC5 — accent-insensitive across categories: "Nguyen" matches "Nguyễn…", "Toan"
// matches "Toán…", and "Nguyễn" still matches a plain "Nguyen…" (both sides unaccented).
func TestSearch_AccentInsensitive_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)
	teacher := CreateUser(t, db, "t@ac.test", "Teacher AC")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")
	owner := CreateUser(t, db, "o@ac.test", "Owner AC")
	CreateCenterMember(t, db, owner.ID, center.ID, "owner")
	tID := dashPGToUUID(t, teacher.ID)

	searchSeedStudentNamed(t, db, cid, "diacritic@ac.test", "Nguyễn Văn A")
	searchSeedStudentNamed(t, db, cid, "plain@ac.test", "Nguyen Van B")
	searchSeedClass(t, db, cid, tID, "Toán Nâng Cao")

	srv := NewSearchTestServerForRole(t, db, owner.ID, UUIDString(center.ID), "owner")

	if _, env := searchDo(t, srv, "Nguyen"); !searchCategoryHasTitle(env.Data.Students, "Nguyễn Văn A") {
		t.Errorf(`AC5: q="Nguyen" must match diacritic student "Nguyễn Văn A"`)
	}
	if _, env := searchDo(t, srv, "Toan"); !searchCategoryHasTitle(env.Data.Classes, "Toán Nâng Cao") {
		t.Errorf(`AC5: q="Toan" must match class "Toán Nâng Cao"`)
	}
	if _, env := searchDo(t, srv, "Nguyễn"); !searchCategoryHasTitle(env.Data.Students, "Nguyen Van B") {
		t.Errorf(`AC5: q="Nguyễn" must match plain student "Nguyen Van B" (both sides unaccented)`)
	}
}

// AC4 — a category with >5 matches returns exactly 5 + hasMore=true; ≤5 → hasMore=false;
// the ,id tiebreak makes the slice DETERMINISTIC across calls for equal-similarity rows.
func TestSearch_MaxFive_HasMore_Tiebreak_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)
	teacher := CreateUser(t, db, "t@mf.test", "Teacher MF")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")
	owner := CreateUser(t, db, "o@mf.test", "Owner MF")
	CreateCenterMember(t, db, owner.ID, center.ID, "owner")
	tID := dashPGToUUID(t, teacher.ID)

	// 7 classes with the IDENTICAL name → equal similarity → the ,id tiebreak alone
	// determines the slice (falsifies a missing tiebreak, which would be unstable).
	for i := 0; i < 7; i++ {
		searchSeedClass(t, db, cid, tID, "Popular Class")
	}
	// 3 classes with a distinct token → ≤5 → hasMore=false.
	for i := 0; i < 3; i++ {
		searchSeedClass(t, db, cid, tID, "Raretoken Class")
	}

	srv := NewSearchTestServerForRole(t, db, owner.ID, UUIDString(center.ID), "owner")

	_, env1 := searchDo(t, srv, "Popular")
	if len(env1.Data.Classes.Items) != 5 {
		t.Errorf("AC4: 7 matches must return exactly 5 items, got %d", len(env1.Data.Classes.Items))
	}
	if !env1.Data.Classes.HasMore {
		t.Errorf("AC4: 7 matches must set hasMore=true")
	}
	// Determinism: a second identical query returns the SAME 5 ids in the SAME order.
	_, env2 := searchDo(t, srv, "Popular")
	for i := range env1.Data.Classes.Items {
		if env1.Data.Classes.Items[i].ID != env2.Data.Classes.Items[i].ID {
			t.Errorf("AC4 TIEBREAK: equal-similarity slice is non-deterministic at index %d (%s vs %s) — the ,id tiebreak is missing",
				i, env1.Data.Classes.Items[i].ID, env2.Data.Classes.Items[i].ID)
		}
	}

	_, env3 := searchDo(t, srv, "Raretoken")
	if len(env3.Data.Classes.Items) != 3 || env3.Data.Classes.HasMore {
		t.Errorf("AC4: 3 matches must return 3 items + hasMore=false, got %d items hasMore=%v",
			len(env3.Data.Classes.Items), env3.Data.Classes.HasMore)
	}
}

// AC4 (contract) — the PROVISIONAL value-scan: each item's type matches its array;
// slug is non-null ONLY for a file; classId is non-null ONLY for an assignment (D6/D10).
func TestSearch_ContractValueScan_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)
	teacher := CreateUser(t, db, "t@ct.test", "Teacher CT")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")
	owner := CreateUser(t, db, "o@ct.test", "Owner CT")
	CreateCenterMember(t, db, owner.ID, center.ID, "owner")
	tID := dashPGToUUID(t, teacher.ID)

	const tok = "Contract"
	class := searchSeedClass(t, db, cid, tID, tok+" Class")
	ex := searchSeedExercise(t, db, cid, tID, tok+" Ex")
	searchSeedAssignment(t, db, cid, class, ex, tID)
	searchSeedFile(t, db, cid, tID, tok+" File")
	st := searchSeedStudentNamed(t, db, cid, "student@ct.test", tok+" Student")
	insertEnrollmentRaw(t, db, cid, st, class, "active")

	srv := NewSearchTestServerForRole(t, db, owner.ID, UUIDString(center.ID), "owner")
	_, env := searchDo(t, srv, tok)

	// Type matches array; slug/classId non-null ONLY for their type.
	for _, it := range env.Data.Classes.Items {
		if it.Type != "class" {
			t.Errorf("AC4 value-scan: class item has type %q", it.Type)
		}
		if it.Slug != nil || it.ClassID != nil {
			t.Errorf("AC4 value-scan: class item must have null slug+classId")
		}
	}
	for _, it := range env.Data.Students.Items {
		if it.Type != "student" || it.Slug != nil || it.ClassID != nil {
			t.Errorf("AC4 value-scan: student item type/slug/classId wrong (type=%q)", it.Type)
		}
	}
	for _, it := range env.Data.Exercises.Items {
		if it.Type != "exercise" || it.Slug != nil || it.ClassID != nil {
			t.Errorf("AC4 value-scan: exercise item type/slug/classId wrong (type=%q)", it.Type)
		}
		if it.Subtitle == nil || *it.Subtitle != "writing" {
			t.Errorf("AC4 subtitle: exercise subtitle must be its skill (\"writing\"), got %v", it.Subtitle)
		}
	}
	if len(env.Data.Assignments.Items) == 0 {
		t.Fatalf("AC4 value-scan: expected an assignment item")
	}
	for _, it := range env.Data.Assignments.Items {
		if it.Type != "assignment" {
			t.Errorf("AC4 value-scan: assignment item has type %q", it.Type)
		}
		if it.ClassID == nil || *it.ClassID != class.String() {
			t.Errorf("AC4 value-scan: assignment classId must be the parent class %s, got %v", class, it.ClassID)
		}
		if it.Slug != nil {
			t.Errorf("AC4 value-scan: assignment slug must be null")
		}
	}
	if len(env.Data.Files.Items) == 0 {
		t.Fatalf("AC4 value-scan: expected a file item")
	}
	for _, it := range env.Data.Files.Items {
		if it.Type != "file" {
			t.Errorf("AC4 value-scan: file item has type %q", it.Type)
		}
		if it.Slug == nil || *it.Slug == "" {
			t.Errorf("AC4 value-scan: file slug must be non-null (its route key)")
		}
		if it.ClassID != nil {
			t.Errorf("AC4 value-scan: file classId must be null")
		}
	}
}

// AC11 — a student enrolled in MANY classes appears EXACTLY ONCE (per-student scalar
// subtitle, not a flat-JOIN fan-out that would return N rows / <5 distinct, D11/R-4).
func TestSearch_StudentFanOutOneRow_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)
	teacher := CreateUser(t, db, "t@fo.test", "Teacher FO")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")
	owner := CreateUser(t, db, "o@fo.test", "Owner FO")
	CreateCenterMember(t, db, owner.ID, center.ID, "owner")
	tID := dashPGToUUID(t, teacher.ID)

	student := searchSeedStudentNamed(t, db, cid, "fanout@fo.test", "Fanout Student")
	for i := 0; i < 5; i++ {
		c := searchSeedClass(t, db, cid, tID, "Fanoutclass Number")
		insertEnrollmentRaw(t, db, cid, student, c, "active")
	}

	srv := NewSearchTestServerForRole(t, db, owner.ID, UUIDString(center.ID), "owner")
	_, env := searchDo(t, srv, "Fanout Student")

	count := 0
	var subtitle *string
	for _, it := range env.Data.Students.Items {
		if it.ID == student.String() {
			count++
			subtitle = it.Subtitle
		}
	}
	if count != 1 {
		t.Errorf("AC11 FAN-OUT: student in 5 classes appeared %d times, want exactly 1 (D11 scalar subtitle, not flat JOIN)", count)
	}
	if subtitle == nil || !strings.Contains(*subtitle, "Fanoutclass Number") {
		t.Errorf("AC11 subtitle: student subtitle must aggregate class name(s), got %v", subtitle)
	}
}
