package api

import (
	"encoding/json"
	"path"
	"strings"
)

// Feishu is an activity feed: describe the action, not the file contents,
// requested patch, grep results, or full command log.
func feishuActivityIntent(activity *feishuActivity) (label, detail string) {
	var input map[string]any
	_ = json.Unmarshal([]byte(activity.Text), &input)
	name := strings.ToLower(activity.Title)
	for _, separator := range []string{"/", ".", ":"} {
		if index := strings.LastIndex(name, separator); index >= 0 {
			name = name[index+1:]
		}
	}
	file := feishuString(input, "file_path", "filePath", "path", "target_file")
	query := feishuString(input, "pattern", "query", "search_term", "searchTerm")
	command := feishuString(input, "cmd", "command")
	if command == "" && activity.Type == "commandexecution" {
		command = activity.Title
	}
	if command != "" {
		label, detail = feishuCommandIntent(command)
		if description := feishuString(input, "description"); description != "" {
			detail = description
		}
		return label, detail
	}
	if activity.Type == "filechange" {
		if file == "" {
			var changes []map[string]any
			if json.Unmarshal([]byte(activity.Text), &changes) == nil {
				var files []string
				for _, change := range changes {
					if p := feishuString(change, "path"); p != "" {
						files = append(files, p)
					}
				}
				file = strings.Join(files, "、")
			}
		}
		if file == "" && activity.Title != "修改文件" {
			file = activity.Title
		}
		return "修改文件", file
	}
	switch name {
	case "grep", "rg", "search", "glob":
		if file != "" && query != "" {
			query += " · " + file
		} else if query == "" {
			query = file
		}
		return "搜索代码", query
	case "read", "readfile", "read_file":
		return "读取文件", file
	case "write", "edit", "multiedit", "write_file", "edit_file", "apply_patch":
		return "修改文件", file
	case "websearch", "web_search":
		return "搜索资料", query
	case "webfetch", "web_fetch":
		return "读取网页", feishuString(input, "url")
	}
	if activity.Type == "websearch" {
		if query == "" {
			query = activity.Text
		}
		if query == "" {
			query = activity.Title
		}
		return "搜索资料", query
	}
	// Unknown tools still identify themselves and any meaningful target. Do not
	// serialize arbitrary arguments: they may contain entire files or patches.
	detail = activity.Title
	if target := feishuString(input, "description", "path", "file_path", "query", "pattern", "url"); target != "" {
		detail += " · " + target
	}
	return "调用工具", detail
}

func feishuCommandIntent(command string) (label, detail string) {
	// A multi-command script may include a heredoc body. Only show the command
	// line itself; never treat its source code as an activity description.
	line := ""
	for _, candidate := range strings.Split(command, "\n") {
		if strings.TrimSpace(candidate) != "" {
			line = strings.TrimSpace(candidate)
			break
		}
	}
	words := strings.Fields(line)
	for len(words) > 0 && strings.Contains(words[0], "=") {
		words = words[1:]
	}
	if len(words) == 0 {
		return "执行命令", ""
	}
	program := path.Base(words[0])
	label = "执行命令"
	switch program {
	case "rg", "grep":
		label = "搜索代码"
	case "cat", "head", "tail", "sed":
		label = "读取文件"
	case "ls", "find", "pwd":
		label = "查看目录"
	case "curl", "wget":
		label = "请求网页"
	case "python", "python3", "node":
		label = "运行脚本"
	case "git":
		label = "执行 Git 命令"
	case "go", "cargo", "npm", "pnpm", "yarn", "bun", "pytest", "jest", "vitest", "make":
		for _, word := range words {
			if word == "test" || word == "pytest" || word == "jest" || word == "vitest" {
				label = "运行测试"
				break
			}
		}
	}
	if index := strings.Index(line, "<<"); index >= 0 {
		line = strings.TrimSpace(line[:index])
	}
	return label, line
}

func feishuActivityExcerpt(text string, maxRunes int) string {
	text = strings.Join(strings.Fields(text), " ")
	runes := []rune(text)
	if len(runes) <= maxRunes {
		return text
	}
	return string(runes[:maxRunes]) + "…"
}

func feishuErrorExcerpt(output string) string {
	// Favor an actual error line over a verbose log preamble. If the Runtime
	// supplies no recognizable error line, retain its first nonempty line.
	first := ""
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if first == "" {
			first = line
		}
		lower := strings.ToLower(line)
		for _, marker := range []string{"error", "failed", "fatal", "exception", "panic", "错误", "失败"} {
			if strings.Contains(lower, marker) {
				return feishuActivityExcerpt(line, 120)
			}
		}
	}
	return feishuActivityExcerpt(first, 120)
}

func feishuActivitySummary(activity *feishuActivity) string {
	if !activity.Tool {
		label := "进展"
		if activity.Type == "reasoning" {
			label = "思考"
		}
		if text := feishuActivityExcerpt(activity.Text, 120); text != "" {
			return "- **" + label + "**：" + text
		}
		return ""
	}
	label, detail := feishuActivityIntent(activity)
	line := "- **" + label + "**"
	if detail = feishuActivityExcerpt(detail, 120); detail != "" {
		line += " · `" + strings.ReplaceAll(detail, "`", "'") + "`"
	}
	switch activity.Status {
	case "completed", "succeeded":
		line += " · 完成"
	case "failed":
		line += " · 失败"
		if errorText := feishuErrorExcerpt(activity.Output); errorText != "" {
			line += "\n  错误：" + errorText
		}
	default:
		line += " · 执行中"
	}
	return line
}
