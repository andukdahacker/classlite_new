package event

// Domain event type constants.
const (
	GradeReleased     = "grade.released"
	AssignmentCreated = "assignment.created"
	EnrollmentChanged = "enrollment.changed"
	QuestionAsked     = "question.asked"
	ScheduleChanged   = "schedule.changed"
	PaymentFailed     = "payment.failed"
	// StorageThresholdCrossed fires when a center's cumulative storage usage first
	// crosses the 95% notify threshold on an upload confirm (Story 10.1a, DD4).
	StorageThresholdCrossed = "storage.threshold.crossed"
)
