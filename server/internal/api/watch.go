package api

import (
	"net/http"
	"strconv"
)

func (s *Server) watchConversations(w http.ResponseWriter, r *http.Request) {
	limit, offset := 50, 0
	for name, target := range map[string]*int{"limit": &limit, "offset": &offset} {
		if value := r.URL.Query().Get(name); value != "" {
			parsed, err := strconv.Atoi(value)
			if err != nil || parsed < 0 || (name == "limit" && (parsed < 1 || parsed > 100)) {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid pagination"})
				return
			}
			*target = parsed
		}
	}
	items, err := s.store.WatchConversationsPage(r.Context(), s.workspace(r), limit, offset)
	if err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) watchOverview(w http.ResponseWriter, r *http.Request) {
	overview, err := s.store.WatchOverview(r.Context(), s.workspace(r))
	if err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, overview)
}
