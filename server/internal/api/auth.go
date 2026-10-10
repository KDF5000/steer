package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/KDF5000/relay/controlplane"
	"github.com/KDF5000/steer/server/internal/store"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"
)

const authCookieName = "steer_session"

type contextKey string

const (
	userContextKey      contextKey = "steer-user"
	workspaceContextKey contextKey = "steer-workspace"
	apiKeyContextKey    contextKey = "steer-api-key"
)

type Option func(*Server)

func WithAuthentication(sessionTTL time.Duration) Option {
	return func(server *Server) {
		server.authEnabled = true
		server.sessionTTL = sessionTTL
	}
}

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Email       string `json:"email"`
		Password    string `json:"password"`
		DisplayName string `json:"displayName"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, err)
		return
	}
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	input.DisplayName = strings.TrimSpace(input.DisplayName)
	if input.Email == "" || !strings.Contains(input.Email, "@") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Enter a valid email address."})
		return
	}
	if len(input.Password) < 8 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Password must contain at least 8 characters."})
		return
	}
	if input.DisplayName == "" {
		input.DisplayName = strings.Split(input.Email, "@")[0]
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, err)
		return
	}
	user, workspace, _, err := s.store.CreateUser(r.Context(), input.Email, input.DisplayName, string(hash), s.defaultWorkspace)
	if err != nil {
		var postgresError *pgconn.PgError
		if errors.As(err, &postgresError) && postgresError.Code == "23505" {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "An account with this email already exists."})
			return
		}
		writeError(w, err)
		return
	}
	if err := s.startSession(w, r, user); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"user": user, "workspaces": []store.Workspace{workspace}})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, err)
		return
	}
	user, err := s.store.UserByEmail(r.Context(), strings.ToLower(strings.TrimSpace(input.Email)))
	if err != nil || bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(input.Password)) != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Email or password is incorrect."})
		return
	}
	if err := s.startSession(w, r, user); err != nil {
		writeError(w, err)
		return
	}
	workspaces, err := s.store.Workspaces(r.Context(), user.ID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": user, "workspaces": workspaces})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(authCookieName); err == nil {
		_ = s.store.DeleteAuthSession(r.Context(), tokenHash(cookie.Value))
	}
	s.setSessionCookie(w, r, "", time.Unix(0, 0))
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	user := userFromContext(r.Context())
	workspaces, err := s.store.Workspaces(r.Context(), user.ID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": user, "workspaces": workspaces})
}

func (s *Server) listWorkspaces(w http.ResponseWriter, r *http.Request) {
	workspaces, err := s.store.Workspaces(r.Context(), userFromContext(r.Context()).ID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, workspaces)
}

func (s *Server) createWorkspace(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, err)
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || len(input.Name) > 80 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Workspace name must contain 1–80 characters."})
		return
	}
	workspace, err := s.store.CreateWorkspace(r.Context(), userFromContext(r.Context()).ID, input.Name)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, workspace)
}

var allowedAPIKeyScopes = map[string]bool{
	"tasks:read":   true,
	"tasks:write":  true,
	"tasks:cancel": true,
}

func (s *Server) listAPIKeys(w http.ResponseWriter, r *http.Request) {
	if _, ok := r.Context().Value(apiKeyContextKey).(store.WorkspaceAPIKey); ok {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "API keys cannot manage API keys."})
		return
	}
	keys, err := s.store.WorkspaceAPIKeys(r.Context(), s.workspace(r))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, keys)
}

func (s *Server) createAPIKey(w http.ResponseWriter, r *http.Request) {
	if _, ok := r.Context().Value(apiKeyContextKey).(store.WorkspaceAPIKey); ok {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "API keys cannot manage API keys."})
		return
	}
	var input struct {
		Name   string   `json:"name"`
		Scopes []string `json:"scopes"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || len(input.Name) > 80 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "API key name must contain 1–80 characters."})
		return
	}
	if len(input.Scopes) == 0 {
		input.Scopes = []string{"tasks:read", "tasks:write", "tasks:cancel"}
	}
	seen := map[string]bool{}
	scopes := make([]string, 0, len(input.Scopes))
	for _, scope := range input.Scopes {
		scope = strings.TrimSpace(scope)
		if !allowedAPIKeyScopes[scope] {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Unsupported API key scope: " + scope})
			return
		}
		if !seen[scope] {
			seen[scope] = true
			scopes = append(scopes, scope)
		}
	}
	random := make([]byte, 32)
	if _, err := rand.Read(random); err != nil {
		writeError(w, err)
		return
	}
	rawToken := "steer_sk_" + base64.RawURLEncoding.EncodeToString(random)
	key, err := s.store.CreateWorkspaceAPIKey(r.Context(), store.WorkspaceAPIKey{
		WorkspaceID: s.workspace(r), Name: input.Name, TokenHash: tokenHash(rawToken),
		TokenPrefix: rawToken[:16], Scopes: scopes, CreatedByUserID: userFromContext(r.Context()).ID,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"apiKey": key, "token": rawToken})
}

