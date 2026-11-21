package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"

	"github.com/KDF5000/relay"
	"github.com/KDF5000/steer/server/internal/store"
	"github.com/google/uuid"
)

func TestTaskSkillPackagesAgentAndWorkflow(t *testing.T) {
	databaseURL := os.Getenv("STEER_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set STEER_TEST_DATABASE_URL for integration tests")
	}
	ctx := context.Background()
	st, err := store.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	wid := "skills-" + uuid.NewString()
	if err := st.EnsureWorkspace(ctx, wid, "Skills"); err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	var requests []relay.Request
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/nodes" {
			writeJSON(w, 200, []map[string]any{{"id": "machine", "labels": map[string]string{relay.SkillSupportLabel: relay.SkillSupportVersion}, "runtimes": []map[string]any{{"id": "machine/test", "provider": "test"}}}})
			return
		}
		if r.URL.Path == "/v1/runs" && r.Method == http.MethodPost {
			var request relay.Request
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Error(err)
			}
			mu.Lock()
			requests = append(requests, request)
			mu.Unlock()
			writeJSON(w, 202, map[string]any{"id": uuid.NewString(), "status": "running"})
			return
		}
		writeJSON(w, 200, []any{})
	}))
	defer remote.Close()
	server := New(st, remote.URL, "", remote.URL, wid, nil)
	agent, err := st.CreateAgent(ctx, wid, store.Agent{Name: "Worker", RuntimeProvider: "test"})
	if err != nil {
		t.Fatal(err)
	}
	create := func(name string) store.Skill {
		t.Helper()
		skill, err := st.CreateSkill(ctx, wid, store.Skill{Name: name, Content: "Read references/rules.md", Files: []store.SkillFile{{Path: "references/rules.md", Content: name + " rules", Encoding: "text"}, {Path: "scripts/check", Content: "#!/bin/sh\nexit 0\n", Encoding: "text", Executable: true}}})
		if err != nil {
			t.Fatal(err)
		}
		return skill
	}
	assigned := create("Agent")
	workflow := create("Workflow")
	if err := st.SetAgentSkills(ctx, wid, agent.ID, []string{assigned.ID}); err != nil {
		t.Fatal(err)
	}
	submit := func() relay.Request {
		t.Helper()
		// The duplicate assignment must be sent only once.
		_, _, err := server.submitConversationTask(ctx, wid, chatRequest{AgentID: agent.ID, Prompt: "do work", SkillIDs: []string{workflow.ID, assigned.ID, workflow.ID}}, nil, "test")
		if err != nil {
			t.Fatal(err)
		}
		mu.Lock()
		defer mu.Unlock()
		return requests[len(requests)-1]
	}
	first := submit()
	if len(first.Skills) != 2 {
		t.Fatalf("skills=%+v", first.Skills)
	}
	versions := map[string]string{}
	for _, skill := range first.Skills {
		if len(skill.Files) != 3 {
			t.Fatalf("missing package files: %+v", skill)
		}
		versions[skill.ID] = skill.Version
	}
	if err := relay.ValidateSkills(first.Skills); err != nil {
		t.Fatal(err)
	}
	again := submit()
	for _, skill := range again.Skills {
		if versions[skill.ID] != skill.Version {
			t.Fatal("unchanged task changed skill version")
		}
	}
	workflow.Files[0].Content = "Updated workflow rules"
	if _, err := st.UpdateSkillFiles(ctx, wid, workflow.ID, workflow.Files, workflow.Content); err != nil {
		t.Fatal(err)
	}
	updated := submit()
	for _, skill := range updated.Skills {
		if skill.ID == workflow.ID && skill.Version == versions[skill.ID] {
			t.Fatal("workflow rule update did not change version")
		}
		if skill.ID == assigned.ID && skill.Version != versions[skill.ID] {
			t.Fatal("unmodified agent skill changed version")
		}
	}
	// Install exactly the wire snapshot and resolve a referenced file from SKILL.md.
	fragments, err := relay.InstallSkills(ctx, t.TempDir(), wid, updated.Skills)
	if err != nil || len(fragments) != 2 {
		t.Fatalf("node installation fragments=%v err=%v", fragments, err)
	}
	for _, skill := range updated.Skills {
		for _, file := range skill.Files {
			data, err := base64.StdEncoding.DecodeString(file.Content)
			if err != nil || len(data) == 0 {
				t.Fatalf("invalid file %s: %v", file.Path, err)
			}
		}
	}
}
