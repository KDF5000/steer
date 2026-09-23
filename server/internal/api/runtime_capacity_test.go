package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUpdateNodeCapacityProxiesVisibleNode(t *testing.T) {
	var capacity int
	relayServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/v1/nodes":
			writeJSON(w, http.StatusOK, []map[string]any{{"id": "node-a", "capacity": 2, "desired_capacity": 2, "runtimes": []map[string]any{{"id": "node-a/trae", "provider": "trae"}}}})
		case r.Method == http.MethodPut && r.URL.Path == "/v1/nodes/node-a/capacity":
			if err := json.NewDecoder(r.Body).Decode(&struct {
				Capacity *int `json:"capacity"`
			}{Capacity: &capacity}); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"id": "node-a", "capacity": 2, "desired_capacity": capacity, "runtimes": []map[string]any{{"id": "node-a/trae", "provider": "trae"}}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer relayServer.Close()
	server := New(nil, relayServer.URL, "host-token", relayServer.URL, "workspace", nil)
	request := httptest.NewRequest(http.MethodPut, "/api/v1/nodes/node-a/capacity", strings.NewReader(`{"capacity":4}`))
	request.SetPathValue("id", "node-a")
	response := httptest.NewRecorder()
	server.updateNodeCapacity(response, request)
	if response.Code != http.StatusOK || capacity != 4 || !strings.Contains(response.Body.String(), `"desired_capacity":4`) {
		t.Fatalf("status=%d capacity=%d body=%s", response.Code, capacity, response.Body.String())
	}
}
