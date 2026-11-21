package api

import (
	"context"
	"log/slog"
	"time"

	"github.com/KDF5000/steer/server/internal/store"
)

// StartCodebaseWorkers keeps webhook-triggered reviews moving and publishes
// finished reviews back to Codebase when no browser is open. Reviews started
// from the UI are also covered, so a closed tab cannot strand a run.
func (s *Server) StartCodebaseWorkers(ctx context.Context) func() {
	ctx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		tick := time.NewTicker(4 * time.Second)
		defer tick.Stop()
		for {
			s.runCodebaseWorkCycle(ctx)
			select {
			case <-ctx.Done():
				return
			case <-tick.C:
			}
		}
	}()
	return func() { cancel(); <-done }
}

func (s *Server) runCodebaseWorkCycle(ctx context.Context) {
	s.processPendingCodebaseWebhooks(ctx)
	s.syncActiveCodebaseRuns(ctx)
	s.retryCodebaseReports(ctx)
}

func (s *Server) processPendingCodebaseWebhooks(ctx context.Context) {
	events, err := s.store.PendingCodebaseWebhookEventsAll(ctx, 50)
	if err != nil {
		if ctx.Err() == nil {
			slog.Warn("codebase webhook queue", "error", err)
		}
		return
	}
	for _, event := range events {
		if ctx.Err() != nil {
			return
		}
		eventCtx, stop := context.WithTimeout(ctx, 60*time.Second)
		s.processCodebaseWebhookEvent(eventCtx, event)
		stop()
	}
}

// syncActiveCodebaseRuns groups by workspace because task lookups and Relay
// syncs are workspace scoped.
func (s *Server) syncActiveCodebaseRuns(ctx context.Context) {
	runs, err := s.store.ActiveCodebaseRuns(ctx, 50)
	if err != nil {
		if ctx.Err() == nil {
			slog.Warn("codebase active runs", "error", err)
		}
		return
	}
	grouped := make(map[string][]store.CodebaseRun)
	for _, run := range runs {
		grouped[run.WorkspaceID] = append(grouped[run.WorkspaceID], run)
	}
	for wid, items := range grouped {
		if ctx.Err() != nil {
			return
		}
		runCtx, stop := context.WithTimeout(ctx, 90*time.Second)
		s.syncCodebaseRuns(runCtx, wid, items, len(items))
		stop()
	}
}

func (s *Server) retryCodebaseReports(ctx context.Context) {
	runs, err := s.store.CodebaseRunsNeedingReport(ctx, 20)
	if err != nil {
		if ctx.Err() == nil {
			slog.Warn("codebase report queue", "error", err)
		}
		return
	}
	for _, run := range runs {
		if ctx.Err() != nil {
			return
		}
		runCtx, stop := context.WithTimeout(ctx, 30*time.Second)
		if _, reportErr := s.reportCodebaseRun(runCtx, run.WorkspaceID, run); reportErr != nil && ctx.Err() == nil {
			slog.Warn("codebase report", "run_id", run.ID, "error", reportErr)
		}
		stop()
	}
}
