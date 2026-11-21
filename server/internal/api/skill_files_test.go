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

	"github.com/KDF5000/steer/server/internal/store"
	"github.com/google/uuid"
)

func TestNormalizeSkillFiles(t *testing.T) {
	t.Run("sorts SKILL.md first and defaults to text", func(t *testing.T) {
		files, err := normalizeSkillFiles([]store.SkillFile{
			{Path: "scripts/run.sh", Content: "echo hi"},
			{Path: "SKILL.md", Content: "# Skill"},
			{Path: "reference\\notes.md", Content: "notes"},
		})
		if err != nil {
			t.Fatal(err)
		}
		if len(files) != 3 || files[0].Path != "SKILL.md" || files[1].Path != "reference/notes.md" || files[2].Path != "scripts/run.sh" {
			t.Fatalf("unexpected order: %+v", files)
		}
		for _, file := range files {
			if file.Encoding != "text" || file.Size != len(file.Content) {
				t.Fatalf("file was not normalized: %+v", file)
			}
		}
	})

	t.Run("rejects unsafe paths and duplicates", func(t *testing.T) {
		for _, files := range [][]store.SkillFile{
			{{Path: "../escape.md", Content: "x"}},
			{{Path: "/etc/passwd", Content: "x"}},
			{{Path: "a/../../b.md", Content: "x"}},
			{{Path: "a//b.md", Content: "x"}},
			{{Path: "SKILL.md", Content: "x"}, {Path: "skill.MD", Content: "y"}},
		} {
			if _, err := normalizeSkillFiles(files); err == nil {
				t.Fatalf("expected %+v to be rejected", files)
			}
		}
	})

	t.Run("validates base64 and per-file size", func(t *testing.T) {
		if _, err := normalizeSkillFiles([]store.SkillFile{{Path: "SKILL.md", Content: "x"}, {Path: "logo.png", Content: "not base64", Encoding: "base64"}}); err == nil {
			t.Fatal("expected invalid base64 to be rejected")
		}
		big := strings.Repeat("a", maxSkillFileSize+1)
		if _, err := normalizeSkillFiles([]store.SkillFile{{Path: "SKILL.md", Content: "x"}, {Path: "big.txt", Content: big}}); err == nil {
			t.Fatal("expected oversized file to be rejected")
		}
	})
}

func TestSkillFilesHTTP(t *testing.T) {
	databaseURL := os.Getenv("STEER_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set STEER_TEST_DATABASE_URL for integration tests")
	}
	st, err := store.Open(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err = st.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	wid := "skill-files-" + uuid.NewString()
	if err = st.EnsureWorkspace(context.Background(), wid, "Skill files test"); err != nil {
		t.Fatal(err)
	}
	handler := New(st, "http://127.0.0.1:1", "", "http://127.0.0.1:1", wid, nil).Handler()
	call := func(method, path, body string, want int) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, "/api/v1"+path, strings.NewReader(body))
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s %s = %d, want %d: %s", method, path, w.Code, want, w.Body.String())
		}
		return w
	}

	var created store.Skill
	json.Unmarshal(call("POST", "/skills", `{"name":"Reviewer","description":"Reviews diffs","content":"# Review\n\nInspect the diff."}`, http.StatusCreated).Body.Bytes(), &created)
	if len(created.Files) != 1 || created.Files[0].Path != "SKILL.md" || created.Files[0].Content != created.Content {
		t.Fatalf("manual skill did not synthesize SKILL.md: %+v", created)
	}

	var detail store.Skill
	json.Unmarshal(call("GET", "/skills/"+created.ID, "", http.StatusOK).Body.Bytes(), &detail)
	if len(detail.Files) != 1 || detail.Files[0].Path != "SKILL.md" {
		t.Fatalf("detail did not return files: %+v", detail)
	}

	var updated store.Skill
	json.Unmarshal(call("PUT", "/skills/"+created.ID+"/files", `{"files":[
		{"path":"SKILL.md","content":"# Review v2"},
		{"path":"scripts/check.sh","content":"echo check"},
		{"path":"assets/logo.png","content":"aGVsbG8=","encoding":"base64"}
	]}`, http.StatusOK).Body.Bytes(), &updated)
	if len(updated.Files) != 3 || updated.Content != "# Review v2" {
		t.Fatalf("files were not saved: %+v", updated)
	}
	if updated.Files[0].Path != "SKILL.md" || updated.Files[1].Encoding != "base64" || updated.Files[1].Size != 5 {
		t.Fatalf("files were not normalized: %+v", updated.Files)
	}

	call("PUT", "/skills/"+created.ID+"/files", `{"files":[{"path":"notes.md","content":"no entrypoint"}]}`, http.StatusBadRequest)
	call("PUT", "/skills/"+created.ID+"/files", `{"files":[{"path":"../escape.md","content":"x"},{"path":"SKILL.md","content":"x"}]}`, http.StatusBadRequest)

	// The settings form edits instructions directly; the entry file follows.
	var resynced store.Skill
	json.Unmarshal(call("PUT", "/skills/"+created.ID, `{"name":"Reviewer","description":"Reviews diffs","content":"# Review v3"}`, http.StatusOK).Body.Bytes(), &resynced)
	if resynced.Content != "# Review v3" || len(resynced.Files) != 3 || resynced.Files[0].Content != "# Review v3" {
		t.Fatalf("instructions did not sync to SKILL.md: %+v", resynced)
	}
	if resynced.Files[1].Path != "assets/logo.png" {
		t.Fatalf("other files were not preserved: %+v", resynced.Files)
	}

	// Listing stays lightweight and must not embed file contents.
	list := call("GET", "/skills", "", http.StatusOK).Body.String()
	if strings.Contains(list, "scripts/check.sh") {
		t.Fatalf("list endpoint should not include files: %s", list)
	}
	if !strings.Contains(list, fmt.Sprintf("%q", created.ID)) {
		t.Fatalf("list endpoint did not return the skill: %s", list)
	}
}
