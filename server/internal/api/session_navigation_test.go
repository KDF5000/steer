package api

import (
	"context"
	"encoding/json"
	"github.com/KDF5000/steer/server/internal/store"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"
)

func TestSessionNavigationAndSearch(t *testing.T) {
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
	pool, err := pgxpool.New(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	suffix := uuid.NewString()
	owner, ow, _, err := st.CreateUser(ctx, "nav-owner-"+suffix+"@example.com", "Owner", "unused", "")
	if err != nil {
		t.Fatal(err)
	}
	guest, gw, _, err := st.CreateUser(ctx, "nav-guest-"+suffix+"@example.com", "Guest", "unused", "")
	if err != nil {
		t.Fatal(err)
	}
	stranger, sw, _, err := st.CreateUser(ctx, "nav-stranger-"+suffix+"@example.com", "Stranger", "unused", "")
	if err != nil {
		t.Fatal(err)
	}
	for _, user := range []store.User{owner, guest, stranger} {
		if err = st.CreateAuthSession(ctx, user.ID, tokenHash(user.ID), time.Now().Add(time.Hour)); err != nil {
			t.Fatal(err)
		}
	}
	agent, err := st.CreateAgent(ctx, ow.ID, store.Agent{Name: "Builder", RuntimeProvider: "codex"})
	if err != nil {
		t.Fatal(err)
	}
	project, err := st.CreateProject(ctx, ow.ID, store.Project{Name: "Search project", WorkspaceKind: "local", WorkspaceSource: "/workspace/search", ExecutionMode: "in_place"})
	if err != nil {
		t.Fatal(err)
	}
	create := func(title, query, reply string) (store.Session, string) {
		t.Helper()
		id := uuid.NewString()
		session, err := st.EnsureSession(ctx, ow.ID, id, title, agent.ID, &project.ID, nil, nil, &project)
		if err != nil {
			t.Fatal(err)
		}
		run := uuid.NewString()
		_, answer, err := st.SaveChatRun(ctx, ow.ID, id, agent.ID, query, run, "running")
		if err != nil {
			t.Fatal(err)
		}
		if err = st.UpdateRun(ctx, ow.ID, run, "succeeded", reply, nil, 1); err != nil {
			t.Fatal(err)
		}
		return session, answer.ID
	}
	first, answerID := create("Original title", "check reconnect", "飞书图片 API_error 100% _literal "+strings.Repeat("padding ", 100)+"中文查找尾部")
	second, _ := create("Latest title", "another task", "Other completed reply")
	handler := New(st, "http://127.0.0.1:1", "", "", ow.ID, nil, WithAuthentication(time.Hour)).Handler()
	call := func(user store.User, wid, method, path, body string, want int) []byte {
		t.Helper()
		r := httptest.NewRequest(method, "/api/v1"+path, strings.NewReader(body))
		r.AddCookie(&http.Cookie{Name: authCookieName, Value: user.ID})
		r.Header.Set("X-Steer-Workspace", wid)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s %s: %d want %d: %s", method, path, w.Code, want, w.Body.String())
		}
		return w.Body.Bytes()
	}
	search := func(user store.User, wid, query, filter string) ([]store.SessionSearchResult, bool) {
		t.Helper()
		var result struct {
			Results []store.SessionSearchResult `json:"results"`
			HasMore bool                        `json:"hasMore"`
		}
		if err := json.Unmarshal(call(user, wid, "GET", "/session-search?q="+url.QueryEscape(query)+filter, "", 200), &result); err != nil {
			t.Fatal(err)
		}
		return result.Results, result.HasMore
	}
	for _, q := range []string{"飞书图片", "api_ERROR", "100%", "_literal", "飞书 API_error", "中文查找尾部"} {
		results, _ := search(owner, ow.ID, q, "")
		if len(results) != 1 || results[0].ID != first.ID || results[0].MessageID == nil || *results[0].MessageID != answerID || !strings.Contains(results[0].Snippet, strings.Fields(q)[0]) && q != "api_ERROR" {
			t.Fatalf("search %q: %+v", q, results)
		}
	}
	results, _ := search(owner, ow.ID, "100_", "")
	if len(results) != 0 {
		t.Fatal("LIKE wildcards must be treated literally")
	}
	results, _ = search(owner, ow.ID, "Original", "")
	if len(results) != 1 || results[0].ID != first.ID {
		t.Fatal("title search failed")
	}
	results, _ = search(owner, ow.ID, "飞书图片", "&projectId=missing")
	if len(results) != 0 {
		t.Fatal("project filter failed")
	}
	results, _ = search(owner, ow.ID, "飞书图片", "&from="+url.QueryEscape(time.Now().Add(time.Hour).Format(time.RFC3339)))
	if len(results) != 0 {
		t.Fatal("date filter failed")
	}
	before, err := st.Session(ctx, ow.ID, first.ID)
	if err != nil {
		t.Fatal(err)
	}
	var updated store.Session
	if err = json.Unmarshal(call(owner, ow.ID, "PATCH", "/sessions/"+first.ID+"/navigation", `{"title":"Renamed requirement","pinned":true,"archived":true}`, 200), &updated); err != nil {
		t.Fatal(err)
	}
	if updated.Title != "Renamed requirement" || !updated.Pinned || !updated.Archived || !updated.UpdatedAt.Equal(before.UpdatedAt) || !updated.CreatedAt.Equal(before.CreatedAt) || updated.AgentID != before.AgentID {
		t.Fatal("navigation update changed execution or timestamps")
	}
	results, _ = search(owner, ow.ID, "Renamed", "")
	if len(results) != 1 || !results[0].Archived {
		t.Fatal("archived history must stay searchable")
	}
	results, _ = search(owner, ow.ID, "Renamed", "&archive=active")
	if len(results) != 0 {
		t.Fatal("archive filter failed")
	}
	results, _ = search(owner, ow.ID, "Renamed", "&archive=archived")
	if len(results) != 1 {
		t.Fatal("archived-only search failed")
	}
	sessions, err := st.Sessions(ctx, ow.ID)
	if err != nil {
		t.Fatal(err)
	}
	if sessions[0].ID != first.ID {
		t.Fatal("pinned session must lead")
	}
	call(owner, ow.ID, "PATCH", "/sessions/"+first.ID+"/navigation", `{"pinned":false,"archived":false}`, 200)
	sessions, err = st.Sessions(ctx, ow.ID)
	if err != nil {
		t.Fatal(err)
	}
	if sessions[0].ID != second.ID {
		t.Fatal("default ordering must follow creation")
	}

	// A new message in an older session moves it ahead; viewing/metadata do not.
	future := time.Now().Add(time.Minute)
	if _, err := pool.Exec(ctx, `UPDATE messages SET created_at=$2 WHERE id=$1`, answerID, future); err != nil {
		t.Fatal(err)
	}
	sessions, err = st.Sessions(ctx, ow.ID)
	if err != nil {
		t.Fatal(err)
	}
	if sessions[0].ID != first.ID || !sessions[0].LastMessageAt.Equal(future.Truncate(time.Microsecond)) {
		t.Fatal("sort must follow last message rather than session creation")
	}
	call(owner, ow.ID, "GET", "/sessions/"+second.ID, "", 200)
	call(owner, ow.ID, "PATCH", "/sessions/"+second.ID+"/navigation", `{"title":"Changed name"}`, 200)
	sessions, err = st.Sessions(ctx, ow.ID)
	if err != nil || sessions[0].ID != first.ID {
		t.Fatal("viewing or renaming must not reorder sessions")
	}
	call(owner, ow.ID, "PATCH", "/sessions/"+first.ID+"/navigation", `{"title":"   "}`, 400)
	call(owner, ow.ID, "PATCH", "/sessions/"+first.ID+"/navigation", `{"title":42}`, 400)
	call(guest, gw.ID, "PATCH", "/sessions/"+first.ID+"/navigation", `{"pinned":true}`, 404)
	grant, err := st.CreateResourceShare(ctx, store.ResourceShare{Kind: "session", ResourceID: first.ID, WorkspaceID: ow.ID, OwnerUserID: owner.ID, RecipientEmail: guest.Email, Permission: "view", MaxConcurrency: 1})
	if err != nil {
		t.Fatal(err)
	}
	results, _ = search(guest, gw.ID, "飞书图片", "")
	if len(results) != 0 {
		t.Fatal("pending invitation leaked content")
	}
	if _, err = st.AcceptResourceShare(ctx, grant.ID, guest); err != nil {
		t.Fatal(err)
	}
	results, _ = search(guest, gw.ID, "飞书图片", "")
	if len(results) != 1 || results[0].ShareID == nil || *results[0].ShareID != grant.ID {
		t.Fatal("accepted collaboration must be searchable")
	}
	results, _ = search(stranger, sw.ID, "飞书图片", "")
	if len(results) != 0 {
		t.Fatal("other account leaked content")
	}
	call(guest, ow.ID, "GET", "/session-search?q=飞书图片", "", 403)
	call(guest, gw.ID, "PATCH", "/collaboration-access/"+grant.ID+"/sessions/"+first.ID+"/navigation", `{"title":"changed"}`, 404)
	if err = st.RevokeResourceShare(ctx, grant.ID, owner); err != nil {
		t.Fatal(err)
	}
	results, _ = search(guest, gw.ID, "飞书图片", "")
	if len(results) != 0 {
		t.Fatal("revoked invitation leaked content")
	}
	for i := 0; i < 53; i++ {
		create("pagination "+uuid.NewString(), "task", "done")
	}
	results, more := search(owner, ow.ID, "pagination", "")
	if len(results) != 50 || !more {
		t.Fatal("first page must be bounded")
	}
	next, more := search(owner, ow.ID, "pagination", "&offset=50")
	if len(next) != 3 || more {
		t.Fatal("second page incorrect")
	}
	seen := map[string]bool{}
	for _, r := range results {
		seen[r.ID] = true
	}
	for _, r := range next {
		if seen[r.ID] {
			t.Fatal("pagination duplicated results")
		}
	}
	call(owner, ow.ID, "GET", "/session-search?archive=invalid", "", 400)
	call(owner, ow.ID, "GET", "/session-search?from=bad", "", 400)
	call(owner, ow.ID, "GET", "/session-search?offset=-1", "", 400)
}