func (s *Server) revokeAPIKey(w http.ResponseWriter, r *http.Request) {
	if _, ok := r.Context().Value(apiKeyContextKey).(store.WorkspaceAPIKey); ok {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "API keys cannot manage API keys."})
		return
	}
	key, err := s.store.RevokeWorkspaceAPIKey(r.Context(), s.workspace(r), r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, key)
}

func (s *Server) createRelayNodeEnrollment(w http.ResponseWriter, r *http.Request) {
	if _, ok := r.Context().Value(apiKeyContextKey).(store.WorkspaceAPIKey); ok {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "API keys cannot install Relay Nodes."})
		return
	}
	random := make([]byte, 32)
	if _, err := rand.Read(random); err != nil {
		writeError(w, err)
		return
	}
	rawToken := "steer_enr_" + base64.RawURLEncoding.EncodeToString(random)
	expiresAt := time.Now().Add(15 * time.Minute)
	if _, err := s.store.CreateRelayNodeEnrollment(r.Context(), userFromContext(r.Context()).ID, tokenHash(rawToken), expiresAt); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"token": rawToken, "expiresAt": expiresAt})
}

func (s *Server) claimRelayNodeEnrollment(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Token    string `json:"token"`
		NodeID   string `json:"nodeId"`
		Name     string `json:"name"`
		Capacity int    `json:"capacity"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, err)
		return
	}
	input.Token = strings.TrimSpace(input.Token)
	input.NodeID = strings.TrimSpace(input.NodeID)
	input.Name = strings.TrimSpace(input.Name)
	if !strings.HasPrefix(input.Token, "steer_enr_") || input.NodeID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "A valid enrollment token and Node ID are required."})
		return
	}
	if input.Name == "" {
		input.Name = input.NodeID
	}
	if input.Capacity < 1 || input.Capacity > 32 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Concurrency must be between 1 and 32."})
		return
	}
	node, err := s.store.EnrollRelayNode(r.Context(), tokenHash(input.Token), input.NodeID, input.Name, input.Capacity, "offline", time.Now().UTC())
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Enrollment token is invalid, expired, or already used."})
			return
		}
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, node)
}

func (s *Server) listOwnedRelayNodes(w http.ResponseWriter, r *http.Request) {
	if _, ok := r.Context().Value(apiKeyContextKey).(store.WorkspaceAPIKey); ok {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "API keys cannot manage Relay Nodes."})
		return
	}
	if err := s.reconcileRelayNodes(r.Context()); err != nil {
		writeError(w, err)
		return
	}
	nodes, err := s.ownedRelayNodes(r.Context(), userFromContext(r.Context()).ID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, nodes)
}

func (s *Server) bindRelayNode(w http.ResponseWriter, r *http.Request) {
	if _, ok := r.Context().Value(apiKeyContextKey).(store.WorkspaceAPIKey); ok {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "API keys cannot manage Relay Nodes."})
		return
	}
	var input struct {
		RuntimeIDs []string `json:"runtimeIds"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, err)
		return
	}
	if len(input.RuntimeIDs) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Select at least one Runtime to add."})
		return
	}
	if err := s.reconcileRelayNodes(r.Context()); err != nil {
		writeError(w, err)
		return
	}
	if err := s.store.BindRelayNodeRuntimes(r.Context(), s.workspace(r), userFromContext(r.Context()).ID, r.PathValue("id"), input.RuntimeIDs); err != nil {
		writeError(w, err)
		return
	}
	nodes, err := s.workspaceNodes(r.Context(), s.workspace(r))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, nodes)
}

