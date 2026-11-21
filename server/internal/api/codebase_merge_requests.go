package api

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/KDF5000/steer/server/internal/store"
)

type codebaseMRPage struct {
	Items    []store.CodebaseMergeRequest `json:"items"`
	Page     int                          `json:"page"`
	NextPage *int                         `json:"nextPage"`
	Total    int                          `json:"total"`
	SyncedAt *time.Time                   `json:"syncedAt"`
}

// codebaseRepositories lists repositories bound to a review workflow. The
// merge request page is repository-centric: one repository may have several
// workflows with different reviewer agents.
func (s *Server) codebaseRepositories(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.CodebaseRepos(r.Context(), s.workspace(r))
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) codebaseMergeRequests(w http.ResponseWriter, r *http.Request) {
	wid := s.workspace(r)
	q := r.URL.Query()
	repoID := strings.TrimSpace(q.Get("repoId"))
	if repoID == "" || len(repoID) > 100 {
		writeCodebaseError(w, invalidCodebase("Select a repository to list merge requests."))
		return
	}
	state := q.Get("state")
	if state == "" {
		state = "opened"
	}
	switch state {
	case "opened", "open":
		state = "open"
	case "merged", "closed":
	case "all":
		state = ""
	default:
		writeCodebaseError(w, invalidCodebase("Invalid MR state."))
		return
	}
	search := strings.TrimSpace(q.Get("search"))
	if len(search) > 200 {
		writeCodebaseError(w, invalidCodebase("MR search is too long."))
		return
	}
	page := 1
	if q.Get("page") != "" {
		value, err := strconv.Atoi(q.Get("page"))
		if err != nil || value < 1 {
			writeCodebaseError(w, invalidCodebase("Invalid MR page."))
			return
		}
		page = value
	}
	pageSize := codebasePageSize
	if q.Get("pageSize") != "" {
		value, err := strconv.Atoi(q.Get("pageSize"))
		if err != nil || value < 1 || value > 100 {
			writeCodebaseError(w, invalidCodebase("Invalid MR page size."))
			return
		}
		pageSize = value
	}
	items, total, err := s.store.CodebaseMergeRequests(r.Context(), wid, repoID, state, search, page, pageSize)
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	result := codebaseMRPage{Items: items, Page: page, Total: total}
	if page*pageSize < total {
		next := page + 1
		result.NextPage = &next
	}
	if syncRow, err := s.store.CodebaseRepoSync(r.Context(), wid, repoID); err == nil {
		result.SyncedAt = syncRow.LastSyncedAt
	} else if !errors.Is(err, store.ErrNotFound) {
		writeCodebaseError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

type codebaseSyncInput struct {
	RepoID   string `json:"repoId"`
	RepoPath string `json:"repoPath"`
	Full     bool   `json:"full"`
}

type codebaseSyncResult struct {
	RepoID     string    `json:"repoId"`
	RepoPath   string    `json:"repoPath"`
	RepoName   string    `json:"repoName"`
	Created    int       `json:"created"`
	Updated    int       `json:"updated"`
	Unchanged  int       `json:"unchanged"`
	Fetched    int       `json:"fetched"`
	Pages      int       `json:"pages"`
	SyncedAt   time.Time `json:"syncedAt"`
	OpenCount  int       `json:"openCount"`
	TotalCount int       `json:"totalCount"`
}

// codebaseSyncMergeRequests pulls the newest merge requests for a repository
// into the database. Subsequent syncs stop as soon as they reach data stored by
// the previous sync, which backfills webhook events that were missed without
// re-ingesting the whole repository each time.
func (s *Server) codebaseSyncMergeRequests(w http.ResponseWriter, r *http.Request) {
	wid := s.workspace(r)
	var in codebaseSyncInput
	if err := decodeJSON(r, &in); err != nil {
		writeCodebaseError(w, invalidCodebase("Invalid sync input."))
		return
	}
	in.RepoID = strings.TrimSpace(in.RepoID)
	in.RepoPath = strings.TrimSpace(in.RepoPath)
	if in.RepoID == "" && in.RepoPath == "" {
		writeCodebaseError(w, invalidCodebase("Select a repository to sync."))
		return
	}
	c, credentials, err := s.storedCodebaseCredential(r)
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	var repo CodebaseRepository
	if in.RepoID != "" {
		repo, err = codebaseRepositoryByID(r.Context(), c.BaseURL, credentials, in.RepoID)
	} else {
		if !validCodebaseProject(in.RepoPath) {
			writeCodebaseError(w, invalidCodebase("Repository must be a namespace/project path."))
			return
		}
		repo, err = codebaseRepository(r.Context(), c.BaseURL, credentials, in.RepoPath)
	}
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	var cursor *time.Time
	if !in.Full {
		syncRow, err := s.store.CodebaseRepoSync(r.Context(), wid, repo.ID)
		if err == nil {
			cursor = syncRow.LastMRUpdatedAt
		} else if !errors.Is(err, store.ErrNotFound) {
			writeCodebaseError(w, err)
			return
		}
	}
	result, syncErr := s.syncCodebaseRepoMergeRequests(r.Context(), wid, c.BaseURL, credentials, repo, cursor)
	if syncErr != nil {
		_ = s.store.SetCodebaseRepoSyncError(r.Context(), wid, repo.ID, repo.Path, syncErr.Error())
		writeCodebaseError(w, syncErr)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) syncCodebaseRepoMergeRequests(ctx context.Context, wid, baseURL string, credentials codebaseOpenAPICredentials, repo CodebaseRepository, cursor *time.Time) (codebaseSyncResult, error) {
	result := codebaseSyncResult{RepoID: repo.ID, RepoPath: repo.Path, RepoName: repo.Name}
	latest := cursor
	created, updated, unchanged := 0, 0, 0
	for page := 1; page <= codebaseSyncMaxPages; page++ {
		list, err := codebaseMRListPage(ctx, baseURL, credentials, repo, codebaseMRListOptions{
			Page:      page,
			PageSize:  codebaseSyncPageSize,
			SortBy:    "UpdatedAt",
			SortOrder: "Desc",
		})
		if err != nil {
			return result, err
		}
		result.Pages++
		result.Fetched += len(list.Items)
		batch := make([]store.CodebaseMergeRequest, 0, len(list.Items))
		reachedCursor := false
		for _, item := range list.Items {
			itemUpdated := parseCodebaseTime(item.UpdatedAt)
			if cursor != nil && itemUpdated != nil && itemUpdated.Before(*cursor) {
				reachedCursor = true
				break
			}
			batch = append(batch, store.CodebaseMergeRequest{
				ID:           item.ID,
				IID:          item.IID,
				ProjectID:    item.ProjectID,
				Title:        item.Title,
				Description:  item.Description,
				State:        item.State,
				WebURL:       item.WebURL,
				SourceBranch: item.SourceBranch,
				TargetBranch: item.TargetBranch,
				CreatedAt:    parseCodebaseTime(item.CreatedAt),
				UpdatedAt:    itemUpdated,
				Draft:        item.Draft,
				Labels:       item.Labels,
				Author: store.CodebaseMRAuthor{
					Name:     item.Author.Name,
					Username: item.Author.Username,
				},
			})
			if itemUpdated != nil && (latest == nil || itemUpdated.After(*latest)) {
				latest = itemUpdated
			}
		}
		if len(batch) > 0 {
			batchCreated, batchUpdated, batchUnchanged, err := s.store.UpsertCodebaseMergeRequests(ctx, wid, repo.ID, repo.Path, batch)
			if err != nil {
				return result, err
			}
			created += batchCreated
			updated += batchUpdated
			unchanged += batchUnchanged
		}
		if reachedCursor || list.NextPage == nil {
			break
		}
	}
	syncedAt := time.Now().UTC()
	openCount, totalCount, err := s.store.CodebaseMergeRequestCounts(ctx, wid, repo.ID)
	if err != nil {
		return result, err
	}
	if _, err = s.store.SaveCodebaseRepoSync(ctx, store.CodebaseRepoSync{
		WorkspaceID:     wid,
		RepoID:          repo.ID,
		RepoPath:        repo.Path,
		RepoName:        repo.Name,
		LastSyncedAt:    &syncedAt,
		LastMRUpdatedAt: latest,
		LastCreated:     created,
		LastUpdated:     updated,
	}); err != nil {
		return result, err
	}
	result.Created = created
	result.Updated = updated
	result.Unchanged = unchanged
	result.SyncedAt = syncedAt
	result.OpenCount = openCount
	result.TotalCount = totalCount
	return result, nil
}

func parseCodebaseTime(value string) *time.Time {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return nil
	}
	parsed = parsed.UTC()
	return &parsed
}
