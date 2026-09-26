package api

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/KDF5000/relay"
	"github.com/KDF5000/steer/server/internal/store"
)

const maxImportedSkillSize = 1 << 20

func (s *Server) listSkills(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.Skills(r.Context(), s.workspace(r))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) createSkill(w http.ResponseWriter, r *http.Request) {
	var skill store.Skill
	if err := decodeJSON(r, &skill); err != nil {
		writeError(w, err)
		return
	}
	if !validateSkill(w, &skill) {
		return
	}
	skill.SourceKind = "manual"
	created, err := s.store.CreateSkill(r.Context(), s.workspace(r), skill)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (s *Server) importSkill(w http.ResponseWriter, r *http.Request) {
	var input struct {
		URL string `json:"url"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, err)
		return
	}
	sourceURL, fetchURL, err := skillImportURL(input.URL)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	request, err := http.NewRequestWithContext(r.Context(), http.MethodGet, fetchURL, nil)
	if err != nil {
		writeError(w, err)
		return
	}
	client := &http.Client{
		Timeout: 12 * time.Second,
		CheckRedirect: func(next *http.Request, _ []*http.Request) error {
			_, _, validateErr := skillImportURL(next.URL.String())
			return validateErr
		},
	}
	response, err := client.Do(request)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "could not download skill: " + err.Error()})
		return
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": fmt.Sprintf("skill source returned HTTP %d", response.StatusCode)})
		return
	}
	content, err := io.ReadAll(io.LimitReader(response.Body, maxImportedSkillSize+1))
	if err != nil {
		writeError(w, err)
		return
	}
	if len(content) == 0 || len(content) > maxImportedSkillSize {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "skill must be between 1 byte and 1 MB"})
		return
	}
	name, description := parseSkillFrontmatter(string(content))
	if name == "" {
		name = strings.TrimSuffix(path.Base(request.URL.Path), path.Ext(request.URL.Path))
	}
	skill := store.Skill{Name: name, Description: description, Content: string(content), SourceKind: "url", SourceURL: &sourceURL}
	if !validateSkill(w, &skill) {
		return
	}
	created, err := s.store.CreateSkill(r.Context(), s.workspace(r), skill)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (s *Server) updateSkill(w http.ResponseWriter, r *http.Request) {
	var skill store.Skill
	if err := decodeJSON(r, &skill); err != nil {
		writeError(w, err)
		return
	}
	if !validateSkill(w, &skill) {
		return
	}
	current, err := s.store.Skill(r.Context(), s.workspace(r), r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	skill.SourceKind, skill.SourceURL = current.SourceKind, current.SourceURL
	updated, err := s.store.UpdateSkill(r.Context(), s.workspace(r), current.ID, skill)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) deleteSkill(w http.ResponseWriter, r *http.Request) {
	deleted, err := s.store.DeleteSkill(r.Context(), s.workspace(r), r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, deleted)
}

func (s *Server) agentSkills(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.AgentSkills(r.Context(), s.workspace(r), r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) setAgentSkills(w http.ResponseWriter, r *http.Request) {
	var input struct {
		SkillIDs []string `json:"skillIds"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, err)
		return
	}
	seen := map[string]bool{}
	ids := make([]string, 0, len(input.SkillIDs))
	for _, id := range input.SkillIDs {
		id = strings.TrimSpace(id)
		if id != "" && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	if err := s.store.SetAgentSkills(r.Context(), s.workspace(r), r.PathValue("id"), ids); err != nil {
		writeError(w, err)
		return
	}
	items, err := s.store.AgentSkills(r.Context(), s.workspace(r), r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func validateSkill(w http.ResponseWriter, skill *store.Skill) bool {
	skill.Name = strings.TrimSpace(skill.Name)
	skill.Description = strings.TrimSpace(skill.Description)
	skill.Content = strings.TrimSpace(skill.Content)
	if skill.Name == "" || skill.Content == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "skill name and instructions are required"})
		return false
	}
	if len([]rune(skill.Name)) > 80 || len(skill.Content) > maxImportedSkillSize {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "skill name or instructions are too long"})
		return false
	}
	if skill.SourceKind == "" {
		skill.SourceKind = "manual"
	}
	return true
}

