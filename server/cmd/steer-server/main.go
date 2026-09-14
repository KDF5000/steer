package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	steerapi "github.com/KDF5000/steer/server/internal/api"
	"github.com/KDF5000/steer/server/internal/store"
)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	databaseURL := env("DATABASE_URL", "postgres://steer:steer@127.0.0.1:54329/steer")
	st, err := store.Open(ctx, databaseURL)
	if err != nil {
		slog.Error("database unavailable", "error", err)
		os.Exit(1)
	}
	defer st.Close()
	if err := st.Migrate(ctx); err != nil {
		slog.Error("migration failed", "error", err)
		os.Exit(1)
	}
	workspaceID := env("STEER_DEFAULT_WORKSPACE_ID", "default")
	if err := st.EnsureWorkspace(ctx, workspaceID, env("STEER_DEFAULT_WORKSPACE_NAME", "Personal workspace")); err != nil {
		slog.Error("workspace bootstrap failed", "error", err)
		os.Exit(1)
	}
	relayURL := env("RELAY_BASE_URL", "http://127.0.0.1:8787")
	handler := steerapi.New(st, relayURL, os.Getenv("RELAY_HOST_TOKEN"), env("RELAY_PUBLIC_URL", relayURL), workspaceID, strings.Split(env("STEER_ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"), ",")).Handler()
	server := &http.Server{Addr: env("STEER_ADDR", ":8080"), Handler: handler, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		slog.Info("Steer server listening", "address", server.Addr, "workspace", workspaceID)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server stopped", "error", err)
			os.Exit(1)
		}
	}()
	<-ctx.Done()
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	_ = server.Shutdown(shutdownCtx)
}
func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
