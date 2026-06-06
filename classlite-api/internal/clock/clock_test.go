package clock_test

import (
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
)

func TestMockClock_NowReturnsAnchor(t *testing.T) {
	anchor := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	c := clock.NewMockClock(anchor)

	if !c.Now().Equal(anchor) {
		t.Fatalf("expected Now() to return anchor %v, got %v", anchor, c.Now())
	}
}

func TestMockClock_SleepAdvancesTimeWithoutBlocking(t *testing.T) {
	anchor := time.Date(2026, 6, 5, 0, 0, 0, 0, time.UTC)
	c := clock.NewMockClock(anchor)

	start := time.Now()
	c.Sleep(72 * time.Hour) // 3 days
	wallElapsed := time.Since(start)

	if wallElapsed > 10*time.Millisecond {
		t.Fatalf("mock Sleep blocked the wall clock (%v); should return instantly", wallElapsed)
	}

	expected := anchor.Add(72 * time.Hour)
	if !c.Now().Equal(expected) {
		t.Fatalf("expected Now() to advance to %v, got %v", expected, c.Now())
	}
}

func TestMockClock_AdvanceJumpsForward(t *testing.T) {
	anchor := time.Date(2026, 6, 5, 0, 0, 0, 0, time.UTC)
	c := clock.NewMockClock(anchor)

	c.Advance(24 * time.Hour)
	c.Advance(48 * time.Hour)

	expected := anchor.Add(72 * time.Hour)
	if !c.Now().Equal(expected) {
		t.Fatalf("expected Now() = %v after two Advance calls, got %v", expected, c.Now())
	}
}

func TestMockClock_SetMovesToAbsoluteTime(t *testing.T) {
	c := clock.NewMockClock(time.Date(2026, 6, 5, 0, 0, 0, 0, time.UTC))

	target := time.Date(2026, 6, 12, 23, 59, 0, 0, time.UTC)
	c.Set(target)

	if !c.Now().Equal(target) {
		t.Fatalf("expected Now() = %v after Set, got %v", target, c.Now())
	}
}

func TestMockClock_SleepsAreRecorded(t *testing.T) {
	c := clock.NewMockClock(time.Now())

	c.Sleep(30 * time.Second)
	c.Sleep(2 * time.Minute)
	c.Sleep(8 * time.Minute)

	got := c.Sleeps()
	want := []time.Duration{30 * time.Second, 2 * time.Minute, 8 * time.Minute}

	if len(got) != len(want) {
		t.Fatalf("expected %d recorded sleeps, got %d", len(want), len(got))
	}
	for i, d := range want {
		if got[i] != d {
			t.Fatalf("sleep[%d]: expected %v, got %v", i, d, got[i])
		}
	}
}

func TestRealClock_NowIsLive(t *testing.T) {
	c := clock.RealClock{}

	before := time.Now()
	got := c.Now()
	after := time.Now()

	if got.Before(before) || got.After(after) {
		t.Fatalf("RealClock.Now() returned %v outside [%v, %v]", got, before, after)
	}
}
