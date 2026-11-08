package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"github.com/KDF5000/steer/server/internal/apns"
	"github.com/KDF5000/steer/server/internal/store"
	"github.com/google/uuid"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

func WithWatchNotifications(client *apns.Client) Option {
	return func(s *Server) { s.watchPush = client }
}
func (s *Server) watchNotificationStatus(w http.ResponseWriter, r *http.Request) {
	topic := ""
	if s.watchPush != nil {
		topic = s.watchPush.Topic()
	}
	writeJSON(w, http.StatusOK, map[string]any{"enabled": s.watchPush != nil, "topic": topic})
}
func bindingHash(value string) string {
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}
func (s *Server) registerWatchDevice(w http.ResponseWriter, r *http.Request) {
	if s.watchPush == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"code": "watch_push_unconfigured", "error": "Background notifications are not configured on this server."})
		return
	}
	var in struct{ ID, BindingSecret, AccountFingerprint, Token, Topic, Environment string }
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, err)
		return
	}
	token, tokenErr := hex.DecodeString(in.Token)
	proof, proofErr := hex.DecodeString(in.BindingSecret)
	fingerprint, fpErr := hex.DecodeString(in.AccountFingerprint)
	if _, err := uuid.Parse(in.ID); err != nil || tokenErr != nil || len(token) < 16 || len(token) > 128 || proofErr != nil || len(proof) != 32 || fpErr != nil || len(fingerprint) != 32 || in.Topic != s.watchPush.Topic() || (in.Environment != "sandbox" && in.Environment != "production") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid watch device registration."})
		return
	}
	d := store.WatchPushDevice{ID: in.ID, WorkspaceID: s.workspace(r), BindingHash: bindingHash(in.BindingSecret), AccountFingerprint: in.AccountFingerprint, Token: strings.ToLower(in.Token), Topic: in.Topic, Environment: in.Environment}
	if key, ok := r.Context().Value(apiKeyContextKey).(store.WorkspaceAPIKey); ok {
		d.APIKeyID = &key.ID
	}
	if err := s.store.RegisterWatchPush(r.Context(), d); err != nil {
		if errors.Is(err, store.ErrWatchBinding) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "Watch binding proof does not match."})
			return
		}
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"enabled": true})
}
func (s *Server) removeWatchDevice(w http.ResponseWriter, r *http.Request) {
	var in struct{ BindingSecret string }
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, err)
		return
	}
	if err := s.store.RemoveWatchPush(r.Context(), s.workspace(r), r.PathValue("id"), bindingHash(in.BindingSecret)); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"removed": true})
}
func (s *Server) StartWatchNotifications(ctx context.Context) func() {
	if s.watchPush == nil {
		return func() {}
	}
	ctx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			if err := s.store.EnqueueWatchPush(ctx, s.watchPush.Topic()); err != nil && ctx.Err() == nil {
				slog.Warn("watch notification queue", "error", err)
			}
			items, err := s.store.ClaimWatchPush(ctx, 3)
			if err != nil && ctx.Err() == nil {
				slog.Warn("watch notification claim", "error", err)
			}
			for _, item := range items {
				if ctx.Err() != nil {
					return
				}
				label := "任务已完成"
				if item.Status == "failed" {
					label = "任务执行失败"
				}
				title := []rune(item.Title)
				if len(title) > 80 {
					title = title[:80]
				}
				agent := []rune(item.AgentName)
				if len(agent) > 60 {
					agent = agent[:60]
				}
				// Keep push payloads small. The full result is fetched with the current key
				// after the user opens the corresponding task.
				payload := map[string]any{"aps": map[string]any{"alert": map[string]string{"title": label, "body": string(title)}, "sound": "default", "thread-id": item.ConversationID, "category": "STEER_TASK"},
					"taskId": item.TaskID, "conversationId": item.ConversationID, "title": string(title), "agentId": item.AgentID, "agentName": string(agent), "projectName": item.ProjectName,
					"status": item.Status, "accountFingerprint": item.Device.AccountFingerprint}
				// Tasks carry the executing Agent; the current session metadata is fetched
				// on open before any continuation is submitted.
				err := s.watchPush.Send(ctx, item.Device.Token, item.Device.Environment, item.ID, uuid.NewSHA1(uuid.NameSpaceURL, []byte(item.TaskID)).String(), payload)
				invalid := false
				var rejected apns.Error
				if errors.As(err, &rejected) {
					invalid = rejected.InvalidToken()
				}
				if err != nil && ctx.Err() == nil {
					slog.Warn("watch notification delivery", "task_id", item.TaskID, "error", err)
				}
				if err := s.store.FinishWatchPush(ctx, item, err == nil, invalid); err != nil && ctx.Err() == nil {
					slog.Warn("watch notification result", "error", err)
				}
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	return func() { cancel(); <-done }
}
