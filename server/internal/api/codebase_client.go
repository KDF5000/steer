package api

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/KDF5000/steer/server/internal/store"
)

const codebasePageSize = 20
const codebaseSyncPageSize = 100
const codebaseSyncMaxPages = 50
const codebaseResponseLimit = 4 << 20

var codebaseHTTP = &http.Client{
	Timeout: 15 * time.Second,
	// Never forward credentials through login or cross-host redirects.
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

var codebaseProjectPattern = regexp.MustCompile(`^[a-zA-Z0-9_.-]+(/[a-zA-Z0-9_.-]+)*$`)

type codebaseError struct {
	Code, Message string
	Status        int
}

func (e codebaseError) Error() string { return e.Message }
func invalidCodebase(message string) error {
	return codebaseError{Code: "codebase_invalid_input", Message: message, Status: http.StatusBadRequest}
}
func upstreamCodebase(code, message string) error {
	return codebaseError{Code: code, Message: message, Status: http.StatusBadGateway}
}

func normalizeCodebaseConnection(item *store.CodebaseConnection) error {
	u, err := url.Parse(strings.TrimSpace(item.BaseURL))
	if err != nil || u.Hostname() == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || strings.ContainsAny(u.Path, "\r\n\\") {
		return invalidCodebase("Codebase API address must be an HTTP(S) origin.")
	}
	for _, part := range strings.Split(u.Path, "/") {
		if part == "." || part == ".." {
			return invalidCodebase("Codebase API address contains an invalid path.")
		}
	}
	item.BaseURL = strings.TrimRight(u.String(), "/")
	item.AppID = strings.TrimSpace(item.AppID)
	if item.AppID == "" {
		return invalidCodebase("App ID is required.")
	}
	if strings.ContainsAny(item.AppID, "\r\n\x00") {
		return invalidCodebase("Invalid App ID.")
	}
	return nil
}

type codebaseRemoteUser struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Name     string `json:"name"`
}

type CodebaseMergeRequest struct {
	ID           int64    `json:"id"`
	IID          int      `json:"iid"`
	ProjectID    int64    `json:"project_id"`
	Title        string   `json:"title"`
	Description  string   `json:"description"`
	State        string   `json:"state"`
	WebURL       string   `json:"web_url"`
	SourceBranch string   `json:"source_branch"`
	TargetBranch string   `json:"target_branch"`
	CreatedAt    string   `json:"created_at"`
	UpdatedAt    string   `json:"updated_at"`
	Draft        bool     `json:"draft"`
	Labels       []string `json:"labels"`
	Author       struct {
		Name     string `json:"name"`
		Username string `json:"username"`
	} `json:"author"`
	References struct {
		Full string `json:"full"`
	} `json:"references"`
}

type CodebaseMergeRequests struct {
	Items    []CodebaseMergeRequest `json:"items"`
	Page     int                    `json:"page"`
	NextPage *int                   `json:"nextPage"`
	Total    *int                   `json:"total"`
}

func codebaseUser(ctx context.Context, baseURL string, credentials codebaseOpenAPICredentials) (codebaseRemoteUser, error) {
	var result struct {
		App struct {
			ID          string `json:"Id"`
			Name        string `json:"Name"`
			Description string `json:"Description"`
		} `json:"App"`
	}
	err := requestCodebaseOpenAPI(ctx, baseURL, credentials, "GetApp", map[string]any{}, &result)
	if err != nil {
		return codebaseRemoteUser{}, err
	}
	user := codebaseRemoteUser{
		ID:       result.App.ID,
		Username: result.App.Name,
		Name:     result.App.Name,
	}
	if user.Username == "" {
		user.Username = credentials.AppID
	}
	return user, nil
}

func validCodebaseProject(project string) bool {
	if !codebaseProjectPattern.MatchString(project) {
		return false
	}
	for _, part := range strings.Split(project, "/") {
		if part == "." || part == ".." {
			return false
		}
	}
	return true
}

type CodebaseRepository struct {
	ID   string `json:"id"`
	Path string `json:"path"`
	Name string `json:"name"`
}

func codebaseRepository(ctx context.Context, baseURL string, credentials codebaseOpenAPICredentials, path string) (CodebaseRepository, error) {
	var result struct {
		Repository struct {
			ID   string `json:"Id"`
			Path string `json:"Path"`
			Name string `json:"Name"`
		} `json:"Repository"`
	}
	err := requestCodebaseOpenAPI(ctx, baseURL, credentials, "GetRepository", map[string]any{"Path": path}, &result)
	if err != nil {
		return CodebaseRepository{}, err
	}
	repo := CodebaseRepository{
		ID:   result.Repository.ID,
		Path: result.Repository.Path,
		Name: result.Repository.Name,
	}
	if repo.ID == "" || repo.Path == "" {
		return repo, upstreamCodebase("codebase_api_incompatible", "Codebase did not return a valid repository.")
	}
	return repo, nil
}