func (s *Server) disconnectRuntimeBinding(w http.ResponseWriter, r *http.Request) {
	if _, ok := r.Context().Value(apiKeyContextKey).(store.WorkspaceAPIKey); ok {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "API keys cannot manage Relay Nodes."})
		return
	}
	if err := s.store.DisconnectRuntimeBinding(r.Context(), s.workspace(r), r.PathValue("id")); err != nil {
		if errors.Is(err, store.ErrRuntimeBindingInUse) {
			writeJSON(w, http.StatusConflict, map[string]string{
				"error": "This Runtime is still used by an Agent, Project, or conversation. Remove those references before disconnecting it.",
			})
			return
		}
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) ownedRelayNodes(ctx context.Context, userID string) ([]controlplane.Node, error) {
	records, err := s.store.RelayNodesForOwner(ctx, userID)
	if err != nil {
		return nil, err
	}
	live, err := s.relay.Nodes(ctx)
	if err != nil {
		return nil, err
	}
	liveByID := make(map[string]controlplane.Node, len(live))
	for _, node := range live {
		liveByID[node.ID] = node
	}
	nodes := make([]controlplane.Node, 0, len(records))
	for _, record := range records {
		if node, ok := liveByID[record.ID]; ok {
			if node.Labels == nil {
				node.Labels = map[string]string{}
			}
			node.Labels["name"] = record.Name
			nodes = append(nodes, node)
			continue
		}
		runtimes, runtimeErr := s.store.RelayNodeRuntimes(ctx, record.ID)
		if runtimeErr != nil {
			return nil, runtimeErr
		}
		node := controlplane.Node{NodeRegistration: controlplane.NodeRegistration{ID: record.ID, Capacity: record.Capacity, Labels: map[string]string{"name": record.Name}}, State: record.State}
		for _, runtime := range runtimes {
			node.Runtimes = append(node.Runtimes, controlplane.Runtime{ID: runtime.ID, Provider: runtime.Provider, Version: runtime.Version, State: runtime.State})
		}
		nodes = append(nodes, node)
	}
	return nodes, nil
}

