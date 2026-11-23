package store

import (
	"context"
	"testing"
	"time"
)

func TestCodebaseMergeRequestsNewestUpdateFirstAcrossPages(t *testing.T) {
	s, wid := testStore(t)
	ctx := context.Background()
	old := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	recent := old.Add(24 * time.Hour)
	latest := recent.Add(24 * time.Hour)
	items := []CodebaseMergeRequest{
		{ID: 1, IID: 1, Title: "Old MR", State: "open", CreatedAt: &old, UpdatedAt: &old},
		{ID: 2, IID: 2, Title: "New MR", State: "open", CreatedAt: &recent, UpdatedAt: &recent},
		{ID: 3, IID: 3, Title: "Same update time", State: "open", CreatedAt: &recent, UpdatedAt: &recent},
	}
	if _, _, _, err := s.UpsertCodebaseMergeRequests(ctx, wid, "7", "org/repo", items); err != nil {
		t.Fatal(err)
	}
	// An update to the oldest MR must move it ahead of newer-created MRs.
	items[0].UpdatedAt = &latest
	if _, _, _, err := s.UpsertCodebaseMergeRequests(ctx, wid, "7", "org/repo", items[:1]); err != nil {
		t.Fatal(err)
	}
	for page, want := range []int{1, 3, 2} {
		list, total, err := s.CodebaseMergeRequests(ctx, wid, "7", "open", "", page+1, 1)
		if err != nil || total != 3 || len(list) != 1 || list[0].IID != want {
			t.Fatalf("page %d: items=%+v total=%d error=%v, want MR %d", page+1, list, total, err, want)
		}
	}
}
