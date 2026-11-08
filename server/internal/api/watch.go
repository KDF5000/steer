package api

import "net/http"

func (s *Server) watchConversations(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.WatchConversations(r.Context(), s.workspace(r))
	if err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, items)
}