func codebaseRepositoryByID(ctx context.Context, baseURL string, credentials codebaseOpenAPICredentials, id string) (CodebaseRepository, error) {
	var result struct {
		Repository struct {
			ID   string `json:"Id"`
			Path string `json:"Path"`
			Name string `json:"Name"`
		} `json:"Repository"`
	}
	if err := requestCodebaseOpenAPI(ctx, baseURL, credentials, "GetRepository", map[string]any{"Id": id}, &result); err != nil {
		return CodebaseRepository{}, err
	}
	repo := CodebaseRepository{
		ID:   result.Repository.ID,
		Path: result.Repository.Path,
		Name: result.Repository.Name,
	}
	if repo.ID == "" || repo.Path == "" {
		return repo, upstreamCodebase("codebase_api_incompatible", "Codebase did not return a valid repository.")
	}
	return repo, nil
}

func sanitizeCodebaseMR(item *CodebaseMergeRequest) {
	u, err := url.Parse(item.WebURL)
	if err != nil || u.Hostname() == "" || u.User != nil || (u.Scheme != "https" && u.Scheme != "http") {
		item.WebURL = ""
	}
	if item.Labels == nil {
		item.Labels = []string{}
	}
}

// codebaseMergeRequestPayload mirrors the MergeRequestService.MergeRequest IDL.
// It uses Codebase's own naming (TargetRepoId, URL, CreatedBy) rather than GitLab's.
type codebaseMergeRequestPayload struct {
	ID               string `json:"Id"`
	Number           int    `json:"Number"`
	Status           string `json:"Status"`
	TargetRepoID     string `json:"TargetRepoId"`
	SourceBranchName string `json:"SourceBranchName"`
	TargetBranchName string `json:"TargetBranchName"`
	Title            string `json:"Title"`
	Description      string `json:"Description"`
	URL              string `json:"URL"`
	CreatedAt        string `json:"CreatedAt"`
	UpdatedAt        string `json:"UpdatedAt"`
	Draft            bool   `json:"Draft"`
	Labels           []struct {
		Name string `json:"Name"`
	} `json:"Labels"`
	CreatedBy struct {
		Username    string `json:"Username"`
		DisplayName struct {
			Content string `json:"Content"`
		} `json:"DisplayName"`
	} `json:"CreatedBy"`
}

func incompatibleMergeRequest() error {
	return upstreamCodebase("codebase_api_incompatible", "Codebase did not return compatible merge requests.")
}

func codebaseMergeRequestFromPayload(raw codebaseMergeRequestPayload, repoPath string) (CodebaseMergeRequest, error) {
	var item CodebaseMergeRequest
	id, err := strconv.ParseInt(raw.ID, 10, 64)
	if err != nil || id <= 0 || raw.Number <= 0 || raw.Title == "" {
		return item, incompatibleMergeRequest()
	}
	repoID, err := strconv.ParseInt(raw.TargetRepoID, 10, 64)
	if err != nil || repoID <= 0 {
		return item, incompatibleMergeRequest()
	}
	item = CodebaseMergeRequest{
		ID:           id,
		IID:          raw.Number,
		ProjectID:    repoID,
		Title:        raw.Title,
		Description:  raw.Description,
		State:        strings.ToLower(raw.Status),
		WebURL:       raw.URL,
		SourceBranch: raw.SourceBranchName,
		TargetBranch: raw.TargetBranchName,
		CreatedAt:    raw.CreatedAt,
		UpdatedAt:    raw.UpdatedAt,
		Draft:        raw.Draft,
		Labels:       []string{},
	}
	for _, label := range raw.Labels {
		if label.Name != "" {
			item.Labels = append(item.Labels, label.Name)
		}
	}
	item.Author.Username = raw.CreatedBy.Username
	item.Author.Name = raw.CreatedBy.DisplayName.Content
	if item.Author.Name == "" {
		item.Author.Name = item.Author.Username
	}
	if item.Author.Username == "" {
		item.Author.Username = item.Author.Name
	}
	item.References.Full = "!" + strconv.Itoa(raw.Number)
	if repoPath != "" {
		item.References.Full = repoPath + item.References.Full
	}
	sanitizeCodebaseMR(&item)
	return item, nil
}

func codebaseMRStatus(state string) (string, error) {
	switch state {
	case "opened", "open":
		return "open", nil
	case "merged":
		return "merged", nil
	case "closed":
		return "closed", nil
	case "all", "":
		return "", nil
	}
	return "", invalidCodebase("Invalid MR state.")
}

type codebaseMRListOptions struct {
	State     string
	Search    string
	Page      int
	PageSize  int
	SortBy    string
	SortOrder string
}

