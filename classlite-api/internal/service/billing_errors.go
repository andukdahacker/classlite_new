// Story 9.1a — billing typed errors (GO-2). VALUE types (value receiver) so the
// mapper + tests match with errors.As(err, &service.XxxError{}) — consistent with the
// 4.4a StorageFullError family and required by the ATDD reds'
// errors.As(err, &service.PlanLimitExceededError{}) / InsufficientCreditsError{}.
package service

import "fmt"

// PlanLimitExceededError → 409 PLAN_LIMIT_EXCEEDED (D8/D23). A write-time cap gate
// blocked a create/enrol/invite that would exceed the plan. Limit is a STABLE machine
// enum distinct from the display message; Current/Max name the shortfall; CanManageBilling
// tells the FE whether THIS caller can fix it (owner → "upgrade") or must ask the owner
// (teacher → "ask your center owner") — the enrolment-blocked teacher is not the owner
// who sees billing (D23).
type PlanLimitExceededError struct {
	Limit            string // studentsPerClass | teachers | classes | storage | aiCredits
	Current          int
	Max              int
	CanManageBilling bool
}

func (e PlanLimitExceededError) Error() string {
	return fmt.Sprintf("plan limit exceeded: %s at %d of %d", e.Limit, e.Current, e.Max)
}

// InsufficientCreditsError → 402 INSUFFICIENT_CREDITS (D8/D23). The pre-enqueue AI-credit
// gate blocked a job because the center's available balance is exhausted. Available is
// the current balance; Required names the gap ("you have 3, this needs 10" — always 1
// today, one credit == one job, D18).
type InsufficientCreditsError struct {
	Available int
	Required  int
}

func (e InsufficientCreditsError) Error() string {
	return fmt.Sprintf("insufficient AI credits: %d available, %d required", e.Available, e.Required)
}
