package api

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/KDF5000/steer/server/internal/store"
)

type sharedMessage struct {
	Role      string    `json:"role"`
	Content   string    `json:"content"`
	Status    string    `json:"status,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type sharedConversationSnapshot struct {
	Version   int             `json:"version"`
	Scope     string          `json:"scope"`
	Title     string          `json:"title"`
	Messages  []sharedMessage `json:"messages"`
	CreatedAt time.Time       `json:"createdAt"`
}

func (s *Server) shareSession(w http.ResponseWriter, r *http.Request) {
	wid := s.workspace(r)
	session, err := s.store.Session(r.Context(), wid, r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	messages, err := s.store.Messages(r.Context(), wid, session.ID)
	if err != nil {
		writeError(w, err)
		return
	}
	snapshot := sharedConversationSnapshot{
		Version:   2,
		Scope:     "conversation",
		Title:     session.Title,
		Messages:  shareableMessages(messages),
		CreatedAt: time.Now().UTC(),
	}
	s.createSharedConversation(w, r, session, nil, snapshot)
}

func (s *Server) shareMessage(w http.ResponseWriter, r *http.Request) {
	wid := s.workspace(r)
	message, err := s.store.Message(r.Context(), wid, r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	session, err := s.store.Session(r.Context(), wid, message.SessionID)
	if err != nil {
		writeError(w, err)
		return
	}
	snapshot := sharedConversationSnapshot{
		Version:   2,
		Scope:     "message",
		Title:     session.Title,
		Messages:  shareableMessages([]store.Message{message}),
		CreatedAt: time.Now().UTC(),
	}
	s.createSharedConversation(w, r, session, &message.ID, snapshot)
}

func shareableMessages(messages []store.Message) []sharedMessage {
	result := make([]sharedMessage, 0, len(messages))
	for _, message := range messages {
		if message.Role != "user" && message.Role != "agent" {
			continue
		}
		if strings.TrimSpace(message.Content) == "" {
			continue
		}
		result = append(result, sharedMessage{
			Role:      message.Role,
			Content:   message.Content,
			Status:    message.Status,
			CreatedAt: message.CreatedAt,
			UpdatedAt: message.UpdatedAt,
		})
	}
	return result
}

func (s *Server) createSharedConversation(w http.ResponseWriter, r *http.Request, session store.Session, messageID *string, snapshot sharedConversationSnapshot) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		writeError(w, err)
		return
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	payload, err := json.Marshal(snapshot)
	if err != nil {
		writeError(w, err)
		return
	}
	var createdBy *string
	if s.authEnabled {
		id := userFromContext(r.Context()).ID
		createdBy = &id
	}
	err = s.store.CreateSharedConversation(r.Context(), store.SharedConversation{
		WorkspaceID:     session.WorkspaceID,
		SessionID:       session.ID,
		MessageID:       messageID,
		TokenHash:       tokenHash(token),
		Snapshot:        payload,
		CreatedByUserID: createdBy,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"token": token})
}

func (s *Server) sharedConversation(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimSpace(r.PathValue("token"))
	if len(token) < 32 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "This share link is unavailable."})
		return
	}
	share, err := s.store.SharedConversationByToken(r.Context(), tokenHash(token))
	if err != nil {
		if err == store.ErrNotFound {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "This share link is unavailable."})
			return
		}
		writeError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Robots-Tag", "noindex, nofollow")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(share.Snapshot)
}
