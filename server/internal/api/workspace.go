package api

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Authorize via Steer's run link before forwarding a read-only node inspection.
func (s *Server) inspectWorkspace(w http.ResponseWriter, r *http.Request) {
	if _, err := s.store.RunLink(r.Context(), s.workspace(r), r.PathValue("id")); err != nil {
		writeError(w, err)
		return
	}
	operation := r.URL.Query().Get("operation")
	if operation != "read" && operation != "list" && operation != "diff" {
		writeJSON(w, 400, map[string]string{"error": "invalid workspace operation"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	endpoint := strings.TrimRight(s.relayHTTP.BaseURL, "/") + "/v1/runs/" + url.PathEscape(r.PathValue("id")) + "/workspace?operation=" + url.QueryEscape(operation) + "&path=" + url.QueryEscape(r.URL.Query().Get("path"))
	request, err := http.NewRequestWithContext(ctx, "GET", endpoint, nil)
	if err != nil {
		writeError(w, err)
		return
	}
	request.Header.Set("Authorization", "Bearer "+s.relayHTTP.Token)
	response, err := s.relayHTTP.HTTP.Do(request)
	if err != nil {
		writeError(w, err)
		return
	}
	defer response.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(response.StatusCode)
	_, _ = io.Copy(w, io.LimitReader(response.Body, 4<<20))
}
