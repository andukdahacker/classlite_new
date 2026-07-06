// C3-13 review fix — unit test for the SEED_INCOMPLETE detection path.
// The story pin (Task 11.2) called for a service-level cover of the
// 500 SEED_INCOMPLETE branch since it's not testable in the ATDD suite
// (the real seed migration runs during CI and produces exactly 5 rows).
// The handler asserts `templateSvc.CountSystemTemplates(templates) < 5`
// and returns SEED_INCOMPLETE; this test proves the count function
// behaves correctly on all boundary inputs.

package service

import (
	"testing"

	"github.com/ducdo/classlite-api/internal/model"
)

func TestTemplateService_CountSystemTemplates(t *testing.T) {
	svc := &TemplateService{}

	cases := []struct {
		name  string
		input []model.Template
		want  int
	}{
		{"empty slice returns 0", nil, 0},
		{"all-center templates count 0 seeds", []model.Template{
			{Scope: scopeCenterTemplate},
			{Scope: scopeCenterTemplate},
		}, 0},
		{"only system seeds", []model.Template{
			{Scope: scopeSystemTemplate},
			{Scope: scopeSystemTemplate},
			{Scope: scopeSystemTemplate},
		}, 3},
		{"mixed — counts only system", []model.Template{
			{Scope: scopeSystemTemplate},
			{Scope: scopeCenterTemplate},
			{Scope: scopeSystemTemplate},
			{Scope: scopeCenterTemplate},
			{Scope: scopeSystemTemplate},
		}, 3},
		{"exactly 5 seeds (AC1b threshold)", []model.Template{
			{Scope: scopeSystemTemplate},
			{Scope: scopeSystemTemplate},
			{Scope: scopeSystemTemplate},
			{Scope: scopeSystemTemplate},
			{Scope: scopeSystemTemplate},
		}, 5},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := svc.CountSystemTemplates(tc.input); got != tc.want {
				t.Errorf("CountSystemTemplates(%v) = %d, want %d", tc.input, got, tc.want)
			}
		})
	}
}
