package api

import (
	"strings"
	"testing"
)

func TestFeishuTranscriptKeepsMessagesAndGroupsInterveningTools(t *testing.T) {
	message := "我先检查接入逻辑。\n\n" + strings.Repeat("保留 Agent 原本的过程消息。", 14)
	process := feishuProcess{Items: []*feishuActivity{
		{ID: "message", Type: "agentmessage", Text: message},
		{ID: "command1", Tool: true, Type: "commandexecution", Title: "rg feishu server", Status: "completed"},
		{ID: "command2", Tool: true, Type: "commandexecution", Title: "cat server/go.mod", Status: "completed"},
		{ID: "thinking", Type: "reasoning", Text: "Inspecting files in the directory"},
		{ID: "command3", Tool: true, Type: "commandexecution", Title: "go test", Status: "completed"},
		{ID: "file", Tool: true, Type: "filechange", Text: `[{"path":"server/feishu.go"}]`, Status: "completed"},
		{ID: "active", Tool: true, Type: "commandexecution", Title: "go vet", Status: "running"},
	}}
	items := feishuProcessTranscript(process)
	if len(items) != 5 {
		t.Fatalf("transcript has %d blocks, want 5: %v", len(items), items)
	}
	if items[0]["tag"] != "markdown" || items[0]["content"] != message {
		t.Fatal("Agent message was rewritten, prefixed or flattened")
	}
	group := items[1]
	if group["tag"] != "collapsible_panel" || group["expanded"] != false || feishuRecord(feishuRecord(group["header"])["title"])["content"] != "执行了 2 条命令" {
		t.Fatalf("tool block should collapse into command count: %v", group)
	}
	if strings.Contains(feishuRecord(feishuRecord(group["header"])["title"])["content"].(string), "rg") {
		t.Fatal("tool details leaked into group heading")
	}
	if items[2]["content"] != "Inspecting relevant files and directories." {
		t.Fatalf("reasoning differs from Web status: %v", items[2])
	}
	if feishuRecord(feishuRecord(items[3]["header"])["title"])["content"] != "执行了 1 条命令 · 修改了文件" {
		t.Fatalf("second action group = %v", items[3])
	}
	if !strings.Contains(items[4]["content"].(string), "go vet") || !strings.Contains(items[4]["content"].(string), "正在执行命令") {
		t.Fatal("active tool should remain visible outside completed group")
	}
}

func TestFeishuToolGroupStaysStableAsActionsFinish(t *testing.T) {
	first := &feishuActivity{ID: "command1", Type: "commandexecution", Tool: true, Title: "pwd", Status: "completed"}
	before := feishuProcessTranscript(feishuProcess{Items: []*feishuActivity{first}})
	after := feishuProcessTranscript(feishuProcess{Items: []*feishuActivity{first, {ID: "command2", Type: "toolcall", Tool: true, Title: "Bash", Text: `{"command":"ls"}`, Status: "completed"}}})
	if before[0]["element_id"] != after[0]["element_id"] {
		t.Fatal("group identity changed as new tools completed")
	}
	if feishuRecord(feishuRecord(after[0]["header"])["title"])["content"] != "执行了 2 条命令" {
		t.Fatal("raw Bash tool should count as command")
	}
}

func TestFeishuReasoningDescriptionMatchesWebCategories(t *testing.T) {
	for _, test := range []struct{ input, want string }{
		{"Ready to provide a final answer", "Preparing the final response."},
		{"Inspect the build and test results", "Checking build, test, and verification status."},
		{"Check relay events", "Reviewing the Relay execution path and Runtime events."},
		{"Inspect PostgreSQL migration", "Tracing the application data flow and persistence layer."},
		{"Inspect frontend components", "Reviewing the relevant interface implementation."},
		{"Review the repository architecture", "Reviewing the project structure and key files."},
	} {
		if got := feishuReasoningDescription(test.input); got != test.want {
			t.Fatalf("%q: got %q, want %q", test.input, got, test.want)
		}
	}
}

func TestFeishuToolDetailsUseSeparateLinesWithoutCompletionNoise(t *testing.T) {
	row := feishuToolDetailElement(&feishuActivity{Type: "commandexecution", Tool: true, Title: "go test ./...", Status: "completed"})
	if row["content"] != "**运行测试**\n`go test ./...`" {
		t.Fatalf("tool row = %v", row)
	}
	row = feishuToolDetailElement(&feishuActivity{Type: "commandexecution", Tool: true, Title: "go test ./...", Status: "failed", Output: "setup logs\nerror: test assertion failed\nstack trace"})
	if got := row["content"].(string); !strings.Contains(got, "\n错误：error:") || strings.Contains(got, "stack trace") {
		t.Fatalf("error row = %s", got)
	}
}
