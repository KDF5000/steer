package api

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/KDF5000/steer/server/internal/store"
)

func (s *Server) codebaseConnection(w http.ResponseWriter, r *http.Request) {
	item, err := s.store.CodebaseConnection(r.Context(), s.workspace(r))
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusOK, nil)
		return
	}
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) saveCodebaseConnection(w http.ResponseWriter, r *http.Request) {
	var input struct {
		BaseURL   string `json:"baseUrl"`
		AppID     string `json:"appId"`
		AppSecret string `json:"appSecret"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeCodebaseError(w, invalidCodebase("Invalid Codebase connection input."))
		return
	}
	item := store.CodebaseConnection{WorkspaceID: s.workspace(r), BaseURL: input.BaseURL, AppID: strings.TrimSpace(input.AppID)}
	if err := normalizeCodebaseConnection(&item); err != nil {
		writeCodebaseError(w, err)
		return
	}
	appSecret := strings.TrimSpace(input.AppSecret)
	if appSecret == "" {
		existing, err := s.store.CodebaseConnection(r.Context(), item.WorkspaceID)
		if errors.Is(err, store.ErrNotFound) {
			writeCodebaseError(w, invalidCodebase("App Secret is required."))
			return
		}
		if err != nil {
			writeCodebaseError(w, err)
			return
		}
		if existing.BaseURL != item.BaseURL || existing.AppID != item.AppID {
			writeCodebaseError(w, invalidCodebase("Enter a new App Secret when changing the Codebase address or App ID."))
			return
		}
		appSecret, err = s.decryptCredential(existing.EncryptedAppSecret)
		if err != nil {
			writeCodebaseError(w, err)
			return
		}
	}
	encrypted, err := s.encryptCredential(appSecret)
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	credentials := codebaseOpenAPICredentials{AppID: item.AppID, AppSecret: appSecret}
	user, err := codebaseUser(r.Context(), item.BaseURL, credentials)
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	item.EncryptedAppSecret = encrypted
	item.RemoteUsername = user.Username
	item.VerifiedAt = time.Now().UTC()
	saved, err := s.store.SaveCodebaseConnection(r.Context(), item)
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (s *Server) deleteCodebaseConnection(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteCodebaseConnection(r.Context(), s.workspace(r)); err != nil {
		writeCodebaseError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) storedCodebaseCredential(r *http.Request) (store.CodebaseConnection, codebaseOpenAPICredentials, error) {
	return s.storedCodebaseCredentialByWorkspace(r.Context(), s.workspace(r))
}

// storedCodebaseCredentialByWorkspace resolves credentials for background work
// that has no request context, such as webhook-triggered reviews.
func (s *Server) storedCodebaseCredentialByWorkspace(ctx context.Context, wid string) (store.CodebaseConnection, codebaseOpenAPICredentials, error) {
	var credentials codebaseOpenAPICredentials
	c, err := s.store.CodebaseConnection(ctx, wid)
	if errors.Is(err, store.ErrNotFound) {
		return c, credentials, codebaseError{Code: "codebase_not_connected", Message: "Connect Codebase before fetching merge requests.", Status: http.StatusConflict}
	}
	if err != nil {
		return c, credentials, err
	}
	secret, err := s.decryptCredential(c.EncryptedAppSecret)
	if err != nil {
		return c, credentials, err
	}
	credentials.AppID = c.AppID
	credentials.AppSecret = secret
	return c, credentials, nil
}

func (s *Server) codebaseRepository(w http.ResponseWriter, r *http.Request) {
	c, credentials, err := s.storedCodebaseCredential(r)
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	path := strings.TrimSpace(r.URL.Query().Get("path"))
	if path == "" || !validCodebaseProject(path) {
		writeCodebaseError(w, invalidCodebase("Repository path must be a namespace/project path."))
		return
	}
	repo, err := codebaseRepository(r.Context(), c.BaseURL, credentials, path)
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, repo)
}

func (s *Server) codebaseMergeRequest(w http.ResponseWriter, r *http.Request) {
	c, credentials, err := s.storedCodebaseCredential(r)
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	iid, err := strconv.Atoi(r.PathValue("iid"))
	if err != nil {
		writeCodebaseError(w, invalidCodebase("Invalid MR number."))
		return
	}
	result, err := codebaseMRDetail(r.Context(), c.BaseURL, credentials, r.PathValue("project"), iid)
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