func skillImportURL(raw string) (string, string, error) {
	raw = strings.TrimSpace(raw)
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.User != nil {
		return "", "", errors.New("enter a public HTTPS GitHub or GitLab skill URL")
	}
	host := strings.ToLower(parsed.Hostname())
	switch host {
	case "raw.githubusercontent.com", "gist.githubusercontent.com":
		return raw, raw, nil
	case "github.com":
		parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
		if len(parts) < 5 || parts[2] != "blob" {
			return "", "", errors.New("GitHub imports must link to a SKILL.md file")
		}
		fetch := "https://raw.githubusercontent.com/" + strings.Join(append(parts[:2], parts[3:]...), "/")
		return raw, fetch, nil
	case "gitlab.com":
		if !strings.Contains(parsed.Path, "/-/blob/") {
			return "", "", errors.New("GitLab imports must link to a SKILL.md file")
		}
		fetch := *parsed
		fetch.Path = strings.Replace(fetch.Path, "/-/blob/", "/-/raw/", 1)
		return raw, fetch.String(), nil
	default:
		return "", "", errors.New("skill imports currently support GitHub and GitLab")
	}
}

func parseSkillFrontmatter(content string) (string, string) {
	lines := strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
	if len(lines) < 3 || strings.TrimSpace(lines[0]) != "---" {
		return "", ""
	}
	name, description := "", ""
	for _, line := range lines[1:] {
		if strings.TrimSpace(line) == "---" {
			break
		}
		key, value, found := strings.Cut(line, ":")
		if !found {
			continue
		}
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		switch strings.TrimSpace(key) {
		case "name":
			name = value
		case "description":
			description = value
		}
	}
	return name, description
}

func skillInstructionFragments(skills []store.Skill) []relay.InstructionFragment {
	fragments := make([]relay.InstructionFragment, 0, len(skills))
	for _, skill := range skills {
		fragments = append(fragments, relay.InstructionFragment{
			ID:      "steer-skill-" + skill.ID,
			Version: skill.UpdatedAt.UTC().Format(time.RFC3339Nano),
			Title:   "Assigned skill: " + skill.Name,
			Content: "This skill was selected for this Agent. Apply it whenever it is relevant to the user's request.\n\n" + skill.Content,
		})
	}
	return fragments
}

func (s *Server) listDocuments(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.Documents(r.Context(), s.workspace(r))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) createDocument(w http.ResponseWriter, r *http.Request) {
	var document store.Document
	if err := decodeJSON(r, &document); err != nil {
		writeError(w, err)
		return
	}
	if !validateDocument(w, &document) {
		return
	}
	created, err := s.store.CreateDocument(r.Context(), s.workspace(r), document)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (s *Server) updateDocument(w http.ResponseWriter, r *http.Request) {
	var document store.Document
	if err := decodeJSON(r, &document); err != nil {
		writeError(w, err)
		return
	}
	if !validateDocument(w, &document) {
		return
	}
	updated, err := s.store.UpdateDocument(r.Context(), s.workspace(r), r.PathValue("id"), document)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) deleteDocument(w http.ResponseWriter, r *http.Request) {
	deleted, err := s.store.DeleteDocument(r.Context(), s.workspace(r), r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, deleted)
}

func validateDocument(w http.ResponseWriter, document *store.Document) bool {
	document.Title = strings.TrimSpace(document.Title)
	document.URL = strings.TrimSpace(document.URL)
	document.Description = strings.TrimSpace(document.Description)
	parsed, err := url.ParseRequestURI(document.URL)
	if document.Title == "" || err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "document title and a valid HTTP(S) URL are required"})
		return false
	}
	return true
}

