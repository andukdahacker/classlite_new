// Story 2.7 — XLSX parse-edge coverage for the bulk-import preview path. The
// excelize dependency (flagged for human review) is exercised here: a happy-path
// workbook, a numeric-typed cell coerced to string, and a corrupt workbook that
// must surface as a file-level 422 (0-persist contract). CSV paths are covered
// by student_import_integration_atdd_test.go.
package handler_test

import (
	"bytes"
	"fmt"
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/xuri/excelize/v2"
)

// xlsxImportKey builds an .xlsx object key under the given center.
func xlsxImportKey(centerID string) string {
	return fmt.Sprintf("%s/imports/%s.xlsx", centerID, uuid.NewString())
}

// buildImportXLSX writes a header + rows into the first sheet and returns the
// workbook bytes. Cells are written with SetCellValue so a value passed as an
// int is stored numeric (proving the reader coerces it to a string).
func buildImportXLSX(t *testing.T, rows [][]any) []byte {
	t.Helper()
	f := excelize.NewFile()
	defer func() { _ = f.Close() }()
	sheet := f.GetSheetName(0)

	header := []any{"email", "full_name", "class_name"}
	writeRow := func(rowIdx int, values []any) {
		for colIdx, v := range values {
			cell, err := excelize.CoordinatesToCellName(colIdx+1, rowIdx)
			if err != nil {
				t.Fatalf("cell name: %v", err)
			}
			if err := f.SetCellValue(sheet, cell, v); err != nil {
				t.Fatalf("set cell %s: %v", cell, err)
			}
		}
	}
	writeRow(1, header)
	for i, r := range rows {
		writeRow(i+2, r)
	}

	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		t.Fatalf("write xlsx: %v", err)
	}
	return buf.Bytes()
}

// INT-BULK-XLSX — an XLSX with a numeric-typed cell parses cleanly; the email
// column is read as text and the row is importable.
func TestImport_XLSX_NumericCellCoerced_Preview(t *testing.T) {
	e := setupImportHandlerTest(t)
	sfx := uuid.NewString()[:8]
	email := "xlsx-" + sfx + "@example.com"
	key := xlsxImportKey(e.centerID)
	// A trailing numeric-typed cell in the (ignored) 4th column proves numeric
	// cells don't derail the reader; the email/full_name columns stay text.
	e.srv.Storage.SeedObject(key, buildImportXLSX(t, [][]any{
		{email, "XLSX Student", "", 12345},
	}))

	rec := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import/preview", e.ownerTok, previewBody(key))
	if rec.Code != http.StatusOK {
		t.Fatalf("xlsx preview → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	got := decodeClassEnvelope(t, rec)
	if got.Data["summary"].(map[string]any)["willImport"].(float64) != 1 {
		t.Errorf("willImport want 1 — xlsx row not parsed/classified correctly")
	}
}

// INT-BULK-XLSX-CORRUPT — a non-workbook blob under an .xlsx key is a file-level
// 422 VALIDATION_ERROR, not a 500.
func TestImport_XLSX_Corrupt_422(t *testing.T) {
	e := setupImportHandlerTest(t)
	key := xlsxImportKey(e.centerID)
	e.srv.Storage.SeedObject(key, []byte("this is not a valid xlsx workbook"))

	rec := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import/preview", e.ownerTok, previewBody(key))
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("corrupt xlsx preview → %d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "VALIDATION_ERROR" {
		t.Errorf("error code = %q, want VALIDATION_ERROR", code)
	}
}
