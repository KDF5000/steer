package api

import (
	"net/http"
)

func (s *Server) updateNodeCapacity(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Capacity int `json:"capacity"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, err)
		return
	}
	if input.Capacity < 1 || input.Capacity > 32 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Concurrency must be between 1 and 32."})
		return
	}
	nodeID := r.PathValue("id")
	visible, err := s.workspaceNodes(r.Context(), s.workspace(r))
	if err != nil {
		writeError(w, err)
		return
	}
	allowed := false
	for _, node := range visible {
		if node.ID == nodeID {
			allowed = true
			break
		}
	}
	if !allowed {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Runtime node not found."})
		return
	}
	node, err := s.relayHTTP.UpdateNodeCapacity(r.Context(), nodeID, input.Capacity)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, node)
}
