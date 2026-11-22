package store

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestDisablingSessionApprovalWaitsForInFlightResolution(t *testing.T) {
	url := os.Getenv("STEER_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set STEER_TEST_DATABASE_URL for integration tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	s, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err := s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	wid, id := uuid.NewString(), uuid.NewString()
	if err := s.EnsureWorkspace(ctx, wid, "Approval test"); err != nil {
		t.Fatal(err)
	}
	a, err := s.CreateAgent(ctx, wid, Agent{Name: "Test", RuntimeProvider: "antigravity"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.EnsureSession(ctx, wid, id, "Test", a.ID, nil, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetSessionAutoApproval(ctx, wid, id, true); err != nil {
		t.Fatal(err)
	}
	started, release := make(chan struct{}), make(chan struct{})
	approving := make(chan error, 1)
	go func() {
		approving <- s.WithSessionAutoApproval(ctx, wid, id, func() error {
			close(started)
			select {
			case <-release:
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		})
	}()
	select {
	case <-started:
	case err := <-approving:
		t.Fatal(err)
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	disabled := make(chan error, 1)
	go func() { _, err := s.SetSessionAutoApproval(ctx, wid, id, false); disabled <- err }()
	select {
	case err := <-disabled:
		close(release)
		t.Fatalf("disable returned before in-flight approval: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	close(release)
	if err := <-approving; err != nil {
		t.Fatal(err)
	}
	if err := <-disabled; err != nil {
		t.Fatal(err)
	}
	called := false
	if err := s.WithSessionAutoApproval(ctx, wid, id, func() error { called = true; return nil }); err != nil || called {
		t.Fatal("worker used a revoked grant")
	}
}