func (s *Server) listNotes(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.Notes(r.Context(), s.workspace(r))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) createNote(w http.ResponseWriter, r *http.Request) {
	var note store.Note
	if err := decodeJSON(r, &note); err != nil {
		writeError(w, err)
		return
	}
	if !validateNote(w, &note) {
		return
	}
	created, err := s.store.CreateNote(r.Context(), s.workspace(r), note)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (s *Server) updateNote(w http.ResponseWriter, r *http.Request) {
	var note store.Note
	if err := decodeJSON(r, &note); err != nil {
		writeError(w, err)
		return
	}
	if !validateNote(w, &note) {
		return
	}
	updated, err := s.store.UpdateNote(r.Context(), s.workspace(r), r.PathValue("id"), note)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) deleteNote(w http.ResponseWriter, r *http.Request) {
	deleted, err := s.store.DeleteNote(r.Context(), s.workspace(r), r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, deleted)
}

func parseQueryTime(raw string, fallback time.Time) (time.Time, error) {
	if strings.TrimSpace(raw) == "" {
		return fallback, nil
	}
	return time.Parse(time.RFC3339, raw)
}

func (s *Server) listWorkLog(w http.ResponseWriter, r *http.Request) {
	since, err := parseQueryTime(r.URL.Query().Get("since"), time.Now().AddDate(0, 0, -42))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid since timestamp"})
		return
	}
	entries, err := s.store.WorkLogEntries(r.Context(), s.workspace(r), since, 1000)
	if err != nil {
		writeError(w, err)
		return
	}
	hasEarlier, err := s.store.HasWorkLogEntriesBefore(r.Context(), s.workspace(r), since)
	if err != nil {
		writeError(w, err)
		return
	}
	summaries, err := s.store.WorkLogSummaries(r.Context(), s.workspace(r), since.AddDate(0, 0, -7))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries, "summaries": summaries, "hasEarlier": hasEarlier})
}

func validateWorkLogContent(w http.ResponseWriter, content *string) bool {
	*content = strings.TrimSpace(*content)
	if *content == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "work log content is required"})
		return false
	}
	if len([]rune(*content)) > 12000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "work log content is too long"})
		return false
	}
	return true
}

