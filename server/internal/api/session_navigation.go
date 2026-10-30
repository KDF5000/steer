package api

import (
	"context"
	"encoding/json"
	"github.com/KDF5000/steer/server/internal/store"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

func (s *Server) updateChatSession(w http.ResponseWriter, r *http.Request) {
	var in store.SessionUpdate
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&in); err != nil {
		writeJSON(w, 400, map[string]string{"error": "Invalid session update"})
		return
	}
	if in.Title != nil {
		title := strings.TrimSpace(*in.Title)
		if title == "" || utf8.RuneCountInString(title) > 160 {
			writeJSON(w, 400, map[string]string{"error": "Title must contain 1–160 characters"})
			return
		}
		in.Title = &title
	}
	session, err := s.store.UpdateSessionNavigation(r.Context(), s.workspace(r), r.PathValue("id"), in)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, session)
}
func (s *Server) searchSessions(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	in := store.SessionSearchInput{Query: strings.TrimSpace(q.Get("q")), ProjectID: q.Get("projectId")}
	if utf8.RuneCountInString(in.Query) > 200 || len(strings.Fields(in.Query)) > 8 {
		writeJSON(w, 400, map[string]string{"error": "Search accepts up to 200 characters and 8 terms"})
		return
	}
	if q.Get("offset") != "" {
		n, err := strconv.Atoi(q.Get("offset"))
		if err != nil || n < 0 || n > 10000 {
			writeJSON(w, 400, map[string]string{"error": "Invalid offset"})
			return
		}
		in.Offset = n
	}
	for _, key := range []string{"from", "to"} {
		if q.Get(key) == "" {
			continue
		}
		date, err := time.Parse(time.RFC3339, q.Get(key))
		if err != nil {
			writeJSON(w, 400, map[string]string{"error": "Invalid date filter"})
			return
		}
		if key == "from" {
			in.From = &date
		} else {
			in.To = &date
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	results, err := s.store.SearchSessions(ctx, s.workspace(r), userFromContext(ctx), in)
	if err != nil {
		writeError(w, err)
		return
	}
	more := len(results) > 50
	if more {
		results = results[:50]
	}
	writeJSON(w, 200, map[string]any{"results": results, "hasMore": more})
}
