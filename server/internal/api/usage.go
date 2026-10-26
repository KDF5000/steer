package api

import (
	"context"
	"log/slog"
	"time"
)

// Keep usage current when the browser closes or the task was started through
// Feishu/the Task API. The footprints read itself only queries PostgreSQL.
// One serial worker limits Relay traffic; snapshot upserts handle replicas.
func (s *Server) StartUsageSync(ctx context.Context) func() {
	ctx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		tick := time.NewTicker(5 * time.Second)
		defer tick.Stop()
		for {
			items, err := s.store.UsageSyncRuns(ctx, 20)
			if err != nil && ctx.Err() == nil {
				slog.Warn("usage sync queue", "error", err)
			}
			for _, item := range items {
				if ctx.Err() != nil {
					return
				}
				taskCtx, stop := context.WithTimeout(ctx, 10*time.Second)
				run, err := s.relay.GetRun(taskCtx, item.RunID)
				if err == nil {
					events, eventErr := s.relay.Events(taskCtx, item.RunID)
					if eventErr == nil {
						err = s.store.SaveRunUsage(taskCtx, item.WorkspaceID, run, events)
					} else {
						err = eventErr
					}
				}
				if err != nil && ctx.Err() == nil {
					markCtx, cancelMark := context.WithTimeout(ctx, 2*time.Second)
					_ = s.store.MarkUsageChecked(markCtx, item.WorkspaceID, item.RunID)
					cancelMark()
					slog.Debug("usage sync deferred", "run_id", item.RunID, "error", err)
				}
				stop()
			}
			select {
			case <-ctx.Done():
				return
			case <-tick.C:
			}
		}
	}()
	return func() { cancel(); <-done }
}
