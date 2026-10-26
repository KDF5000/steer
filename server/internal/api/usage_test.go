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
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestUsageBackgroundSyncWithoutBrowser(t *testing.T) {
	url := os.Getenv("STEER_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set STEER_TEST_DATABASE_URL")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	schema := "usage_sync_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE"); admin.Close() }()
	url += "&search_path=" + schema
	st, err := store.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	wid := "usage-http-" + uuid.NewString()
	if err := st.EnsureWorkspace(ctx, wid, "Usage test"); err != nil {
		t.Fatal(err)
	}
	agent, err := st.CreateAgent(ctx, wid, store.Agent{Name: "Builder", RuntimeProvider: "codex"})
	if err != nil {
		t.Fatal(err)
	}
	session, err := st.EnsureSession(ctx, wid, uuid.NewString(), "Usage", agent.ID, nil, nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	runID := uuid.NewString()
	if _, _, err := st.SaveChatRun(ctx, wid, session.ID, agent.ID, "work", runID, "running"); err != nil {
		t.Fatal(err)
	}
	completed := time.Now().UTC()
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/runs/"+runID {
			fmt.Fprintf(w, `{"id":%q,"agent_id":%q,"status":"succeeded","attempt":{"id":"a","number":1},"runtime":{"provider":"codex","id":"node/codex"},"completed_at":%q}`, runID, agent.ID, completed.Format(time.RFC3339Nano))
			return
		}
		if r.URL.Path == "/v1/runs/"+runID+"/events" {
			fmt.Fprintf(w, `[{"id":"u1","run_id":%q,"attempt_id":"a","sequence":1,"type":"usage.updated","data":{"input_tokens":100,"output_tokens":20,"total_tokens":120,"cache_read_tokens":80,"status":"partial"}},{"id":"u2","run_id":%q,"attempt_id":"a","sequence":2,"type":"usage.updated","data":{"input_tokens":200,"output_tokens":30,"total_tokens":230,"cache_read_tokens":100,"status":"complete"}}]`, runID, runID)
			return
		}
		http.NotFound(w, r)
	}))
	defer fake.Close()
	server := New(st, fake.URL, "", fake.URL, wid, nil)
	stop := server.StartUsageSync(ctx)
	defer stop()
	from, to := completed.Add(-time.Minute), completed.Add(time.Minute)
	deadline := time.Now().Add(5 * time.Second)
	for {
		totals, _, _, err := st.FootprintUsage(ctx, wid, from, to, "", "UTC")
		if err != nil {
			t.Fatal(err)
		}
		if totals.TokenCount != nil && *totals.TokenCount == 230 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("background failed to sync usage %+v", totals)
		}
		time.Sleep(30 * time.Millisecond)
	}
	request := httptest.NewRequest("GET", fmt.Sprintf("/api/v1/footprints?from=%s&to=%s&timezone=UTC", from.Format(time.RFC3339), to.Format(time.RFC3339)), nil)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != 200 {
		t.Fatalf("footprints %d %s", response.Code, response.Body.String())
	}
	var payload struct {
		Totals store.UsageTotals `json:"totals"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Totals.TokenCount == nil || *payload.Totals.TokenCount != 230 || payload.Totals.TokenCoverage != 1 {
		t.Fatalf("wrong API totals %+v", payload.Totals)
	}
	// No provider-native event extraction belongs in Steer.
	if strings.Contains(response.Body.String(), "cached_input_tokens") {
		t.Fatal("native protocol leaked")
	}
}
