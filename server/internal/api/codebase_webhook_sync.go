package api

import (
	"context"
	"errors"
	"strconv"
	"strings"

	"github.com/KDF5000/steer/server/internal/store"
)

// Refresh the cache independently of review workflows. Fetch the current MR
// rather than applying a partial webhook payload: delayed deliveries must not
// reopen a merged MR or erase its description, author and branch metadata.
func (s *Server) refreshCodebaseWebhookMR(ctx context.Context, wid string, review codebaseWebhookReview) (codebaseWebhookReview, error) {
	var repo store.CodebaseRepository
	if review.RepoID != "" {
		var err error
		repo, err = s.store.CodebaseRepositoryByID(ctx, wid, review.RepoID)
		if errors.Is(err, store.ErrNotFound) {
			return review, nil
		}
		if err != nil {
			return review, err
		}
	} else {
		repositories, err := s.store.CodebaseRepos(ctx, wid)
		if err != nil {
			return review, err
		}
		for _, item := range repositories {
			if strings.EqualFold(item.RepoPath, review.RepoPath) {
				repo = store.CodebaseRepository{RepoID: item.RepoID, RepoPath: item.RepoPath}
				break
			}
		}
		if repo.RepoID == "" {
			return review, nil
		}
	}
	connection, credentials, err := s.storedCodebaseCredentialByWorkspace(ctx, wid)
	if err != nil {
		return review, err
	}
	mr, err := codebaseMRDetail(ctx, connection.BaseURL, credentials, repo.RepoID, review.MRIID)
	if err != nil {
		return review, err
	}
	if strconv.FormatInt(mr.ProjectID, 10) != repo.RepoID {
		return review, incompatibleMergeRequest()
	}
	if mr.State == "" {
		return review, incompatibleMergeRequest()
	}
	item := store.CodebaseMergeRequest{
		ID: mr.ID, IID: mr.IID, ProjectID: mr.ProjectID,
		Title: mr.Title, Description: mr.Description, State: mr.State, WebURL: mr.WebURL,
		SourceBranch: mr.SourceBranch, TargetBranch: mr.TargetBranch, HeadSHA: mr.HeadSHA,
		CreatedAt: parseCodebaseTime(mr.CreatedAt), UpdatedAt: parseCodebaseTime(mr.UpdatedAt),
		Draft: mr.Draft, Labels: mr.Labels,
		Author: store.CodebaseMRAuthor{Name: mr.Author.Name, Username: mr.Author.Username},
	}
	if previous, err := s.store.CodebaseMergeRequest(ctx, wid, repo.RepoID, mr.IID); err == nil {
		if item.CreatedAt == nil {
			item.CreatedAt = previous.CreatedAt
		}
		if item.UpdatedAt == nil {
			item.UpdatedAt = previous.UpdatedAt
		}
	} else if !errors.Is(err, store.ErrNotFound) {
		return review, err
	}
	if _, _, _, err := s.store.UpsertCodebaseMergeRequests(ctx, wid, repo.RepoID, repo.RepoPath, []store.CodebaseMergeRequest{item}); err != nil {
		return review, err
	}
	// Another delivery may have stored a newer revision while the API request
	// was in flight. Use the persisted state for the review decision as well.
	saved, err := s.store.CodebaseMergeRequest(ctx, wid, repo.RepoID, mr.IID)
	if err != nil {
		return review, err
	}
	// A single-MR webhook must not advance the repository's incremental sync
	// cursor, which would skip other MRs updated since the last full sync.
	review.RepoID, review.RepoPath = repo.RepoID, repo.RepoPath
	review.State, review.MRTitle, review.MRURL = saved.State, saved.Title, saved.WebURL
	review.Draft = saved.Draft
	if saved.HeadSHA != "" {
		review.HeadSHA = saved.HeadSHA
	}
	return review, nil
}
