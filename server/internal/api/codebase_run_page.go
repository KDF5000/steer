package api

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/KDF5000/steer/server/internal/store"
)

func (s *Server) listCodebaseRunPage(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	query := store.CodebaseRunPageQuery{WorkflowID: strings.TrimSpace(q.Get("workflowId")), RepoID: strings.TrimSpace(q.Get("repoId")), Status: q.Get("status"), IncludeShared: q.Get("includeShared") == "true", Page: 1, PageSize: 25}
	if query.Status == "" {
		query.Status = "all"
	}
	switch query.Status {
	case "all", "active", "report-failed", "succeeded", "failed", "pending", "running", "skipped":
	default:
		writeCodebaseError(w, invalidCodebase("Invalid run status."))
		return
	}
	for _, field := range []struct {
		name  string
		value *int
		max   int
	}{{"page", &query.Page, 1000000}, {"pageSize", &query.PageSize, 100}} {
		if q.Get(field.name) == "" {
			continue
		}
		v, err := strconv.Atoi(q.Get(field.name))
		if err != nil || v < 1 || v > field.max {
			writeCodebaseError(w, invalidCodebase("Invalid run "+field.name+"."))
			return
		}
		*field.value = v
	}
	if len(query.WorkflowID) > 200 || len(query.RepoID) > 300 || query.WorkflowID == "share:" || query.RepoID == "share-repo:" {
		writeCodebaseError(w, invalidCodebase("Invalid run filter."))
		return
	}
	user := userFromContext(r.Context())
	page, err := s.store.VisibleCodebaseRunPage(r.Context(), s.workspace(r), user, query)
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	if q.Get("sync") == "true" {
		owned := []store.CodebaseRun{}
		for _, entry := range page.Items {
			if entry.ShareID == "" {
				owned = append(owned, entry.Run)
			}
		}
		original := append([]store.CodebaseRun(nil), owned...)
		synced := s.syncCodebaseRuns(r.Context(), s.workspace(r), owned, 20)
		updates := map[string]store.CodebaseRun{}
		changedFilter := false
		for i, item := range synced {
			updates[item.ID] = item
			if item.Status != original[i].Status || item.ReportStatus != original[i].ReportStatus {
				changedFilter = true
			}
		}
		if changedFilter && query.Status != "all" {
			page, err = s.store.VisibleCodebaseRunPage(r.Context(), s.workspace(r), user, query)
			if err != nil {
				writeCodebaseError(w, err)
				return
			}
		} else {
			for i, entry := range page.Items {
				if entry.ShareID == "" {
					if update, ok := updates[entry.Run.ID]; ok {
						page.Items[i].Run = update
					}
				}
			}
		}
	}
	items := make([]store.CodebaseRun, 0, len(page.Items))
	for _, entry := range page.Items {
		run := entry.Run
		if entry.ShareID != "" {
			// The UI uses grant keys for shared navigation; private execution fields
			// are never included in a recipient's aggregate history.
			run.WorkspaceID = ""
			run.WorkflowID = "share:" + entry.ShareID
			run.RepoID = "share:" + entry.ShareID
			run.TaskID = ""
			run.Model = ""
			run.ReasoningEffort = ""
		}
		items = append(items, run)
	}
	var next *int
	if page.Page*page.PageSize < page.Total {
		value := page.Page + 1
		next = &value
	}
	writeJSON(w, 200, map[string]any{"items": items, "total": page.Total, "page": page.Page, "pageSize": page.PageSize, "nextPage": next})
}