// codebaseMRListPage reads one page from Codebase for an already resolved
// repository. Default to most recently updated first for both browsing and
// synchronization; sorting upstream keeps that order across page boundaries.
func codebaseMRListPage(ctx context.Context, baseURL string, credentials codebaseOpenAPICredentials, repo CodebaseRepository, opts codebaseMRListOptions) (CodebaseMergeRequests, error) {
	result := CodebaseMergeRequests{Items: []CodebaseMergeRequest{}, Page: opts.Page}
	if opts.Page < 1 || opts.Page > 100000 {
		return result, invalidCodebase("Invalid MR page.")
	}
	if opts.PageSize <= 0 || opts.PageSize > 100 {
		opts.PageSize = codebasePageSize
	}
	if opts.SortBy == "" {
		opts.SortBy = "UpdatedAt"
	}
	if opts.SortOrder == "" {
		opts.SortOrder = "Desc"
	}
	status, err := codebaseMRStatus(opts.State)
	if err != nil {
		return result, err
	}
	input := map[string]any{
		"TargetRepoId": repo.ID,
		"PageNumber":   opts.Page,
		"PageSize":     opts.PageSize,
		"Selector":     map[string]any{"URL": true, "User": true},
	}
	if status != "" {
		input["Status"] = status
	}
	if opts.Search != "" {
		input["Title"] = opts.Search
	}
	if opts.SortBy != "" {
		input["SortBy"] = opts.SortBy
	}
	if opts.SortOrder != "" {
		input["SortOrder"] = opts.SortOrder
	}
	var listResult struct {
		MergeRequests []codebaseMergeRequestPayload `json:"MergeRequests"`
		TotalCount    int                           `json:"TotalCount"`
	}
	if err = requestCodebaseOpenAPI(ctx, baseURL, credentials, "ListRepoMergeRequests", input, &listResult); err != nil {
		return result, err
	}
	result.Items = make([]CodebaseMergeRequest, 0, len(listResult.MergeRequests))
	for _, raw := range listResult.MergeRequests {
		item, err := codebaseMergeRequestFromPayload(raw, repo.Path)
		if err != nil {
			return result, err
		}
		result.Items = append(result.Items, item)
	}
	total := listResult.TotalCount
	result.Total = &total
	if len(result.Items) == opts.PageSize {
		next := opts.Page + 1
		result.NextPage = &next
	}
	return result, nil
}

func codebaseMRList(ctx context.Context, baseURL string, credentials codebaseOpenAPICredentials, project, state, search string, page int) (CodebaseMergeRequests, error) {
	if !validCodebaseProject(project) {
		return CodebaseMergeRequests{Items: []CodebaseMergeRequest{}, Page: page}, invalidCodebase("A repository is required to list merge requests.")
	}
	// ListRepoMergeRequests is keyed by repository ID, so resolve the path first.
	repo, err := codebaseRepository(ctx, baseURL, credentials, project)
	if err != nil {
		return CodebaseMergeRequests{Items: []CodebaseMergeRequest{}, Page: page}, err
	}
	return codebaseMRListPage(ctx, baseURL, credentials, repo, codebaseMRListOptions{
		State:    state,
		Search:   search,
		Page:     page,
		PageSize: codebasePageSize,
	})
}

func codebaseMRDetail(ctx context.Context, baseURL string, credentials codebaseOpenAPICredentials, project string, iid int) (CodebaseMergeRequest, error) {
	var result CodebaseMergeRequest
	if iid <= 0 {
		return result, invalidCodebase("A valid MR number is required.")
	}
	if !validCodebaseProject(project) {
		return result, invalidCodebase("Repository must be a namespace/project path.")
	}
	// The UI passes the numeric repository ID; paths are still accepted and resolved.
	repoID, repoPath := project, ""
	if _, err := strconv.ParseInt(project, 10, 64); err != nil {
		repo, err := codebaseRepository(ctx, baseURL, credentials, project)
		if err != nil {
			return result, err
		}
		repoID, repoPath = repo.ID, repo.Path
	}
	input := map[string]any{
		"RepoId":   repoID,
		"Number":   iid,
		"Selector": map[string]any{"URL": true, "User": true},
	}
	var detail struct {
		MergeRequest codebaseMergeRequestPayload `json:"MergeRequest"`
	}
	err := requestCodebaseOpenAPI(ctx, baseURL, credentials, "GetMergeRequest", input, &detail)
	if err != nil {
		return result, err
	}
	result, err = codebaseMergeRequestFromPayload(detail.MergeRequest, repoPath)
	if err != nil {
		return result, err
	}
	if result.IID != iid {
		return result, upstreamCodebase("codebase_api_incompatible", "Codebase returned an unexpected merge request.")
	}
	return result, nil
}

func writeCodebaseError(w http.ResponseWriter, err error) {
	var remote codebaseError
	if errors.As(err, &remote) {
		writeJSON(w, remote.Status, map[string]string{"error": remote.Message, "code": remote.Code})
		return
	}
	writeError(w, err)
}
