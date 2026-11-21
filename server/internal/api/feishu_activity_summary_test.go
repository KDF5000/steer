package api

import (
	"fmt"
	"strings"
	"testing"
)

func TestFeishuSearchSummaryDescribesIntentWithoutResults(t *testing.T) {
	item := &feishuActivity{Tool: true, Type: "toolcall", Title: "Grep", Text: `{"pattern":"feishuTaskCard","path":"server/internal/api","output_mode":"content"}`, Output: strings.Repeat("server/internal/api/feishu.go:476: matching source line\n", 1000), Status: "completed"}
	summary := feishuActivitySummary(item)
	for _, want := range []string{"搜索代码", "feishuTaskCard", "server/internal/api", "完成"} {
		if !strings.Contains(summary, want) {
			t.Fatalf("missing %q: %s", want, summary)
		}
	}
	if strings.Contains(summary, "matching source line") || strings.Contains(summary, "output_mode") {
		t.Fatal("grep results or incidental arguments leaked into activity summary")
	}
}

func TestFeishuFileSummaryOmitsContentsAndPatch(t *testing.T) {
	for _, item := range []*feishuActivity{
		{Tool: true, Type: "toolcall", Title: "Read", Text: `{"file_path":"README.md"}`, Output: "entire file body", Status: "completed"},
		{Tool: true, Type: "toolcall", Title: "Write", Text: `{"file_path":"README.md","content":"entire file body"}`, Status: "completed"},
		{Tool: true, Type: "filechange", Title: "修改文件", Text: `[{"path":"README.md","diff":"entire patch"}]`, Output: "entire patch", Status: "completed"},
	} {
		summary := feishuActivitySummary(item)
		if !strings.Contains(summary, "README.md") || strings.Contains(summary, "entire") {
			t.Fatalf("file activity did not retain only target: %s", summary)
		}
	}
}

func TestFeishuCommandSummaryKeepsErrorsAndOmitsScripts(t *testing.T) {
	item := &feishuActivity{Tool: true, Type: "commandexecution", Title: "go test ./...", Status: "failed", Output: "many setup logs\nFAIL error: expected status 200, got 500\nlong stack trace"}
	summary := feishuActivitySummary(item)
	if !strings.Contains(summary, "运行测试") || !strings.Contains(summary, "expected status 200") || strings.Contains(summary, "many setup") || strings.Contains(summary, "stack trace") {
		t.Fatalf("error summary = %s", summary)
	}
	item.Title = "python3 - <<'PY'\nprint('script implementation')\nPY"
	item.Status = "completed"
	summary = feishuActivitySummary(item)
	if !strings.Contains(summary, "运行脚本") || strings.Contains(summary, "script implementation") || strings.Contains(summary, "expected status") {
		t.Fatalf("script source leaked: %s", summary)
	}
}

func TestFeishuRecentActivityFeedAvoidsTruncationNarrative(t *testing.T) {
	process := feishuProcess{}
	for i := 0; i < 100; i++ {
		process.Items = append(process.Items, &feishuActivity{Tool: true, Type: "commandexecution", Title: fmt.Sprintf("rg pattern-%d server", i), Status: "completed", Output: strings.Repeat("long result\n", 2000)})
	}
	summary := feishuProcessSummary(process)
	if !strings.Contains(summary, "pattern-99") || strings.Contains(summary, "pattern-0 ") || strings.Contains(summary, "已省略") || strings.Contains(summary, "Steer") || strings.Contains(summary, "long result") {
		t.Fatalf("unexpected activity feed: %s", summary)
	}
	if len(summary) > 12<<10 {
		t.Fatal("activity summary exceeds card budget")
	}
}
