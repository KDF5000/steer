package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/KDF5000/steer/server/internal/store"
	"github.com/google/uuid"
)

func TestCodebaseWebhookDurableReceiptAndIsolation(t *testing.T) {
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
	s := New(st, "http://127.0.0.1:1", "", "", workspace.ID, nil, WithAuthentication(time.Hour), WithCredentialEncryptionKey("codebase-test-webhook-encryption-key"))
	handler := s.Handler()
	call := func(user, wid, method, path, body string, status int) []byte {
		t.Helper()
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		if user != "" {
			r.AddCookie(&http.Cookie{Name: authCookieName, Value: user})
		}
		r.Header.Set("X-Steer-Workspace", wid)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("%s webhook request: got %d want %d", method, w.Code, status)
		}
		return w.Body.Bytes()
	}
	const configPath = "/api/v1/codebase/webhook"
	call("", workspace.ID, "PUT", configPath, `{"enabled":true}`, 401)
	call(guest.ID, workspace.ID, "PUT", configPath, `{"enabled":true}`, 403)
	var settings struct {
		Enabled      bool
		CallbackPath string
	}
	if err = json.Unmarshal(call(owner.ID, workspace.ID, "PUT", configPath, `{"enabled":true}`, 200), &settings); err != nil {
		t.Fatal(err)
	}
	parsed, _ := url.Parse(settings.CallbackPath)
	token := parsed.Query().Get("token")
	if len(token) < 40 {
		t.Fatal("weak callback token")
	}
	saved, err := st.CodebaseWebhook(ctx, workspace.ID)
	if err != nil || saved.TokenHash == token || strings.Contains(string(saved.EncryptedToken), token) {
		t.Fatal("webhook credential was not protected")
	}
	callback := settings.CallbackPath
	call("", workspace.ID, "POST", parsed.Path, `{}`, 401)
	call("", workspace.ID, "POST", parsed.Path+"?token=wrong", `{}`, 401)
	call("", workspace.ID, "GET", parsed.Path, "", 401)
	call("", workspace.ID, "POST", callback, `[]`, 400)
	call("", workspace.ID, "POST", callback, `{} {}`, 400)
	call("", workspace.ID, "POST", callback, strings.Repeat("x", (1<<20)+1), 413)
	var receipt struct {
		EventID   int64
		Duplicate bool
	}
	if err = json.Unmarshal(call("", workspace.ID, "POST", callback, `{"event":"fixture","number":9007199254740993}`, 202), &receipt); err != nil || receipt.EventID <= 0 || receipt.Duplicate {
		t.Fatal("delivery was not accepted")
	}
	if err = json.Unmarshal(call("", workspace.ID, "POST", callback, `{ "number":9007199254740993, "event":"fixture" }`, 202), &receipt); err != nil || !receipt.Duplicate {
		t.Fatal("retry was not deduplicated")
	}
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			call("", workspace.ID, "POST", callback, `{"event":"fixture","number":9007199254740993}`, 202)
		}()
	}
	wg.Wait()
	items, err := st.CodebaseWebhookEvents(ctx, workspace.ID, 0)
	if err != nil || len(items) != 1 {
		t.Fatalf("duplicate persisted: %d %v", len(items), err)
	}
	items, err = st.CodebaseWebhookEvents(ctx, other.ID, 0)
	if err != nil || len(items) != 0 {
		t.Fatal("events leaked across workspaces")
	}
	call(guest.ID, workspace.ID, "GET", configPath, "", 403)
	call(owner.ID, workspace.ID, "GET", "/api/v1/codebase/webhook-events?after=bad", "", 400)
	call(guest.ID, workspace.ID, "GET", "/api/v1/codebase/webhook-events", "", 403)
	// Stream an existing durable event, then cancel; no Agent/Relay call is needed.
	remote := httptest.NewServer(handler)
	streamCtx, cancel := context.WithCancel(ctx)
	r, _ := http.NewRequestWithContext(streamCtx, "GET", remote.URL+"/api/v1/codebase/webhook-events", nil)
	r.AddCookie(&http.Cookie{Name: authCookieName, Value: owner.ID})
	r.Header.Set("X-Steer-Workspace", workspace.ID)
	client := &http.Client{Timeout: 5 * time.Second}
	response, err := client.Do(r)
	if err != nil {
		cancel()
		remote.Close()
		t.Fatal(err)
	}
	data := make([]byte, 512)
	n, err := response.Body.Read(data)
	response.Body.Close()
	cancel()
	remote.Close()
	if err != nil || !strings.Contains(string(data[:n]), "event: codebase.received") {
		t.Fatal("durable event was not streamed")
	}
	call(owner.ID, workspace.ID, "PUT", configPath, `{"enabled":false}`, 200)
	call("", workspace.ID, "POST", callback, `{"event":"disabled"}`, 401)
	var rotated struct{ CallbackPath string }
	json.Unmarshal(call(owner.ID, workspace.ID, "PUT", configPath, `{"enabled":true,"rotateToken":true}`, 200), &rotated)
	if rotated.CallbackPath == callback {
		t.Fatal("token did not rotate")
	}
	call("", workspace.ID, "POST", callback, `{"event":"old-token"}`, 401)
	call("", workspace.ID, "POST", rotated.CallbackPath, fmt.Sprintf(`{"event":"after-rotate","workspace":"%s"}`, workspace.ID), 202)
	items, err = st.CodebaseWebhookEvents(ctx, workspace.ID, receipt.EventID)
	if err != nil || len(items) != 1 {
		t.Fatal("event cursor did not resume")
	}
}
