package api

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/KDF5000/steer/server/internal/store"
)

func (s *Server) writeCodebaseWebhook(w http.ResponseWriter, item store.CodebaseWebhook) {
	token, err := s.decryptCredential(item.EncryptedToken)
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	// Return a relative callback path. The owner supplies their reachable server
	// address; never trust a request Host header to construct credential-bearing URLs.
	writeJSON(w, http.StatusOK, map[string]any{"workspaceId": item.WorkspaceID, "enabled": item.Enabled, "updatedAt": item.UpdatedAt, "callbackPath": "/api/v1/codebase/webhooks/" + url.PathEscape(item.WorkspaceID) + "?token=" + url.QueryEscape(token)})
}

func (s *Server) codebaseWebhook(w http.ResponseWriter, r *http.Request) {
	item, err := s.store.CodebaseWebhook(r.Context(), s.workspace(r))
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusOK, nil)
		return
	}
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	s.writeCodebaseWebhook(w, item)
}

func (s *Server) saveCodebaseWebhook(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Enabled     bool `json:"enabled"`
		RotateToken bool `json:"rotateToken"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeCodebaseError(w, invalidCodebase("Invalid Codebase webhook configuration."))
		return
	}
	item, err := s.store.CodebaseWebhook(r.Context(), s.workspace(r))
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		writeCodebaseError(w, err)
		return
	}
	item.WorkspaceID = s.workspace(r)
	item.Enabled = input.Enabled
	if errors.Is(err, store.ErrNotFound) || input.RotateToken {
		secret := make([]byte, 32)
		if _, err = rand.Read(secret); err != nil {
			writeCodebaseError(w, err)
			return
		}
		token := base64.RawURLEncoding.EncodeToString(secret)
		item.TokenHash = tokenHash(token)
		item.EncryptedToken, err = s.encryptCredential(token)
		if err != nil {
			writeCodebaseError(w, err)
			return
		}
	}
	item, err = s.store.SaveCodebaseWebhook(r.Context(), item)
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	s.writeCodebaseWebhook(w, item)
}

func (s *Server) receiveCodebaseWebhook(w http.ResponseWriter, r *http.Request) {
	item, err := s.store.CodebaseWebhook(r.Context(), r.PathValue("workspace"))
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		writeCodebaseError(w, err)
		return
	}
	provided := r.URL.Query().Get("token")
	if err != nil || !item.Enabled || provided == "" || len(provided) > 256 || subtle.ConstantTimeCompare([]byte(tokenHash(provided)), []byte(item.TokenHash)) != 1 {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Invalid webhook credential."})
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, (1<<20)+1))
	if err != nil || len(body) > 1<<20 {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "Webhook body exceeds the size limit."})
		return
	}
	// Store the complete JSON for durable processing. The worker interprets
	// supported provider event formats after the delivery has been accepted.
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	var payload map[string]any
	if err = decoder.Decode(&payload); err != nil || payload == nil {
		writeCodebaseError(w, invalidCodebase("Webhook body must be a JSON object."))
		return
	}
	var extra any
	if err = decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		writeCodebaseError(w, invalidCodebase("Webhook body must contain one JSON object."))
		return
	}
	canonical, err := json.Marshal(payload)
	if err != nil {
		writeCodebaseError(w, invalidCodebase("Invalid webhook JSON."))
		return
	}
	event, duplicate, err := s.store.AcceptCodebaseWebhook(r.Context(), item.WorkspaceID, item.TokenHash, tokenHash(string(canonical)), canonical)
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Invalid webhook credential."})
		return
	}
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	slog.Info("codebase webhook received", "workspace_id", item.WorkspaceID,
		"event_id", event.ID, "duplicate", duplicate)
	writeJSON(w, http.StatusAccepted, map[string]any{"received": true, "duplicate": duplicate, "eventId": event.ID})
	// Interpret the event right away so a review starts without waiting for the
	// background ticker. The worker claim keeps this single-delivery even when
	// the ticker runs at the same time.
	if !duplicate {
		eventCtx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), time.Minute)
		go func() {
			defer cancel()
			s.processCodebaseWebhookEvent(eventCtx, event)
		}()
	}
}

// Stream durable receipt IDs from the shared database. This works across server
// instances and reconnects, without querying Codebase periodically.
func (s *Server) codebaseWebhookStream(w http.ResponseWriter, r *http.Request) {
	after := int64(0)
	value := r.URL.Query().Get("after")
	if value == "" {
		value = r.Header.Get("Last-Event-ID")
	}
	if value != "" {
		var err error
		after, err = strconv.ParseInt(value, 10, 64)
		if err != nil || after < 0 {
			writeCodebaseError(w, invalidCodebase("Invalid webhook event cursor."))
			return
		}
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeCodebaseError(w, errors.New("streaming is unavailable"))
		return
	}
	items, err := s.store.CodebaseWebhookEvents(r.Context(), s.workspace(r), after)
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		for _, item := range items {
			data, _ := json.Marshal(item)
			if _, err = fmt.Fprintf(w, "id: %d\nevent: codebase.received\ndata: %s\n\n", item.ID, data); err != nil {
				return
			}
			after = item.ID
		}
		if _, err = io.WriteString(w, ": keepalive\n\n"); err != nil {
			return
		}
		flusher.Flush()
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
		}
		items, err = s.store.CodebaseWebhookEvents(r.Context(), s.workspace(r), after)
		if err != nil {
			return
		}
	}
}
