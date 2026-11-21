package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/KDF5000/steer/server/internal/store"
)

func expectCodebaseError(t *testing.T, err error, code string) {
	t.Helper()
	var remote codebaseError
	if !errors.As(err, &remote) || remote.Code != code {
		t.Fatalf("error = %v, want %s", err, code)
	}
}

func TestCodebaseConnectionValidation(t *testing.T) {
	for _, address := range []string{"file:///tmp", "https://secret@host", "https://host?token=secret", "https://host/#login", "https://host/../api", "https://host/%2e%2e/api"} {
		item := store.CodebaseConnection{BaseURL: address, AppID: "app"}
		expectCodebaseError(t, normalizeCodebaseConnection(&item), "codebase_invalid_input")
	}
	item := store.CodebaseConnection{BaseURL: " https://host/ ", AppID: " my-app "}
	if err := normalizeCodebaseConnection(&item); err != nil || item.BaseURL != "https://host" || item.AppID != "my-app" {
		t.Fatalf("normalize: %+v, %v", item, err)
	}
	// Empty App ID should fail
	item2 := store.CodebaseConnection{BaseURL: "https://host", AppID: "  "}
	if err := normalizeCodebaseConnection(&item2); err == nil {
		t.Fatalf("expected error for empty App ID")
	}
	for _, project := range []string{"../repo", "org/../repo", "/repo", "org/repo?token=x", "org\\repo"} {
		if validCodebaseProject(project) {
			t.Fatalf("accepted %q", project)
		}
	}
}

func TestCodebaseOpenAPISyncListUsesUpdatedCursor(t *testing.T) {
	var seen map[string]any
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("Action") != "ListRepoMergeRequests" {
			t.Errorf("unexpected action: %s", r.URL.Query().Get("Action"))
			w.WriteHeader(404)
			return
		}
		_ = json.NewDecoder(r.Body).Decode(&seen)
		fmt.Fprint(w, `{"ResponseMetadata":{"Action":"ListRepoMergeRequests","RequestId":"x"},"Result":{"MergeRequests":[{"Id":"10","Number":2,"TargetRepoId":"7","Title":"MR","Status":"open","CreatedAt":"2026-01-01T10:00:00Z","UpdatedAt":"2026-01-02T10:00:00Z"}],"PageNumber":1,"PageSize":100,"TotalCount":1}}`)
	}))
	defer remote.Close()
	repo := CodebaseRepository{ID: "7", Path: "org/repo", Name: "repo"}
	list, err := codebaseMRListPage(context.Background(), remote.URL, codebaseOpenAPICredentials{AppID: "a", AppSecret: "b"}, repo, codebaseMRListOptions{
		Page:      1,
		PageSize:  codebaseSyncPageSize,
		SortBy:    "UpdatedAt",
		SortOrder: "Desc",
	})
	if err != nil || len(list.Items) != 1 {
		t.Fatalf("sync list: %+v %v", list, err)
	}
	if seen["TargetRepoId"] != "7" || seen["PageSize"] != float64(100) || seen["SortBy"] != "UpdatedAt" || seen["SortOrder"] != "Desc" {
		t.Fatalf("sync list body: %+v", seen)
	}
	if _, ok := seen["Status"]; ok {
		t.Fatalf("sync should not filter by state: %+v", seen)
	}
	if list.Items[0].UpdatedAt != "2026-01-02T10:00:00Z" {
		t.Fatalf("missing updated timestamp: %+v", list.Items[0])
	}
}

func TestCodebaseOpenAPIReadProtocolAndPagination(t *testing.T) {
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.Path != "/v2/" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL)
		}
		if r.Header.Get("X-Code-App-ID") != "test-app" || r.Header.Get("X-Code-App-Secret") != "test-secret" || r.Header.Get("X-Code-User-JWT") != "" {
			t.Errorf("unexpected credential headers")
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		switch r.URL.Query().Get("Action") {
		case "GetRepository":
			if body["Path"] != "org/repo" {
				t.Errorf("repository body: %+v", body)
			}
			fmt.Fprint(w, `{"ResponseMetadata":{"Action":"GetRepository","RequestId":"x"},"Result":{"Repository":{"Id":"7","Path":"org/repo","Name":"repo"}}}`)
		case "ListRepoMergeRequests":
			if body["TargetRepoId"] != "7" || body["Status"] != "open" || body["Title"] != "中文 fix" || body["PageNumber"] != float64(2) || body["PageSize"] != float64(20) {
				t.Errorf("body: %+v", body)
			}
			selector, _ := body["Selector"].(map[string]any)
			if selector["URL"] != true || selector["User"] != true {
				t.Errorf("selector: %+v", selector)
			}
			fmt.Fprint(w, `{"ResponseMetadata":{"Action":"ListRepoMergeRequests","RequestId":"x"},"Result":{"MergeRequests":[{"Id":"10","Number":2,"TargetRepoId":"7","Title":"真实标题","URL":"javascript:alert(1)","Status":"open"}],"PageNumber":2,"PageSize":20,"TotalCount":42}}`)
		default:
			t.Errorf("unexpected action: %s", r.URL.Query().Get("Action"))
			w.WriteHeader(404)
		}
	}))
	defer remote.Close()
	credentials := codebaseOpenAPICredentials{AppID: "test-app", AppSecret: "test-secret"}
	list, err := codebaseMRList(context.Background(), remote.URL, credentials, "org/repo", "opened", "中文 fix", 2)
	if err != nil || len(list.Items) != 1 || list.Total == nil || *list.Total != 42 || list.Items[0].WebURL != "" || list.Items[0].Labels == nil {
		t.Fatalf("list: %+v, %v", list, err)
	}
	if list.Items[0].IID != 2 || list.Items[0].ProjectID != 7 || list.Items[0].References.Full != "org/repo!2" {
		t.Fatalf("mapping: %+v", list.Items[0])
	}
}

