package api

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/KDF5000/steer/server/internal/store"
)

func TestCodebaseMergeRequestHeadSHAFromVersions(t *testing.T) {
	raw := codebaseMergeRequestPayload{
		ID:           "12345",
		Number:       42,
		Status:       "open",
		TargetRepoID: "998523",
		Title:        "Add pre-triage",
		Versions: []struct {
			SourceCommitID string `json:"SourceCommitId"`
			BaseCommitID   string `json:"BaseCommitId"`
		}{
			{SourceCommitID: "1111111111111111111111111111111111111111", BaseCommitID: "0000000000000000000000000000000000000000"},
			{SourceCommitID: "2222222222222222222222222222222222222222", BaseCommitID: "0000000000000000000000000000000000000000"},
		},
	}
	item, err := codebaseMergeRequestFromPayload(raw, "bytestore/meta")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if item.HeadSHA != "2222222222222222222222222222222222222222" {
		t.Fatalf("HeadSHA = %q, want latest version SourceCommitId", item.HeadSHA)
	}
}

func TestCodebaseWebhookParsesHeadSHAAndDraft(t *testing.T) {
	payload := json.RawMessage(`{
		"Action": "updated",
		"Repository": {"Id": "998523", "Path": "bytestore/meta"},
		"MergeRequest": {
			"Id": "798211675582276",
			"Number": 365,
			"Status": "open",
			"Title": "WIP: draft change",
			"Draft": true,
			"SourceCommitId": "abcdef1234567890abcdef1234567890abcdef12"
		}
	}`)
	review, ok := parseCodebaseMergeRequestWebhook(payload)
	if !ok {
		t.Fatal("expected webhook payload to parse")
	}
	if review.HeadSHA != "abcdef1234567890abcdef1234567890abcdef12" {
		t.Fatalf("HeadSHA = %q", review.HeadSHA)
	}
	if !review.Draft {
		t.Fatal("expected Draft=true")
	}
}

func TestParseAndExtractCodebaseReviewJSON(t *testing.T) {
	doc := `{
		"schema_version": "0.2",
		"scope": {"head_sha": "abcdef1234567890abcdef1234567890abcdef12"},
		"triage": {"risk_floor": "R1", "track": "fast"},
		"risk": {"level": "R1"},
		"disposition": "no_confirmed_findings",
		"merge_policy": "auto_approve_eligible"
	}`
	meta, ok := parseCodebaseReviewJSON([]byte(doc))
	if !ok {
		t.Fatal("expected valid v0.2 review.json to parse")
	}
	if meta.HeadSHA != "abcdef1234567890abcdef1234567890abcdef12" ||
		meta.RiskFloor != "R1" || meta.RiskLevel != "R1" ||
		meta.ReviewTrack != "fast" || meta.Disposition != "no_confirmed_findings" ||
		meta.MergePolicy != "auto_approve_eligible" {
		t.Fatalf("unexpected meta: %+v", meta)
	}

	reply := "Summary text\n```json\n" + doc + "\n```\nDone."
	extracted, ok := extractCodebaseReviewJSONFromText(reply)
	if !ok {
		t.Fatal("expected fenced json block to be extracted")
	}
	if _, ok := parseCodebaseReviewJSON(extracted); !ok {
		t.Fatal("extracted json did not parse")
	}

	if _, ok := parseCodebaseReviewJSON([]byte(`{"schema_version":"0.2","merge_policy":"invalid_policy"}`)); ok {
		t.Fatal("expected invalid merge_policy to fail")
	}
}

func TestBuildReviewPromptAndReportBadges(t *testing.T) {
	wf := store.CodebaseWorkflow{Name: "Meta AI Review", RepoPath: "bytestore/meta"}
	run := store.CodebaseRun{
		MRIID:       405,
		MRTitle:     "Fix lock order",
		MRURL:       "https://code.byted.org/bytestore/meta/merge_requests/405",
		HeadSHA:     "abcdef1234567890abcdef1234567890abcdef12",
		Round:       2,
		RiskLevel:   "R3",
		ReviewTrack: "deep",
		Disposition: "no_confirmed_findings",
		MergePolicy: "human_review_required",
		Summary:     "All checks reviewed.",
	}
	prior := json.RawMessage(`{"schema_version":"0.2","findings":[]}`)
	prompt := buildReviewPrompt(wf, run, "Fix deadlock in MS2", prior)
	for _, want := range []string{"Head SHA: abcdef123456", "Review Round: 2", "Fix deadlock in MS2", "PRIOR_RESULT"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt missing %q:\n%s", want, prompt)
		}
	}

	report := buildCodebaseReport(wf, run, "<!-- steer-review:wf1 -->")
	for _, want := range []string{"**Route:** `human_review_required`", "**Risk:** `R3` (`deep`)", "**Commit:** `abcdef123456`", "**Round:** 2"} {
		if !strings.Contains(report, want) {
			t.Fatalf("report missing %q:\n%s", want, report)
		}
	}
}

func TestCleanCodebaseReviewSummary(t *testing.T) {
	raw := "结论如下。\n\n<details> <summary>展开代码依据</summary>\n- 要点 1\n</details>\n交付：[review.md](file:///tmp/review.md) · [review.json](file:///tmp/review.json)\n<details><summary>结构化审查元数据</summary>\n```json\n{\"schema_version\":\"0.2\",\"merge_policy\":\"human_review_required\"}\n```\n</details>"
	cleaned := cleanCodebaseReviewSummary(raw)
	for _, forbidden := range []string{"<details>", "</details>", "<summary>", "</summary>", "review.md", "review.json", "schema_version"} {
		if strings.Contains(cleaned, forbidden) {
			t.Fatalf("cleaned summary still contains %q:\n%s", forbidden, cleaned)
		}
	}
	if !strings.Contains(cleaned, "### 展开代码依据") || !strings.Contains(cleaned, "- 要点 1") {
		t.Fatalf("expected details summary converted to heading:\n%s", cleaned)
	}
}
