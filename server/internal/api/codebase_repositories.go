package api

import (
	"net/http"
	"strings"
)

// addCodebaseRepository verifies a repository against the saved Codebase
// connection and registers it in the workspace. Repositories are managed
// independently of review workflows, so merge requests can be synced before a
// workflow is configured.
func (s *Server) addCodebaseRepository(w http.ResponseWriter, r *http.Request) {
	var input struct {
		RepoPath string `json:"repoPath"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeCodebaseError(w, invalidCodebase("Invalid repository input."))
		return
	}
	input.RepoPath = strings.TrimSpace(input.RepoPath)
	if !validCodebaseProject(input.RepoPath) {
		writeCodebaseError(w, invalidCodebase("Repository must be a namespace/project path."))
		return
	}
	c, credentials, err := s.storedCodebaseCredential(r)
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	repo, err := codebaseRepository(r.Context(), c.BaseURL, credentials, input.RepoPath)
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	saved, err := s.store.AddCodebaseRepository(r.Context(), s.workspace(r), repo.ID, repo.Path, repo.Name)
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (s *Server) deleteCodebaseRepository(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteCodebaseRepository(r.Context(), s.workspace(r), r.PathValue("repoId")); err != nil {
		writeCodebaseError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
