package api

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

// Match ProcessTranscript/compactProcessActivities in the Web UI: commentary
// is a message, reasoning is a short status, consecutive actions are a group.
func feishuProcessTranscript(process feishuProcess) []feishuElement {
	var elements []feishuElement
	var actions []*feishuActivity
	flush := func() {
		if len(actions) == 0 {
			return
		}
		var completed, active []*feishuActivity
		for _, action := range actions {
			if action.Status == "completed" || action.Status == "succeeded" || action.Status == "failed" || action.Status == "cancelled" {
				completed = append(completed, action)
			} else {
				active = append(active, action)
			}
		}
		if len(completed) > 0 {
			var details []feishuElement
			for _, action := range completed {
				details = append(details, feishuToolDetailElement(action))
			}
			// Summarize counts in the group label, retain actual actions inside it.
			if len(details) > 12 {
				details = details[len(details)-12:]
			}
			groupID := sha256.Sum256([]byte(completed[0].ID))
			elements = append(elements, feishuElement{"tag": "collapsible_panel", "element_id": fmt.Sprintf("tools_%x", groupID[:6]), "expanded": false,
				"header":   feishuElement{"title": feishuText(feishuActionGroupLabel(completed)), "icon": feishuElement{"tag": "standard_icon", "token": "right-small-ccm_outlined", "size": "16px 16px"}, "icon_position": "follow_text", "icon_expanded_angle": 90},
				"elements": details, "vertical_spacing": "8px", "padding": "4px 0px",
			})
		}
		for _, action := range active {
			elements = append(elements, feishuToolDetailElement(action))
		}
		actions = nil
	}
	for _, item := range process.Items {
		if item.Tool {
			actions = append(actions, item)
			continue
		}
		// Empty started messages do not interrupt a continuous tool group.
		if strings.TrimSpace(item.Text) == "" {
			continue
		}
		flush()
		if item.Type == "reasoning" {
			elements = append(elements, feishuMarkdown(feishuReasoningDescription(item.Text)))
		} else {
			elements = append(elements, feishuMarkdown(feishuTranscriptText(item.Text, 3000)))
		}
	}
	flush()
	if len(elements) == 0 {
		return []feishuElement{feishuMarkdown("Agent 正在执行，暂时还没有新的操作。")}
	}
	// Bound the serialized components, preserving whole messages and groups.
	for len(elements) > 1 {
		encoded, _ := json.Marshal(elements)
		if len(elements) <= 40 && len(encoded) <= 12<<10 {
			break
		}
		elements = elements[1:]
	}
	return elements
}

func feishuToolDetailElement(action *feishuActivity) feishuElement {
	label, detail := feishuActivityIntent(action)
	switch action.Status {
	case "running":
		label = "正在" + label
	case "failed":
		label += " · 失败"
	case "cancelled":
		label += " · 已取消"
	}
	text := "**" + label + "**"
	if detail = feishuActivityExcerpt(detail, 160); detail != "" {
		text += "\n`" + strings.ReplaceAll(detail, "`", "'") + "`"
	}
	if action.Status == "failed" {
		if message := feishuErrorExcerpt(action.Output); message != "" {
			text += "\n错误：" + message
		}
	}
	return feishuMarkdown(text)
}

func feishuTranscriptText(text string, limit int) string {
	text = strings.TrimSpace(text)
	if len(text) <= limit {
		return text
	}
	// Retain Markdown paragraphs and line breaks; only exceptionally long
	// individual messages are clipped to fit the native card byte budget.
	return strings.TrimSuffix(feishuLimit(text, limit), "\n…（已截断）") + "…"
}

func feishuActionGroupLabel(actions []*feishuActivity) string {
	counts := map[string]int{}
	for _, action := range actions {
		label, _ := feishuActivityIntent(action)
		var input map[string]any
		_ = json.Unmarshal([]byte(action.Text), &input)
		family := "tool"
		switch {
		case action.Type == "commandexecution" || feishuString(input, "cmd", "command") != "" || label == "执行命令" || label == "运行测试" || label == "运行脚本":
			family = "command"
		case action.Type == "filechange" || label == "修改文件":
			family = "file"
		case action.Type == "websearch" || label == "搜索代码" || label == "搜索资料" || label == "读取网页":
			family = "search"
		}
		counts[family]++
	}
	var parts []string
	if counts["command"] > 0 {
		parts = append(parts, fmt.Sprintf("执行了 %d 条命令", counts["command"]))
	}
	if counts["file"] > 0 {
		parts = append(parts, "修改了文件")
	}
	if counts["search"] > 0 {
		parts = append(parts, fmt.Sprintf("搜索了 %d 次", counts["search"]))
	}
	if counts["tool"] > 0 {
		parts = append(parts, fmt.Sprintf("调用了 %d 个工具", counts["tool"]))
	}
	return strings.Join(parts, " · ")
}

// Keep these descriptions aligned with reasoningSummary in app/fusion/page.tsx.
func feishuReasoningDescription(text string) string {
	text = strings.ToLower(strings.Join(strings.Fields(text), " "))
	conclusion := []rune(text)
	if len(conclusion) > 360 {
		conclusion = conclusion[len(conclusion)-360:]
	}
	if feishuFinalResponseSignal.MatchString(string(conclusion)) {
		return "Preparing the final response."
	}
	for _, rule := range []struct {
		words       []string
		description string
	}{
		{[]string{"test", "build", "lint", "typecheck", "verif"}, "Checking build, test, and verification status."},
		{[]string{"relay", "runtime", "event", "stream"}, "Reviewing the Relay execution path and Runtime events."},
		{[]string{"database", "store", "data flow", "migration", "postgres"}, "Tracing the application data flow and persistence layer."},
		{[]string{"ui", "frontend", "page", "component", "css", "layout"}, "Reviewing the relevant interface implementation."},
		{[]string{"project structure", "codebase", "architecture", "key files", "repository"}, "Reviewing the project structure and key files."},
		{[]string{"read", "file", "directory", "folder"}, "Inspecting relevant files and directories."},
	} {
		for _, word := range rule.words {
			if strings.Contains(text, word) {
				return rule.description
			}
		}
	}
	return "Working through the next step."
}

var feishuFinalResponseSignal = regexp.MustCompile(`(?:i (?:already )?have enough (?:info|information|context)|(?:let me|i(?:'ll| will)|ready to) (?:now )?(?:give|provide|write|compose|respond|answer|summarize)|(?:final|concise|complete|detailed) (?:answer|response|reply|summary|introduction)|(?:准备|开始)(?:给出|输出|回复|回答|总结)|最终(?:回答|答复|回复|总结))`)
