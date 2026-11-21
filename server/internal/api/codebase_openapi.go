package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
)

type codebaseOpenAPICredentials struct {
	AppID     string
	AppSecret string
	UserJWT   string
}

// codebaseOpenAPIActions is the explicit allowlist of Codebase actions Steer
// calls. Reviews are read-only except for publishing the summary comment back
// to the merge request.
var codebaseOpenAPIActions = map[string]bool{
	"GetRepository":         true,
	"GetMergeRequest":       true,
	"ListRepoMergeRequests": true,
	"GetApp":                true,
	"ListThreads":           true,
	"CreateComment":         true,
	"UpdateComment":         true,
}

// Codebase OpenAPI uses POST /v2/?Action=... and a metadata/result envelope.
// Its official App/User headers are unrelated to GitLab PRIVATE-TOKEN auth.
func requestCodebaseOpenAPI(ctx context.Context, address string, credentials codebaseOpenAPICredentials, action string, input, result any) error {
	u, err := url.Parse(address)
	if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "http" && u.Scheme != "https") || u.Path != "" && u.Path != "/" {
		return invalidCodebase("Codebase API address must be an HTTP(S) origin.")
	}
	if credentials.UserJWT != "" && (credentials.AppID != "" || credentials.AppSecret != "") || credentials.UserJWT == "" && (credentials.AppID == "" || credentials.AppSecret == "") {
		return invalidCodebase("Choose App credentials or a personal Codebase JWT.")
	}
	for _, value := range []string{credentials.AppID, credentials.AppSecret, credentials.UserJWT} {
		if strings.ContainsAny(value, "\r\n\x00") {
			return invalidCodebase("Invalid Codebase credential.")
		}
	}
	if !codebaseOpenAPIActions[action] {
		return invalidCodebase("Unsupported Codebase action.")
	}
	body, err := json.Marshal(input)
	if err != nil {
		return invalidCodebase("Invalid Codebase request.")
	}
	u.Path = "/v2/"
	u.RawQuery = url.Values{"Action": {action}}.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(body))
	if err != nil {
		return invalidCodebase("Invalid Codebase request.")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if credentials.UserJWT != "" {
		req.Header.Set("X-Code-User-JWT", credentials.UserJWT)
	} else {
		req.Header.Set("X-Code-App-ID", credentials.AppID)
		req.Header.Set("X-Code-App-Secret", credentials.AppSecret)
	}
	response, err := codebaseHTTP.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return upstreamCodebase("codebase_unavailable", "Could not reach Codebase. Check the server address and network connection.")
	}
	defer response.Body.Close()
	if response.StatusCode >= 300 && response.StatusCode < 400 {
		return upstreamCodebase("codebase_redirect", "Codebase redirected the API request. Check the API address and token authentication.")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, codebaseResponseLimit+1))
	if err != nil {
		return upstreamCodebase("codebase_read_failed", "Could not read the Codebase response.")
	}
	if len(data) > codebaseResponseLimit {
		return upstreamCodebase("codebase_response_large", "Codebase response is too large. Narrow the repository selection.")
	}
	var envelope struct {
		ResponseMetadata struct {
			Action string
			Error  *struct{ Code, Message string }
		}
		Result json.RawMessage
	}
	jsonErr := json.Unmarshal(data, &envelope)
	if response.StatusCode < 200 || response.StatusCode >= 300 || envelope.ResponseMetadata.Error != nil {
		switch response.StatusCode {
		case 401:
			return upstreamCodebase("codebase_token_invalid", "Codebase token is invalid or expired.")
		case 403:
			return upstreamCodebase("codebase_permission_denied", "Codebase token does not have permission to read this resource.")
		case 429:
			return upstreamCodebase("codebase_rate_limited", "Codebase rate limit exceeded. Try again later.")
		}
		if envelope.ResponseMetadata.Error != nil {
			switch envelope.ResponseMetadata.Error.Code {
			case "Unauthorized":
				return upstreamCodebase("codebase_token_invalid", "Codebase token is invalid or expired.")
			case "Forbidden", "PermissionDenied":
				return upstreamCodebase("codebase_permission_denied", "Codebase token does not have permission to read this resource.")
			}
		}
		return upstreamCodebase("codebase_upstream_error", "Codebase returned an error. Try again later.")
	}
	if jsonErr != nil || envelope.ResponseMetadata.Action != action || (result != nil && (len(envelope.Result) == 0 || string(envelope.Result) == "null")) {
		return upstreamCodebase("codebase_api_incompatible", "Codebase did not return a compatible JSON response. Check the API configuration.")
	}
	// Write actions such as CreateComment may legitimately return an empty
	// result; callers that need the response pass a non-nil destination.
	if result == nil {
		return nil
	}
	if err = json.Unmarshal(envelope.Result, result); err != nil {
		return upstreamCodebase("codebase_api_incompatible", "Codebase did not return a compatible JSON response. Check the API configuration.")
	}
	return nil
}
