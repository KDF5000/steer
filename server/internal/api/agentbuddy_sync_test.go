package api

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/KDF5000/steer/server/internal/store"
	"github.com/google/uuid"
)

type buddySyncTransport func(*http.Request) (*http.Response, error)

func (f buddySyncTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestAgentBuddySkillSync(t *testing.T) {
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
	makeUser := func(name string) (store.User, store.Workspace) {
		t.Helper()
		u, w, _, err := st.CreateUser(ctx, uuid.NewString()+"@example.com", name, "unused", "")
		if err != nil {
			t.Fatal(err)
		}
		if err = st.CreateAuthSession(ctx, u.ID, tokenHash(u.ID), time.Now().Add(time.Hour)); err != nil {
			t.Fatal(err)
		}
		return u, w
	}
	owner, w := makeUser("Owner")
	guest, gw := makeUser("Guest")
	const identifier = "skills:github.com/team/reviewer"
	packageZip := func(version int, invalid bool) []byte {
		t.Helper()
		var b bytes.Buffer
		writer := zip.NewWriter(&b)
		content := fmt.Sprintf("---\nname: Reviewer v%d\ndescription: Updated description v%d\n---\n# Review v%d\nInspect the changes.\n", version, version, version)
		paths := []string{"bundle/SKILL.md", "bundle/scripts/check.sh", "bundle/logo.png"}
		bodies := [][]byte{[]byte(content), []byte(fmt.Sprintf("#!/bin/sh\necho version-%d\n", version)), {0, 0xff, byte(version)}}
		if version == 1 {
			paths = append(paths, "bundle/removed.md")
			bodies = append(bodies, []byte("old note"))
		} else {
			paths = append(paths, "bundle/new.md")
			bodies = append(bodies, []byte("new note"))
		}
		if invalid {
			paths = append(paths, "bundle/../escape.sh")
			bodies = append(bodies, []byte("bad path"))
		}
		for i, path := range paths {
			h := &zip.FileHeader{Name: path, Method: zip.Deflate}
			if strings.HasSuffix(path, ".sh") {
				h.SetMode(0755)
			} else {
				h.SetMode(0644)
			}
			file, err := writer.CreateHeader(h)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = file.Write(bodies[i]); err != nil {
				t.Fatal(err)
			}
		}
		if err = writer.Close(); err != nil {
			t.Fatal(err)
		}
		return b.Bytes()
	}
	zip1, zip2, invalidZip := packageZip(1, false), packageZip(2, false), packageZip(2, true)
	var mu sync.Mutex
	version := 1
	remoteCalls := 0
	fail, invalid, blocked := false, false, false
	downloadStarted := make(chan struct{}, 1)
	releaseDownload := make(chan struct{})
	previousClient := agentBuddyHTTP
	agentBuddyHTTP = &http.Client{Transport: buddySyncTransport(func(r *http.Request) (*http.Response, error) {
		mu.Lock()
		remoteCalls++
		v, f, bad, block := version, fail, invalid, blocked
		mu.Unlock()
		if r.URL.Hostname() != "skills.byted.org" {
			t.Errorf("unexpected host: %s", r.URL)
		}
		body := []byte{}
		status := 200
		switch {
		case strings.HasPrefix(r.URL.Path, "/api/v2/package/versions/"):
			// newest is deliberately not first, verifying tag-based selection.
			body = []byte(fmt.Sprintf(`{"data":[{"identifier":"old-component","version":"0","tags":[]},{"identifier":"component-%d","version":"%d","tags":["newest"]}]}`, v, v))
		case strings.HasPrefix(r.URL.Path, "/api/v2/package/"):
			body = []byte(`{"data":{"identifier":"` + identifier + `","name":"Registry name","description":"Registry description","repository":"team-repo"}}`)
		case strings.HasPrefix(r.URL.Path, "/api/v2/component/"):
			if !strings.HasSuffix(r.URL.Path, fmt.Sprintf("component-%d", v)) {
				t.Errorf("wrong component: %s", r.URL.Path)
			}
			body = []byte(`{"data":{"assets":[{"download_link":"https://skills.byted.org/api/v1/download/latest.zip","content_type":"application/zip"}]}}`)
		case r.URL.Path == "/api/v1/download/latest.zip":
			if block {
				downloadStarted <- struct{}{}
				select {
				case <-releaseDownload:
				case <-r.Context().Done():
					return nil, r.Context().Err()
				}
			}
			if f {
				status = 503
				body = []byte("temporary failure")
			} else if bad {
				body = invalidZip
			} else if v == 1 {
				body = zip1
			} else {
				body = zip2
			}
		default:
			t.Errorf("unexpected request: %s", r.URL)
			status = 404
		}
		return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(body)), Request: r}, nil
	})}
	defer func() { agentBuddyHTTP = previousClient }()
	handler := New(st, "http://127.0.0.1:1", "", "", w.ID, nil, WithAuthentication(time.Hour)).Handler()
	call := func(user store.User, wid, method, path string, body any) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(body)
		r := httptest.NewRequest(method, "/api/v1"+path, bytes.NewReader(raw))
		r.AddCookie(&http.Cookie{Name: authCookieName, Value: user.ID})
		r.Header.Set("X-Steer-Workspace", wid)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, r)
		return rec
	}
	rec := call(owner, w.ID, "POST", "/skills/import", map[string]string{"identifier": identifier})
	if rec.Code != 201 {
		t.Fatalf("import failed: %d %s", rec.Code, rec.Body.String())
	}
	var original store.Skill
	if err = json.Unmarshal(rec.Body.Bytes(), &original); err != nil {
		t.Fatal(err)
	}
	agent, err := st.CreateAgent(ctx, w.ID, store.Agent{Name: "Worker", RuntimeProvider: "test"})
	if err != nil {
		t.Fatal(err)
	}
	if err = st.SetAgentSkills(ctx, w.ID, agent.ID, []string{original.ID}); err != nil {
		t.Fatal(err)
	}
	workflow, err := st.CreateCodebaseWorkflow(ctx, store.CodebaseWorkflow{ID: uuid.NewString(), WorkspaceID: w.ID, Name: "Review", RepoID: "repo", RepoPath: "team/repo", SkillIDs: []string{original.ID}})
	if err != nil {
		t.Fatal(err)
	}
	type result struct {
		Skill   store.Skill `json:"skill"`
		Changed bool        `json:"changed"`
	}
	syncSkill := func(skill store.Skill) *httptest.ResponseRecorder {
		return call(owner, w.ID, "POST", "/skills/"+skill.ID+"/sync", map[string]any{"updatedAt": skill.UpdatedAt})
	}
	mu.Lock()
	version = 2
	beforeCalls := remoteCalls
	mu.Unlock()
	if unauthorized := call(guest, gw.ID, "POST", "/skills/"+original.ID+"/sync", map[string]any{}); unauthorized.Code != 404 {
		t.Fatalf("cross-workspace sync: %d", unauthorized.Code)
	}
	if forged := call(guest, w.ID, "POST", "/skills/"+original.ID+"/sync", map[string]any{}); forged.Code != 403 {
		t.Fatalf("forged workspace sync: %d", forged.Code)
	}
	mu.Lock()
	if remoteCalls != beforeCalls {
		t.Error("unauthorized update reached upstream")
	}
	mu.Unlock()
	rec = syncSkill(original)
	if rec.Code != 200 {
		t.Fatalf("sync failed: %d %s", rec.Code, rec.Body.String())
	}
	var updated result
	if err = json.Unmarshal(rec.Body.Bytes(), &updated); err != nil {
		t.Fatal(err)
	}
	if !updated.Changed || updated.Skill.ID != original.ID || !updated.Skill.CreatedAt.Equal(original.CreatedAt) || updated.Skill.Name != "Reviewer v2" || updated.Skill.Description != "Updated description v2" || !strings.Contains(updated.Skill.Content, "# Review v2") {
		t.Fatalf("wrong synced skill: %+v", updated)
	}
	if value(updated.Skill.SourceURL) != "https://skills.bytedance.net/skills/"+identifier || updated.Skill.SourceKind != "agentbuddy" {
		t.Fatalf("source changed: %+v", updated.Skill)
	}
	files := map[string]store.SkillFile{}
	for _, file := range updated.Skill.Files {
		files[file.Path] = file
	}
	if _, old := files["removed.md"]; old || len(files) != 4 || files["new.md"].Content != "new note" || !files["scripts/check.sh"].Executable {
		t.Fatalf("package not fully replaced: %+v", files)
	}
	if files["logo.png"].Encoding != "base64" || files["logo.png"].Content != base64.StdEncoding.EncodeToString([]byte{0, 0xff, 2}) {
		t.Fatalf("binary asset corrupted: %+v", files["logo.png"])
	}
	bound, err := st.AgentSkills(ctx, w.ID, agent.ID)
	if err != nil || len(bound) != 1 || bound[0].ID != original.ID || bound[0].Content != updated.Skill.Content {
		t.Fatalf("agent association lost: %+v %v", bound, err)
	}
	persistedFlow, err := st.CodebaseWorkflow(ctx, w.ID, workflow.ID)
	if err != nil || len(persistedFlow.SkillIDs) != 1 || persistedFlow.SkillIDs[0] != original.ID {
		t.Fatalf("workflow association lost: %+v %v", persistedFlow, err)
	}
	rec = syncSkill(updated.Skill)
	if rec.Code != 200 {
		t.Fatal(rec.Body.String())
	}
	var unchanged result
	_ = json.Unmarshal(rec.Body.Bytes(), &unchanged)
	if unchanged.Changed {
		t.Fatal("unchanged upstream reported an update")
	}
	// Failures and unsafe archives leave every field untouched.
	for _, invalidPackage := range []bool{false, true} {
		mu.Lock()
		fail = !invalidPackage
		invalid = invalidPackage
		mu.Unlock()
		rec = syncSkill(unchanged.Skill)
		if rec.Code != 400 && rec.Code != 502 {
			t.Fatalf("invalid upstream accepted: %d %s", rec.Code, rec.Body.String())
		}
		retained, err := st.Skill(ctx, w.ID, original.ID)
		if err != nil || !reflect.DeepEqual(retained, unchanged.Skill) {
			t.Fatalf("failed sync modified skill: %+v %v", retained, err)
		}
	}
	mu.Lock()
	fail = false
	invalid = false
	mu.Unlock()
	manual, err := st.CreateSkill(ctx, w.ID, store.Skill{Name: "Manual", Content: "# Manual", SourceKind: "manual"})
	if err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	beforeCalls = remoteCalls
	mu.Unlock()
	if rec = syncSkill(manual); rec.Code != 400 {
		t.Fatalf("manual source accepted: %d", rec.Code)
	}
	// Stale pages are rejected before performing downloads.
	if rec = syncSkill(original); rec.Code != 409 {
		t.Fatalf("stale update token accepted: %d %s", rec.Code, rec.Body.String())
	}
	mu.Lock()
	if remoteCalls != beforeCalls {
		t.Error("unsupported or stale sync reached upstream")
	}
	blocked = true
	mu.Unlock()
	// An edit committed during downloading wins; the fetched package is rejected
	// as a conflict instead of overwriting local files or metadata.
	response := make(chan *httptest.ResponseRecorder, 1)
	go func() { response <- syncSkill(unchanged.Skill) }()
	select {
	case <-downloadStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("download did not start")
	}
	editedFiles := []store.SkillFile{{Path: "SKILL.md", Content: "# Local edit", Encoding: "text"}, {Path: "local.md", Content: "keep me", Encoding: "text"}}
	edited, err := st.UpdateSkillFiles(ctx, w.ID, original.ID, editedFiles, "# Local edit")
	close(releaseDownload)
	if err != nil {
		t.Fatal(err)
	}
	rec = <-response
	if rec.Code != 409 {
		t.Fatalf("concurrent edit overwritten: %d %s", rec.Code, rec.Body.String())
	}
	retained, err := st.Skill(ctx, w.ID, original.ID)
	if err != nil || !reflect.DeepEqual(retained, edited) {
		t.Fatalf("edit not retained: %+v %v", retained, err)
	}
}
