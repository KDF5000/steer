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

func TestAgentManagementHTTP(t *testing.T) {
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
	workspaceID := "agent-management-" + uuid.NewString()
	if err := st.EnsureWorkspace(ctx, workspaceID, "Agent management test"); err != nil {
		t.Fatal(err)
	}
	handler := New(st, "http://127.0.0.1:1", "", "http://127.0.0.1:1", workspaceID, nil).Handler()
	call := func(method, path, body string, want int) *httptest.ResponseRecorder {
		t.Helper()
		request := httptest.NewRequest(method, "/api/v1"+path, strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != want {
			t.Fatalf("%s %s = %d, want %d: %s", method, path, response.Code, want, response.Body.String())
		}
		return response
	}

	var agent store.Agent
	if err := json.Unmarshal(call(http.MethodPost, "/agents", `{"name":"Disposable","runtimeProvider":"test"}`, http.StatusCreated).Body.Bytes(), &agent); err != nil {
		t.Fatal(err)
	}
	var updated store.Agent
	if err := json.Unmarshal(call(http.MethodPut, "/agents/"+agent.ID, `{"name":"Disposable updated","role":"Temporary","instructions":"Test editing","runtimeProvider":"test","model":"test-model"}`, http.StatusOK).Body.Bytes(), &updated); err != nil {
		t.Fatal(err)
	}
	if updated.Name != "Disposable updated" || updated.Role != "Temporary" || updated.Model == nil || *updated.Model != "test-model" {
		t.Fatalf("Agent was not updated: %+v", updated)
	}
	call(http.MethodDelete, "/agents/"+agent.ID, "", http.StatusOK)
	call(http.MethodPut, "/agents/"+agent.ID, `{"name":"Missing","runtimeProvider":"test"}`, http.StatusNotFound)

	var systemAgent store.Agent
	if err := json.Unmarshal(call(http.MethodPost, "/agents", `{"name":"System Agent","runtimeProvider":"test"}`, http.StatusCreated).Body.Bytes(), &systemAgent); err != nil {
		t.Fatal(err)
	}
	call(http.MethodPut, "/system/settings", fmt.Sprintf(`{"systemAgentId":%q,"interfaceLanguage":"en","aiOutputLanguage":"en"}`, systemAgent.ID), http.StatusOK)
	call(http.MethodDelete, "/agents/"+systemAgent.ID, "", http.StatusConflict)
}
