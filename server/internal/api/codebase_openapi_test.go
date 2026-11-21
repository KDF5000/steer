package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCodebaseOfficialReadProtocol(t *testing.T) {
	for _, credentials := range []codebaseOpenAPICredentials{{AppID: "app", AppSecret: "secret"}, {UserJWT: "jwt"}} {
		remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != "POST" || r.URL.Path != "/v2/" || r.URL.Query().Get("Action") != "GetRepository" || r.Header.Get("Content-Type") != "application/json" {
				t.Error("incorrect official API request")
			}
			if r.Header.Get("X-Code-App-ID") != credentials.AppID || r.Header.Get("X-Code-App-Secret") != credentials.AppSecret || r.Header.Get("X-Code-User-JWT") != credentials.UserJWT || r.Header.Get("PRIVATE-TOKEN") != "" {
				t.Error("incorrect official credential headers")
			}
			fmt.Fprint(w, `{"ResponseMetadata":{"Action":"GetRepository","RequestId":"example"},"Result":{"Repository":{"Id":"171819","Path":"codebase/demo"}}}`)
		}))
		var result struct{ Repository struct{ Id, Path string } }
		err := requestCodebaseOpenAPI(context.Background(), remote.URL, credentials, "GetRepository", map[string]string{"Path": "codebase/demo"}, &result)
		remote.Close()
		if err != nil || result.Repository.Id != "171819" {
			t.Fatalf("official response: %+v %v", result, err)
		}
	}
}

func TestCodebaseOfficialResponseErrors(t *testing.T) {
	for _, tc := range []struct {
		body, code string
		status     int
	}{
		{`{"ResponseMetadata":{"Action":"GetRepository","Error":{"Code":"Unauthorized","Message":"do not leak secret"}}}`, "codebase_token_invalid", 401},
		{`{"ResponseMetadata":{"Action":"GetRepository","Error":{"Code":"Unauthorized","Message":"do not leak secret"}}}`, "codebase_token_invalid", 200},
		{`{"ResponseMetadata":{"Action":"WrongAction"},"Result":{}}`, "codebase_api_incompatible", 200},
		{`{"Repository":{}}`, "codebase_api_incompatible", 200},
		{`{"ResponseMetadata":{"Action":"GetRepository"},"Result":null}`, "codebase_api_incompatible", 200},
		{`<html>login</html>`, "codebase_api_incompatible", 200},
	} {
		remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(tc.status); fmt.Fprint(w, tc.body) }))
		var result map[string]any
		err := requestCodebaseOpenAPI(context.Background(), remote.URL, codebaseOpenAPICredentials{UserJWT: "jwt"}, "GetRepository", map[string]string{"Path": "codebase/demo"}, &result)
		remote.Close()
		expectCodebaseError(t, err, tc.code)
	}
}
