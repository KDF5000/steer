package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/KDF5000/steer/server/internal/store"
	"github.com/google/uuid"
)

func TestFootprintReportHTTPValidation(t *testing.T) {
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
	wid := "footprint-http-" + uuid.NewString()
	if err := st.EnsureWorkspace(ctx, wid, "Test"); err != nil {
		t.Fatal(err)
	}
	agent, err := st.CreateAgent(ctx, wid, store.Agent{Name: "Builder", RuntimeProvider: "test"})
	if err != nil {
		t.Fatal(err)
	}
	project, err := st.CreateProject(ctx, wid, store.Project{Name: "Steer", WorkspaceKind: "local", WorkspaceSource: "/srv/steer", ExecutionMode: "in_place"})
	if err != nil {
		t.Fatal(err)
	}
	session, err := st.EnsureSession(ctx, wid, uuid.NewString(), "Source", agent.ID, &project.ID, nil, nil, &project)
	if err != nil {
		t.Fatal(err)
	}
	handler := New(st, "", "", "", wid, nil).Handler()
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
	from := time.Now().UTC().Format(time.RFC3339)
	to := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	body := fmt.Sprintf(`{"title":"Work review","content":"Verified changes.","from":%q,"to":%q,"projectId":%q,"sourceSessionIds":[%q]}`, from, to, project.ID, session.ID)
	var saved store.FootprintReport
	if err := json.Unmarshal(call("POST", "/footprints/reports", body, 200).Body.Bytes(), &saved); err != nil {
		t.Fatal(err)
	}
	if saved.ID == "" || len(saved.SourceSessionIDs) != 1 {
		t.Fatalf("report not saved: %+v", saved)
	}
	call("POST", "/footprints/reports", strings.Replace(body, project.ID, "missing-project", 1), 404)
	call("POST", "/footprints/reports", strings.Replace(body, session.ID, "missing-session", 1), 404)
	call("POST", "/footprints/reports", strings.TrimSuffix(body, "}")+`,"runId":"missing-run"}`, 404)
	call("POST", "/footprints/reports", strings.Replace(body, to, from, 1), 400)
	var reports []store.FootprintReport
	if err := json.Unmarshal(call("GET", "/footprints/reports", "", 200).Body.Bytes(), &reports); err != nil {
		t.Fatal(err)
	}
	if len(reports) != 1 {
		t.Fatalf("failed saves persisted reports: %+v", reports)
	}
}
