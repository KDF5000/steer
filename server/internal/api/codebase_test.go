package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/KDF5000/steer/server/internal/store"
	"github.com/google/uuid"
)

func TestCodebaseAuthenticatedConnectionAndMRs(t *testing.T) {
	db := os.Getenv("STEER_TEST_DATABASE_URL")
	if db == "" {
		t.Skip("set STEER_TEST_DATABASE_URL")
	}
	ctx := context.Background()
	st, err := store.Open(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err = st.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	owner, workspace, _, err := st.CreateUser(ctx, uuid.NewString()+"@example.com", "Owner", "unused", "")
	if err != nil {
		t.Fatal(err)
	}
	guest, other, _, err := st.CreateUser(ctx, uuid.NewString()+"@example.com", "Other", "unused", "")
	if err != nil {
		t.Fatal(err)
	}
	for _, user := range []store.User{owner, guest} {
		if err = st.CreateAuthSession(ctx, user.ID, tokenHash(user.ID), time.Now().Add(time.Hour)); err != nil {
			t.Fatal(err)
		}
	}
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Code-App-ID") != "test-app" || r.Header.Get("X-Code-App-Secret") != "connection-secret" {
			w.WriteHeader(401)
			fmt.Fprint(w, `{"ResponseMetadata":{"Action":"","Error":{"Code":"Unauthorized","Message":"nope"}}}`)
			return
		}
		action := r.URL.Query().Get("Action")
		switch action {
		case "GetApp":
			fmt.Fprint(w, `{"ResponseMetadata":{"Action":"GetApp","RequestId":"x"},"Result":{"App":{"Id":"app1","Name":"test-app","Description":"Auto review"}}}`)
		case "ListRepoMergeRequests":
			fmt.Fprint(w, `{"ResponseMetadata":{"Action":"ListRepoMergeRequests","RequestId":"x"},"Result":{"MergeRequests":[{"Id":"12","Number":3,"TargetRepoId":"9","Title":"Real MR","Status":"open","URL":"https://code.example/org/repo/merge_requests/3","CreatedAt":"2025-12-31T10:00:00Z","UpdatedAt":"2026-01-01T10:00:00Z"}],"PageNumber":1,"PageSize":100,"TotalCount":1}}`)
		case "GetRepository":
			fmt.Fprint(w, `{"ResponseMetadata":{"Action":"GetRepository","RequestId":"x"},"Result":{"Repository":{"Id":"9","Path":"org/repo"}}}`)
		case "GetMergeRequest":
			fmt.Fprint(w, `{"ResponseMetadata":{"Action":"GetMergeRequest","RequestId":"x"},"Result":{"MergeRequest":{"Id":"12","Number":3,"TargetRepoId":"9","Title":"Real MR","Description":"Description","Status":"open","URL":"https://code.example/org/repo/merge_requests/3"}}}`)
		default:
			t.Errorf("unexpected upstream action: %s", action)
			w.WriteHeader(404)
		}
	}))
	defer remote.Close()
	s := New(st, "http://127.0.0.1:1", "", "", workspace.ID, nil, WithAuthentication(time.Hour), WithCredentialEncryptionKey("test-only-codebase-encryption-key"))
	handler := s.Handler()
	apiToken := "steer_sk_codebase_" + uuid.NewString()
	if _, err := st.CreateWorkspaceAPIKey(ctx, store.WorkspaceAPIKey{WorkspaceID: workspace.ID, Name: "Task key", TokenHash: tokenHash(apiToken), TokenPrefix: "steer_sk_codebase", Scopes: []string{"tasks:read", "tasks:write", "tasks:cancel"}, CreatedByUserID: owner.ID}); err != nil {
		t.Fatal(err)
	}
	for _, method := range []string{"GET", "PUT", "DELETE"} {
		r := httptest.NewRequest(method, "/api/v1/codebase/connection", nil)
		r.Header.Set("Authorization", "Bearer "+apiToken)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != http.StatusForbidden {
			t.Fatalf("task API key accessed connection: %s %d", method, w.Code)
		}
	}
	call := func(user, wid, method, path, body string, status int) string {
		t.Helper()
		r := httptest.NewRequest(method, "/api/v1/codebase/"+path, strings.NewReader(body))
		if user != "" {
			r.AddCookie(&http.Cookie{Name: authCookieName, Value: user})
		}
		r.Header.Set("X-Steer-Workspace", wid)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("%s %s: %d want %d: %s", method, path, w.Code, status, w.Body.String())
		}
		if strings.Contains(w.Body.String(), "connection-secret") {
			t.Fatal("credential leaked")
		}
		return w.Body.String()
	}
	input := func(address, appID, appSecret string) string {
		data := map[string]string{"baseUrl": address, "appId": appID}
		if appSecret != "" {
			data["appSecret"] = appSecret
		}
		body, _ := json.Marshal(data)
		return string(body)
	}
	call("", workspace.ID, "GET", "connection", "", 401)
	call(owner.ID, workspace.ID, "PUT", "connection", `{"connection-secret":true}`, 400)
	if strings.TrimSpace(call(owner.ID, workspace.ID, "GET", "connection", "", 200)) != "null" {
		t.Fatal("unexpected initial connection")
	}
	// Persisted merge requests are readable without a connection, but syncing
	// requires one and selecting a repository is mandatory.
	call(owner.ID, workspace.ID, "GET", "merge-requests", "", 400)
	if body := call(owner.ID, workspace.ID, "GET", "merge-requests?repoId=9", "", 200); strings.Contains(body, "Real MR") {
		t.Fatalf("unexpected persisted merge requests: %s", body)
	}
	call(owner.ID, workspace.ID, "POST", "merge-requests/sync", `{"repoId":"9"}`, 409)
	call(owner.ID, workspace.ID, "PUT", "connection", input(remote.URL, "test-app", ""), 400)
	call(owner.ID, workspace.ID, "PUT", "connection", input(remote.URL, "test-app", "connection-secret"), 200)
	saved, err := st.CodebaseConnection(ctx, workspace.ID)
	if err != nil || !saved.AppSecretConfigured || strings.Contains(string(saved.EncryptedAppSecret), "connection-secret") {
		t.Fatalf("unencrypted connection: %v", err)
	}
	if decrypted, err := s.decryptCredential(saved.EncryptedAppSecret); err != nil || decrypted != "connection-secret" {
		t.Fatal("encrypted secret cannot be recovered")
	}
	call(owner.ID, workspace.ID, "PUT", "connection", input(remote.URL, "test-app", ""), 200)
	call(owner.ID, workspace.ID, "PUT", "connection", input(remote.URL+"/changed", "test-app", ""), 400)
	call(owner.ID, workspace.ID, "PUT", "connection", input(remote.URL, "test-app", "bad-token"), 502)
	synced := call(owner.ID, workspace.ID, "POST", "merge-requests/sync", `{"repoPath":"org/repo"}`, 200)
	if !strings.Contains(synced, `"created":1`) {
		t.Fatalf("sync did not persist merge requests: %s", synced)
	}
	if body := call(owner.ID, workspace.ID, "GET", "merge-requests?repoId=9&page=1", "", 200); !strings.Contains(body, "Real MR") {
		t.Fatal(body)
	}
	call(owner.ID, workspace.ID, "GET", "merge-requests?repoId=9&page=oops", "", 400)
	call(owner.ID, workspace.ID, "GET", "merge-requests/9/3", "", 200)
	call(guest.ID, workspace.ID, "GET", "connection", "", 403)
	call(guest.ID, workspace.ID, "GET", "merge-requests", "", 403)
	call(guest.ID, workspace.ID, "POST", "merge-requests/sync", `{"repoId":"9"}`, 403)
	call(guest.ID, workspace.ID, "PUT", "connection", input(remote.URL, "test-app", "connection-secret"), 403)
	call(guest.ID, workspace.ID, "DELETE", "connection", "", 403)
	if strings.TrimSpace(call(guest.ID, other.ID, "GET", "connection", "", 200)) != "null" {
		t.Fatal("cross-workspace leak")
	}
	call(owner.ID, workspace.ID, "DELETE", "connection", "", 204)
	// Persisted merge requests survive disconnecting; only syncing needs a live
	// Codebase connection.
	if body := call(owner.ID, workspace.ID, "GET", "merge-requests?repoId=9", "", 200); !strings.Contains(body, "Real MR") {
		t.Fatalf("persisted merge requests disappeared after disconnect: %s", body)
	}
	call(owner.ID, workspace.ID, "POST", "merge-requests/sync", `{"repoId":"9"}`, 409)
}