func (s *Server) createWorkLogEntry(w http.ResponseWriter, r *http.Request) {
	var item store.WorkLogEntry
	if err := decodeJSON(r, &item); err != nil {
		writeError(w, err)
		return
	}
	if !validateWorkLogContent(w, &item.Content) {
		return
	}
	if item.SourceKind != "" && item.SourceKind != "manual" && item.SourceKind != "agent_activity" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid work log source"})
		return
	}
	if item.SourceKind != "agent_activity" {
		item.SourceSessionIDs = nil
	}
	created, err := s.store.CreateWorkLogEntry(r.Context(), s.workspace(r), item)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (s *Server) updateWorkLogEntry(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Content string `json:"content"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, err)
		return
	}
	if !validateWorkLogContent(w, &input.Content) {
		return
	}
	updated, err := s.store.UpdateWorkLogEntry(r.Context(), s.workspace(r), r.PathValue("id"), input.Content)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) deleteWorkLogEntry(w http.ResponseWriter, r *http.Request) {
	deleted, err := s.store.DeleteWorkLogEntry(r.Context(), s.workspace(r), r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, deleted)
}

func (s *Server) workLogActivity(w http.ResponseWriter, r *http.Request) {
	var input struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, err)
		return
	}
	now := time.Now()
	from, err := parseQueryTime(input.From, now.Add(-24*time.Hour))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid from timestamp"})
		return
	}
	to, err := parseQueryTime(input.To, now)
	if err != nil || !to.After(from) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid to timestamp"})
		return
	}
	activities, err := s.store.AgentActivities(r.Context(), s.workspace(r), from, to)
	if err != nil {
		writeError(w, err)
		return
	}
	if len(activities) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"activities": activities})
		return
	}
	if existing, existingErr := s.store.LatestUnacknowledgedSystemRun(r.Context(), s.workspace(r), "work_log_activity", from, to); existingErr == nil {
		writeJSON(w, http.StatusAccepted, map[string]any{"activities": activities, "runId": existing.RelayRunID, "status": existing.Status})
		return
	} else if !errors.Is(existingErr, store.ErrNotFound) {
		writeError(w, existingErr)
		return
	}
	parts := make([]string, 0, len(activities))
	for _, item := range activities {
		messages := make([]string, 0, len(item.Messages))
		for _, message := range item.Messages {
			messages = append(messages, fmt.Sprintf("[%s] %s (%s):\n%s", message.UpdatedAt.Format(time.RFC3339), message.Role, message.Status, message.Content))
		}
		messageScope := fmt.Sprintf("%d messages", item.MessageCount)
		if item.TotalMessageCount > item.MessageCount {
			messageScope = fmt.Sprintf("most recent %d of %d messages", item.MessageCount, item.TotalMessageCount)
		}
		parts = append(parts, fmt.Sprintf("Session: %s\nAgent: %s\nOriginal task: %s\nToday's conversation (%s, chronological):\n%s", item.Title, item.AgentName, item.TaskDescription, messageScope, strings.Join(messages, "\n\n")))
	}
	prompt := "Summarize today's work from the active Agent sessions below into a concise work-log entry for the user. A session may contain several distinct tasks, especially when it is reused over time, so infer today's work from all supplied messages rather than treating the session title as the only task. Use the original task only as context. Focus on outcomes, decisions, code or product changes, and verification results. Merge duplicates and omit tool calls, internal process, greetings, and failed attempts unless a failure is an important unresolved blocker. Do not claim unfinished work is complete. Return only the work-log text, with short bullet points when there are multiple outcomes. Do not modify files or use tools.\n\n" + strings.Join(parts, "\n\n---\n\n")
	run, err := s.submitSystemAgentRun(r.Context(), s.workspace(r), "work_log_activity", prompt)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"activities": activities, "runId": run.ID, "status": run.Status})
}

func (s *Server) workLogActivityRun(w http.ResponseWriter, r *http.Request) {
	now := time.Now()
	from, err := parseQueryTime(r.URL.Query().Get("from"), now.Add(-24*time.Hour))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid from timestamp"})
		return
	}
	to, err := parseQueryTime(r.URL.Query().Get("to"), now)
	if err != nil || !to.After(from) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid to timestamp"})
		return
	}
	run, err := s.store.LatestUnacknowledgedSystemRun(r.Context(), s.workspace(r), "work_log_activity", from, to)
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusOK, map[string]any{"run": nil, "activities": []store.AgentActivity{}})
		return
	}
	if err != nil {
		writeError(w, err)
		return
	}
	activities, err := s.store.AgentActivities(r.Context(), s.workspace(r), from, to)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"run": run, "activities": activities})
}

func (s *Server) dismissWorkLogActivityRun(w http.ResponseWriter, r *http.Request) {
	if err := s.store.AcknowledgeSystemRun(r.Context(), s.workspace(r), r.PathValue("id"), "work_log_activity"); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) generateWeeklySummary(w http.ResponseWriter, r *http.Request) {
	var input struct {
		PeriodStart string `json:"periodStart"`
		From        string `json:"from"`
		To          string `json:"to"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, err)
		return
	}
	_, err := time.Parse("2006-01-02", input.PeriodStart)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid period start"})
		return
	}
	start, err := parseQueryTime(input.From, time.Time{})
	if err != nil || start.IsZero() {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid week start timestamp"})
		return
	}
	end, err := parseQueryTime(input.To, time.Time{})
	if err != nil || !end.After(start) || end.Sub(start) > 8*24*time.Hour {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid week end timestamp"})
		return
	}
	purpose := weeklySummaryPurpose(input.PeriodStart)
	if existing, existingErr := s.store.UnacknowledgedSystemRun(r.Context(), s.workspace(r), purpose); existingErr == nil {
		if existing.Status != "failed" && existing.Status != "cancelled" {
			writeJSON(w, http.StatusAccepted, map[string]any{"runId": existing.RelayRunID, "status": existing.Status})
			return
		}
		if err := s.store.AcknowledgeSystemRun(r.Context(), s.workspace(r), existing.RelayRunID, purpose); err != nil {
			writeError(w, err)
			return
		}
	} else if !errors.Is(existingErr, store.ErrNotFound) {
		writeError(w, existingErr)
		return
	}
	entries, err := s.store.WorkLogEntries(r.Context(), s.workspace(r), start, 1000)
	if err != nil {
		writeError(w, err)
		return
	}
	parts := []string{}
	for _, entry := range entries {
		if entry.OccurredAt.Before(end) {
			parts = append(parts, fmt.Sprintf("%s: %s", entry.OccurredAt.Format("2006-01-02 15:04"), entry.Content))
		}
	}
	if len(parts) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Add a work record before generating a summary."})
		return
	}
	prompt := "Create a concise weekly work summary from the confirmed work-log entries below. Organize it into four localized sections covering: completed work, key progress, issues and risks, and suggestions for next week. Translate the section headings into the requested output language. Do not invent details. Omit empty sections. Return only the summary in Markdown. Do not modify files or use tools.\n\n" + strings.Join(parts, "\n")
	run, err := s.submitSystemAgentRun(r.Context(), s.workspace(r), purpose, prompt)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"runId": run.ID, "status": run.Status})
}

