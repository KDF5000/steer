package api

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/KDF5000/steer/server/internal/store"
)

func (s *Server) codebaseCalibration(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	days := 30
	if raw := strings.TrimSpace(q.Get("days")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 0 || parsed > 365 {
			writeCodebaseError(w, invalidCodebase("Invalid days range (must be 0..365)."))
			return
		}
		days = parsed
	}
	workflowID := strings.TrimSpace(q.Get("workflowId"))
	repoID := strings.TrimSpace(q.Get("repoId"))
	if len(workflowID) > 200 || len(repoID) > 200 {
		writeCodebaseError(w, invalidCodebase("Invalid calibration filter."))
		return
	}
	stats, err := s.store.CodebaseCalibration(r.Context(), s.workspace(r), store.CodebaseCalibrationQuery{
		WorkflowID: workflowID,
		RepoID:     repoID,
		Days:       days,
	})
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, stats)
}
