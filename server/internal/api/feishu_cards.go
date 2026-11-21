package api

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/KDF5000/relay"
	"github.com/KDF5000/relay/controlplane"
	"github.com/KDF5000/steer/server/internal/store"
)

type feishuElement = map[string]any

func feishuText(text string) feishuElement {
	return feishuElement{"tag": "plain_text", "content": text}
}
func feishuMarkdown(text string) feishuElement {
	return feishuElement{"tag": "markdown", "content": text}
}
func feishuEncodeCard(title string, elements []feishuElement) string {
	card := feishuElement{"schema": "2.0", "config": feishuElement{"update_multi": true, "enable_forward_interaction": false}, "body": feishuElement{"elements": elements, "vertical_spacing": "8px"}}
	if title != "" {
		card["header"] = feishuElement{"title": feishuText(title), "template": "default"}
	}
	encoded, _ := json.Marshal(card)
	return string(encoded)
}

func feishuCallback(action, token string) []feishuElement {
	return []feishuElement{{"type": "callback", "value": feishuElement{"action": action, "card_id": token}}}
}

func feishuButton(label, action, token string) feishuElement {
	return feishuElement{"tag": "button", "text": feishuText(label), "type": "default", "size": "small", "behaviors": feishuCallback(action, token)}
}

func feishuOption(label, id string) feishuElement {
	return feishuElement{"text": feishuText(label), "value": id}
}

const feishuDefaultOption = "__default__"

func feishuSelect(name, placeholder, selected string, options []feishuElement) feishuElement {
	selectElement := feishuElement{"tag": "select_static", "name": name, "placeholder": feishuText(placeholder), "options": options, "width": "fill"}
	if selected != "" {
		selectElement["initial_option"] = selected
	}
	return selectElement
}

func feishuFormSelect(name, placeholder, selected string, options []feishuElement) feishuElement {
	selectElement := feishuSelect(name, placeholder, selected, options)
	selectElement["required"] = true
	return selectElement
}

func feishuModelOptions(runtime controlplane.Runtime) []controlplane.RuntimeModel {
	models := append([]controlplane.RuntimeModel(nil), runtime.ModelCatalog...)
	seen := map[string]bool{}
	for _, model := range models {
		seen[model.ID] = true
	}
	for _, id := range append([]string{runtime.DefaultModel}, runtime.Models...) {
		if id != "" && !seen[id] {
			models = append(models, controlplane.RuntimeModel{ID: id})
			seen[id] = true
		}
	}
	return models
}

func feishuModelCard(token string, runtime controlplane.Runtime, agent store.Agent, model, effort string, confirm bool) string {
	models := []feishuElement{feishuOption("跟随 Agent 默认模型", feishuDefaultOption)}
	for _, option := range feishuModelOptions(runtime) {
		label := option.ID
		if option.DisplayName != "" && option.DisplayName != option.ID {
			label = option.DisplayName + " · " + option.ID
		}
		models = append(models, feishuOption(label, option.ID))
	}
	selected := model
	if selected == "" {
		selected = feishuDefaultOption
	}
	if !confirm {
		menu := feishuSelect("model", "选择模型", selected, models)
		menu["behaviors"] = feishuCallback("choose_model", token)
		return feishuEncodeCard("选择模型", []feishuElement{feishuMarkdown("选择模型后设置 effort。更改仅作用于当前话题，保留原 session。"), menu})
	}
	effective := model
	if effective == "" {
		effective = value(agent.Model)
	}
	if effective == "" {
		effective = runtime.DefaultModel
	}
	efforts := []feishuElement{feishuOption("模型默认 effort", feishuDefaultOption)}
	for _, option := range runtime.ModelCatalog {
		if option.ID != effective || !runtime.SupportsReasoningEffort {
			continue
		}
		for _, choice := range option.SupportedReasoningEfforts {
			efforts = append(efforts, feishuOption(choice.Effort, choice.Effort))
		}
	}
	selectedEffort := feishuDefaultOption
	for _, option := range efforts {
		if option["value"] == effort {
			selectedEffort = effort
		}
	}
	modelLabel := effective
	if modelLabel == "" {
		modelLabel = "Runtime 默认"
	}
	if model == "" {
		modelLabel = "Agent 默认 · " + modelLabel
	}
	// Include the displayed model in the submitted form. Never infer it from
	// mutable server draft state when multiple people interact with this card.
	modelField := feishuFormSelect("model", "模型", selected, []feishuElement{feishuOption(modelLabel, selected)})
	submit := feishuElement{"tag": "button", "name": "apply_model:" + token, "text": feishuText("应用模型和 effort"), "type": "primary_filled", "width": "fill", "form_action_type": "submit"}
	form := feishuElement{"tag": "form", "name": "model_settings", "elements": []feishuElement{modelField, feishuFormSelect("effort", "选择 effort", selectedEffort, efforts), submit}}
	return feishuEncodeCard("选择模型和 effort", []feishuElement{form, feishuButton("重新选择模型", "model_back", token)})
}

