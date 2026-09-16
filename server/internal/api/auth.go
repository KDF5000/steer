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

	"github.com/KDF5000/steer/server/internal/store"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"
)

const authCookieName = "steer_session"

type contextKey string

const (
	userContextKey      contextKey = "steer-user"
	workspaceContextKey contextKey = "steer-workspace"
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
	user, workspace, adopted, err := s.store.CreateUser(r.Context(), input.Email, input.DisplayName, string(hash), s.defaultWorkspace)
	if err != nil {
		var postgresError *pgconn.PgError
		if errors.As(err, &postgresError) && postgresError.Code == "23505" {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "An account with this email already exists."})
			return
		}
		writeError(w, err)
		return
	}
	if adopted {
		s.assignAllUnclaimedRuntimes(r.Context(), workspace.ID)
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

func (s *Server) claimAvailableRuntimes(w http.ResponseWriter, r *http.Request) {
	if err := s.assignAllUnclaimedRuntimes(r.Context(), s.workspace(r)); err != nil {
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

func (s *Server) assignAllUnclaimedRuntimes(ctx context.Context, workspaceID string) error {
	nodes, err := s.relay.Nodes(ctx)
	if err != nil {
		return err
	}
	for _, node := range nodes {
		for _, runtime := range node.Runtimes {
			available, err := s.store.UnassignedRuntime(ctx, runtime.ID)
			if err != nil {
				return err
			}
			if available {
				if err := s.store.AssignRuntime(ctx, workspaceID, runtime.ID); err != nil && !errors.Is(err, store.ErrConflict) {
					return err
				}
			}
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
		if r.URL.Path == "/health" || r.URL.Path == "/api/v1/auth/register" || r.URL.Path == "/api/v1/auth/login" {
			next.ServeHTTP(w, r)
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