func (s *Server) reconcileRelayNodes(ctx context.Context) error {
	nodes, err := s.relay.Nodes(ctx)
	if err != nil {
		return err
	}
	for _, node := range nodes {
		record, lookupErr := s.store.RelayNodeByID(ctx, node.ID)
		if lookupErr != nil {
			if errors.Is(lookupErr, store.ErrNotFound) {
				continue
			}
			return lookupErr
		}
		runtimes := make([]store.RelayNodeRuntime, 0, len(node.Runtimes))
		for _, runtime := range node.Runtimes {
			runtimes = append(runtimes, store.RelayNodeRuntime{ID: runtime.ID, NodeID: node.ID, Provider: runtime.Provider, Version: runtime.Version, State: runtime.State})
		}
		if err := s.store.SyncRelayNode(ctx, record.ID, record.Name, node.Capacity, node.State, node.LastSeen, runtimes); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) startSession(w http.ResponseWriter, r *http.Request, user store.User) error {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	expiresAt := time.Now().Add(s.sessionTTL)
	if err := s.store.CreateAuthSession(r.Context(), user.ID, tokenHash(token), expiresAt); err != nil {
		return err
	}
	s.setSessionCookie(w, r, token, expiresAt)
	return nil
}

func (s *Server) setSessionCookie(w http.ResponseWriter, r *http.Request, value string, expires time.Time) {
	secure := r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
	maxAge := int(time.Until(expires).Seconds())
	if value == "" {
		maxAge = -1
	}
	http.SetCookie(w, &http.Cookie{Name: authCookieName, Value: value, Path: "/", HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode, Expires: expires, MaxAge: maxAge})
}

func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func userFromContext(ctx context.Context) store.User {
	user, _ := ctx.Value(userContextKey).(store.User)
	return user
}

func (s *Server) authenticate(next http.Handler) http.Handler {
	if !s.authEnabled {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" || r.URL.Path == "/api/v1/auth/register" || r.URL.Path == "/api/v1/auth/login" || r.URL.Path == "/api/v1/relay-node-enrollments/claim" || (r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/v1/shares/")) {
			next.ServeHTTP(w, r)
			return
		}
		if authorization := strings.TrimSpace(r.Header.Get("Authorization")); authorization != "" {
			parts := strings.Fields(authorization)
			if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || !strings.HasPrefix(parts[1], "steer_sk_") {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Invalid bearer token."})
				return
			}
			key, err := s.store.WorkspaceAPIKeyByToken(r.Context(), tokenHash(parts[1]))
			if err != nil {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "API key is invalid or revoked."})
				return
			}
			requiredScope, allowed := taskAPIScope(r)
			if !allowed || !hasScope(key.Scopes, requiredScope) {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "API key does not have permission for this operation."})
				return
			}
			ctx := context.WithValue(r.Context(), workspaceContextKey, key.WorkspaceID)
			ctx = context.WithValue(ctx, apiKeyContextKey, key)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}
		cookie, err := r.Cookie(authCookieName)
		if err != nil || cookie.Value == "" {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Sign in to continue."})
			return
		}
		user, err := s.store.UserBySession(r.Context(), tokenHash(cookie.Value))
		if err != nil {
			s.setSessionCookie(w, r, "", time.Unix(0, 0))
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Your session has expired. Sign in again."})
			return
		}
		ctx := context.WithValue(r.Context(), userContextKey, user)
		if strings.HasPrefix(r.URL.Path, "/api/v1/auth/") || r.URL.Path == "/api/v1/workspaces" {
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}
		workspaces, err := s.store.Workspaces(ctx, user.ID)
		if err != nil || len(workspaces) == 0 {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "No workspace is available for this account."})
			return
		}
		workspaceID := strings.TrimSpace(r.Header.Get("X-Steer-Workspace"))
		if workspaceID == "" && r.Method == http.MethodGet {
			workspaceID = strings.TrimSpace(r.URL.Query().Get("workspaceId"))
		}
		if workspaceID == "" {
			workspaceID = workspaces[0].ID
		}
		if _, err := s.store.WorkspaceForUser(ctx, user.ID, workspaceID); err != nil {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "This workspace does not belong to your account."})
			return
		}
		ctx = context.WithValue(ctx, workspaceContextKey, workspaceID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func taskAPIScope(r *http.Request) (string, bool) {
	path := r.URL.Path
	if r.Method == http.MethodPost && strings.HasSuffix(path, "/cancel") && strings.HasPrefix(path, "/api/v1/tasks/") {
		return "tasks:cancel", true
	}
	if r.Method == http.MethodPost && (path == "/api/v1/tasks" || (strings.HasPrefix(path, "/api/v1/conversations/") && strings.HasSuffix(path, "/tasks"))) {
		return "tasks:write", true
	}
	if r.Method == http.MethodGet && strings.HasPrefix(path, "/api/v1/tasks/") {
		return "tasks:read", true
	}
	return "", false
}

func hasScope(scopes []string, required string) bool {
	for _, scope := range scopes {
		if scope == required {
			return true
		}
	}
	return false
}