func feishuProjectCard(token string, projects []store.Project, selected *string) string {
	options := []feishuElement{feishuOption("解除聊天绑定，使用集成默认项目", feishuDefaultOption)}
	initial := feishuDefaultOption
	for _, project := range projects {
		if project.DeletedAt != nil {
			continue
		}
		options = append(options, feishuOption(project.Name, project.ID))
		if value(selected) == project.ID {
			initial = project.ID
		}
	}
	form := feishuElement{"tag": "form", "name": "project_settings", "elements": []feishuElement{
		feishuFormSelect("project", "选择项目", initial, options),
		{"tag": "button", "name": "apply_project:" + token, "text": feishuText("切换项目"), "type": "primary_filled", "width": "fill", "form_action_type": "submit"},
	}}
	return feishuEncodeCard("选择项目", []feishuElement{feishuMarkdown("切换后，当前话题开启新 session，后续新话题也会使用该项目。其他已开始的话题继续使用原项目。"), form})
}

type feishuActivity struct {
	ID, Type, Title, Text, Output, Status string
	Tool                                  bool
}
type feishuProcess struct {
	Items     []*feishuActivity
	ToolCount int
	Activity  string
}

func feishuString(data map[string]any, keys ...string) string {
	for _, key := range keys {
		if s, ok := data[key].(string); ok && s != "" {
			return s
		}
	}
	return ""
}
func feishuRecord(v any) map[string]any { data, _ := v.(map[string]any); return data }
func feishuValueText(v any) string {
	if v == nil {
		return ""
	}
	if text, ok := v.(string); ok {
		return text
	}
	if list, ok := v.([]any); ok {
		var parts []string
		for _, value := range list {
			if text := feishuValueText(value); text != "" {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, "\n")
	}
	if data := feishuRecord(v); data != nil {
		if text := feishuString(data, "text", "thinking"); text != "" {
			return text
		}
	}
	encoded, _ := json.Marshal(v)
	return string(encoded)
}

func feishuRuntimeProcess(events []relay.Event) feishuProcess {
	process := feishuProcess{Activity: "执行中"}
	byID := map[string]*feishuActivity{}
	get := func(id, kind string) *feishuActivity {
		if item := byID[id]; item != nil {
			return item
		}
		item := &feishuActivity{ID: id, Type: kind, Status: "running"}
		byID[id] = item
		process.Items = append(process.Items, item)
		return item
	}
	for _, event := range events {
		var data map[string]any
		if json.Unmarshal(event.Data, &data) != nil {
			continue
		}
		eventType := strings.ToLower(event.Type)
		provider := strings.Split(eventType, ".")
		prefix := ""
		if len(provider) > 1 {
			prefix = provider[1] + ":"
		}
		item := feishuRecord(data["item"])
		itemID := feishuString(item, "id")
		if itemID == "" {
			itemID = feishuString(data, "itemId", "item_id", "toolCallId")
		}
		if itemID == "" {
			itemID = fmt.Sprint(event.Sequence)
		}
		id := prefix + itemID
		kind := strings.NewReplacer("_", "", "-", "").Replace(strings.ToLower(feishuString(item, "type")))
		if strings.HasSuffix(eventType, ".item.started") || strings.HasSuffix(eventType, ".item.completed") {
			if kind == "agentmessage" && (feishuString(item, "phase") != "commentary") {
				if phase := feishuString(item, "phase"); phase == "final" || phase == "final_answer" {
					process.Activity = "生成回复"
				}
				continue
			}
			tool := kind == "commandexecution" || kind == "filechange" || kind == "websearch" || kind == "mcptoolcall" || kind == "toolcall" || kind == "dynamictoolcall"
			if !tool && kind != "reasoning" && kind != "agentmessage" {
				continue
			}
			activity := get(id, kind)
			activity.Tool = tool
			if title := feishuString(item, "command", "name", "tool", "query", "path"); title != "" {
				activity.Title = title
			}
			if activity.Title == "" {
				activity.Title = map[string]string{"reasoning": "思考过程", "agentmessage": "执行说明", "filechange": "修改文件", "mcptoolcall": "工具调用"}[kind]
			}
			if activity.Title == "" {
				activity.Title = "工具调用"
			}
			if text := feishuString(item, "text"); text != "" {
				activity.Text = text
			}
			if tool {
				for _, key := range []string{"arguments", "input", "query", "changes"} {
					if text := feishuValueText(item[key]); text != "" {
						activity.Text = text
						break
					}
				}
			}
			if kind == "reasoning" && activity.Text == "" {
				activity.Text = feishuValueText(item["summary"])
				if activity.Text == "" {
					activity.Text = feishuValueText(item["content"])
				}
			}
			for _, key := range []string{"aggregatedOutput", "output", "result", "content", "changes", "error"} {
				if output := feishuValueText(item[key]); output != "" {
					activity.Output = output
					break
				}
			}
			if status := feishuString(item, "status"); status != "" {
				activity.Status = status
			}
			if strings.HasSuffix(eventType, ".completed") && activity.Status == "running" {
				activity.Status = "completed"
			}
			if kind == "reasoning" || kind == "agentmessage" {
				activity.Output = ""
			}
			if code, ok := item["exitCode"].(float64); ok && code != 0 {
				activity.Status = "failed"
			}
			process.Activity = feishuActivityLabel(activity)
			continue
		}
		if strings.Contains(eventType, ".item.") && (strings.HasSuffix(eventType, ".delta") || strings.HasSuffix(eventType, "textdelta") || strings.HasSuffix(eventType, "outputdelta")) {
			activity := byID[id]
			if activity == nil && strings.Contains(eventType, ".reasoning.") {
				activity = get(id, "reasoning")
				activity.Title = "思考过程"
			}
			if activity == nil {
				continue
			}
			delta := feishuString(data, "delta", "text")
			if strings.Contains(eventType, "output") {
				activity.Output += delta
			} else {
				activity.Text += delta
			}
			process.Activity = feishuActivityLabel(activity)
			continue
		}
		// Claude-style stream JSON used by Qoder/QwenWork (and Claude): retain
		// actual tool uses/results and exposed thinking blocks, not proposed edits.
		if strings.HasSuffix(eventType, ".assistant") || strings.HasSuffix(eventType, ".user") {
			message := feishuRecord(data["message"])
			blocks, _ := message["content"].([]any)
			for index, raw := range blocks {
				block := feishuRecord(raw)
				blockID := feishuString(block, "id", "tool_use_id")
				if blockID == "" {
					blockID = fmt.Sprintf("%d:%d", event.Sequence, index)
				}
				blockID = prefix + feishuString(data, "session_id") + ":" + blockID
				switch feishuString(block, "type") {
				case "tool_use":
					activity := get(blockID, "toolcall")
					activity.Tool = true
					activity.Title = feishuString(block, "name")
					activity.Text = feishuValueText(block["input"])
					process.Activity = "调用工具"
				case "tool_result":
					if activity := byID[blockID]; activity != nil {
						activity.Output = feishuValueText(block["content"])
						activity.Status = "completed"
						if block["is_error"] == true {
							activity.Status = "failed"
						}
						process.Activity = feishuActivityLabel(activity)
					}
				case "thinking":
					activity := get(blockID, "reasoning")
					activity.Title = "思考过程"
					activity.Text = feishuString(block, "thinking", "text")
					process.Activity = "思考中"
				}
			}
		}
		if eventType == "runtime.opencode.tool_use" {
			part := feishuRecord(data["part"])
			state := feishuRecord(part["state"])
			key := feishuString(part, "callID", "id")
			if key == "" {
				key = fmt.Sprint(event.Sequence)
			}
			activity := get(prefix+key, "toolcall")
			activity.Tool = true
			activity.Title = feishuString(part, "tool")
			activity.Text = feishuValueText(state["input"])
			activity.Output = feishuValueText(state["output"])
			activity.Status = feishuString(state, "status")
			if activity.Status == "error" {
				activity.Status = "failed"
				activity.Output = feishuValueText(state["error"])
			}
			process.Activity = feishuActivityLabel(activity)
		}
		if strings.HasPrefix(eventType, "runtime.pi.tool_execution_") {
			activity := get(prefix+feishuString(data, "toolCallId"), "toolcall")
			activity.Tool = true
			if title := feishuString(data, "toolName"); title != "" {
				activity.Title = title
			}
			if text := feishuValueText(data["args"]); text != "" {
				activity.Text = text
			}
			if output := feishuValueText(data["partialResult"]); output != "" {
				activity.Output = output
			}
			if strings.HasSuffix(eventType, "_end") {
				activity.Status = "completed"
				activity.Output = feishuValueText(data["result"])
				if data["isError"] == true {
					activity.Status = "failed"
				}
			}
			process.Activity = feishuActivityLabel(activity)
		}
		if eventType == "runtime.pi.message_update" {
			update := feishuRecord(data["assistantMessageEvent"])
			if feishuString(update, "type") == "thinking_delta" {
				activity := get(prefix+"thinking:"+fmt.Sprint(update["contentIndex"]), "reasoning")
				activity.Title = "思考过程"
				activity.Text += feishuString(update, "delta")
				process.Activity = "思考中"
			}
		}
		if eventType == "workspace.preparing" {
			process.Activity = "准备工作区"
		}
		if eventType == "attempt.queued" {
			process.Activity = "等待 Runtime"
		}
		if eventType == "workspace.prepared" {
			process.Activity = "启动 Runtime"
		}
		if eventType == "attempt.started" || strings.HasSuffix(eventType, ".turn.started") {
			process.Activity = "思考中"
		}
	}
	for _, item := range process.Items {
		if item.Tool {
			process.ToolCount++
		}
	}
	return process
}

// Keep the collapsed heading bounded and independent of commands, paths,
// tool arguments and generated prose. Those remain in the expanded details.
func feishuActivityLabel(activity *feishuActivity) string {
	if activity.Tool {
		if activity.Status == "failed" {
			return "工具调用失败"
		}
		if activity.Status == "completed" || activity.Status == "succeeded" {
			return "思考中"
		}
		switch activity.Type {
		case "filechange":
			return "修改文件"
		case "websearch":
			return "搜索信息"
		default:
			return "调用工具"
		}
	}
	if activity.Type == "reasoning" {
		return "思考中"
	}
	return "处理任务"
}

func feishuLimit(text string, limit int) string {
	if len(text) <= limit {
		return text
	}
	text = text[:limit]
	for !utf8.ValidString(text) {
		text = text[:len(text)-1]
	}
	return text + "\n…（已截断）"
}

func feishuExecutionCard(status string, events []relay.Event, answer, token string) string {
	process := feishuRuntimeProcess(events)
	title := feishuLimit(strings.Join(strings.Fields(process.Activity), " "), 160)
	if status == "queued" || status == "pending" {
		title = "等待 Runtime"
	}
	if terminal(relay.RunStatus(status)) {
		title = "任务" + feishuStatusText(status)
	}
	panel := feishuElement{"tag": "collapsible_panel", "element_id": "execution_process", "expanded": false, "header": feishuElement{"title": feishuText(title), "width": "auto_when_fold", "icon": feishuElement{"tag": "standard_icon", "token": "right-small-ccm_outlined", "size": "16px 16px"}, "icon_position": "follow_text", "icon_expanded_angle": 90}, "elements": feishuProcessTranscript(process)}
	elements := []feishuElement{panel}
	if !terminal(relay.RunStatus(status)) && token != "" {
		cancel := feishuButton("", "cancel_task", token)
		delete(cancel, "text")
		cancel["type"] = "text"
		cancel["icon"] = feishuElement{"tag": "standard_icon", "token": "stop_outlined"}
		cancel["hover_tips"] = feishuText("停止这一次任务，保留会话记录")
		// Public collapsible panels have no hover button area. Use documented
		// columns for an adjacent icon instead of a separate full-width action.
		elements = []feishuElement{{"tag": "column_set", "flex_mode": "none", "horizontal_spacing": "4px", "horizontal_align": "left", "columns": []feishuElement{
			{"tag": "column", "width": "auto", "vertical_align": "top", "elements": []feishuElement{panel}},
			{"tag": "column", "width": "auto", "vertical_align": "top", "elements": []feishuElement{cancel}},
		}}}
	}
	if answer != "" {
		response := feishuMarkdown(feishuLimit(answer, 12<<10))
		response["element_id"] = "final_answer"
		elements = append(elements, response)
	}
	return feishuEncodeCard("", elements)
}