func TestCodebaseOpenAPIResponseValidation(t *testing.T) {
	for _, tc := range []struct {
		name, body, code string
		status           int
	}{
		{"unauthorized 401", `{"ResponseMetadata":{"Action":"GetApp","Error":{"Code":"Unauthorized","Message":"nope"}}}`, "codebase_token_invalid", 401},
		{"unauthorized 200", `{"ResponseMetadata":{"Action":"GetApp","Error":{"Code":"Unauthorized","Message":"nope"}}}`, "codebase_token_invalid", 200},
		{"forbidden", `{"ResponseMetadata":{"Action":"ListRepoMergeRequests","Error":{"Code":"Forbidden","Message":"nope"}}}`, "codebase_permission_denied", 200},
		{"html", `<html>login</html>`, "codebase_api_incompatible", 200},
		{"wrong action", `{"ResponseMetadata":{"Action":"WrongAction"},"Result":{}}`, "codebase_api_incompatible", 200},
		{"null result", `{"ResponseMetadata":{"Action":"GetApp"},"Result":null}`, "codebase_api_incompatible", 200},
		{"mr missing id", `{"ResponseMetadata":{"Action":"ListRepoMergeRequests"},"Result":{"MergeRequests":[{"Number":2,"TargetRepoId":"7","Title":"missing id"}]}}`, "codebase_api_incompatible", 200},
		{"response too large", strings.Repeat("x", codebaseResponseLimit+1), "codebase_response_large", 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Query().Get("Action") == "GetRepository" {
					fmt.Fprint(w, `{"ResponseMetadata":{"Action":"GetRepository","RequestId":"x"},"Result":{"Repository":{"Id":"7","Path":"org/repo","Name":"repo"}}}`)
					return
				}
				w.WriteHeader(tc.status)
				fmt.Fprint(w, tc.body)
			}))
			defer remote.Close()
			credentials := codebaseOpenAPICredentials{AppID: "app", AppSecret: "secret"}
			var err error
			// Use GetApp for auth cases, ListRepoMergeRequests for the rest
			if strings.Contains(tc.name, "unauthorized") || strings.Contains(tc.name, "forbidden") {
				_, err = codebaseUser(context.Background(), remote.URL, credentials)
			} else {
				_, err = codebaseMRList(context.Background(), remote.URL, credentials, "org/repo", "opened", "", 1)
			}
			expectCodebaseError(t, err, tc.code)
			if strings.Contains(err.Error(), "secret") {
				t.Fatal("leaked secret")
			}
		})
	}
}

func TestCodebaseOpenAPIRedirectDoesNotForwardToken(t *testing.T) {
	var reached bool
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { reached = true }))
	defer destination.Close()
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, destination.URL, 302) }))
	defer remote.Close()
	_, err := codebaseUser(context.Background(), remote.URL, codebaseOpenAPICredentials{AppID: "app", AppSecret: "test-secret"})
	expectCodebaseError(t, err, "codebase_redirect")
	if reached {
		t.Fatal("redirect followed with credentials")
	}
}

func TestCodebaseOpenAPIPaginationFallback(t *testing.T) {
	for _, hasTotal := range []bool{false, true} {
		remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Query().Get("Action") == "GetRepository" {
				fmt.Fprint(w, `{"ResponseMetadata":{"Action":"GetRepository","RequestId":"x"},"Result":{"Repository":{"Id":"7","Path":"org/repo","Name":"repo"}}}`)
				return
			}
			items := make([]map[string]any, codebasePageSize)
			for i := range items {
				items[i] = map[string]any{"Id": strconv.Itoa(i + 1), "Number": i + 1, "TargetRepoId": "7", "Title": "MR", "Status": "open"}
			}
			result := map[string]any{"MergeRequests": items}
			if hasTotal {
				result["TotalCount"] = 100
			}
			resp := map[string]any{
				"ResponseMetadata": map[string]any{"Action": "ListRepoMergeRequests"},
				"Result":           result,
			}
			_ = json.NewEncoder(w).Encode(resp)
		}))
		list, err := codebaseMRList(context.Background(), remote.URL, codebaseOpenAPICredentials{AppID: "a", AppSecret: "b"}, "org/repo", "all", "", 1)
		remote.Close()
		if err != nil || list.NextPage == nil {
			t.Fatalf("pagination: %+v %v", list, err)
		}
		if hasTotal && (list.Total == nil || *list.Total != 100) {
			t.Fatalf("total: %+v", list)
		}
	}
}