func weeklySummaryPurpose(periodStart string) string {
	return "work_log_weekly_summary:" + periodStart
}

func (s *Server) weeklySummaryRun(w http.ResponseWriter, r *http.Request) {
	periodStart := r.URL.Query().Get("periodStart")
	if _, err := time.Parse("2006-01-02", periodStart); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid period start"})
		return
	}
	run, err := s.store.UnacknowledgedSystemRun(r.Context(), s.workspace(r), weeklySummaryPurpose(periodStart))
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusOK, map[string]any{"run": nil})
		return
	}
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"run": run})
}

func (s *Server) saveWorkLogSummary(w http.ResponseWriter, r *http.Request) {
	var input struct {
		PeriodKind  string `json:"periodKind"`
		PeriodStart string `json:"periodStart"`
		Content     string `json:"content"`
		RunID       string `json:"runId"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, err)
		return
	}
	if input.PeriodKind != "week" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "period kind must be week"})
		return
	}
	if _, err := time.Parse("2006-01-02", input.PeriodStart); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid period start"})
		return
	}
	if !validateWorkLogContent(w, &input.Content) {
		return
	}
	item, err := s.store.UpsertWorkLogSummary(r.Context(), s.workspace(r), input.PeriodKind, input.PeriodStart, input.Content)
	if err != nil {
		writeError(w, err)
		return
	}
	if input.RunID != "" {
		if err := s.store.AcknowledgeSystemRun(r.Context(), s.workspace(r), input.RunID, weeklySummaryPurpose(input.PeriodStart)); err != nil {
			writeError(w, err)
			return
		}
	}
	writeJSON(w, http.StatusOK, item)
}

func validateNote(w http.ResponseWriter, note *store.Note) bool {
	note.Title = strings.TrimSpace(note.Title)
	note.Content = strings.TrimSpace(note.Content)
	if note.Title == "" && note.Content == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "note title or content is required"})
		return false
	}
	seen := map[string]bool{}
	tags := make([]string, 0, len(note.Tags))
	for _, tag := range note.Tags {
		tag = strings.TrimSpace(strings.TrimPrefix(tag, "#"))
		if tag != "" && !seen[tag] && len([]rune(tag)) <= 32 {
			seen[tag] = true
			tags = append(tags, tag)
		}
	}
	sort.Strings(tags)
	note.Tags = tags
	return true
}
