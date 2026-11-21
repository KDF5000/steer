package api

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/KDF5000/steer/server/internal/store"
)

// AgentBuddy (skills.bytedance.net) publishes Skills as versioned packages.
// Steer resolves a package to its newest version, downloads the asset zip, and
// imports the SKILL.md inside it, so users can paste a Skill link or search by
// name instead of copying files around.
const (
	agentBuddyAPIBase      = "https://skills.byted.org"
	agentBuddyMaxZip       = 8 << 20
	agentBuddyMaxSearch    = 20
	agentBuddyDownloadPath = "/api/v1/download/"
)

var agentBuddyHTTP = &http.Client{
	Timeout: 25 * time.Second,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 {
			return errors.New("too many redirects")
		}
		if req.URL.Scheme != "https" || req.URL.User != nil {
			return errors.New("redirected to an unsupported address")
		}
		return nil
	},
}

type agentBuddyPackage struct {
	Identifier    string `json:"identifier"`
	Repository    string `json:"repository"`
	Namespace     string `json:"namespace"`
	Name          string `json:"name"`
	Description   string `json:"description"`
	NewestVersion struct {
		Version string `json:"version"`
	} `json:"newest_version"`
}

type agentBuddySearchResponse struct {
	Data []agentBuddyPackage `json:"data"`
}

type agentBuddyPackageResponse struct {
	Data agentBuddyPackage `json:"data"`
}

type agentBuddyVersionsResponse struct {
	Data []struct {
		Identifier string   `json:"identifier"`
		Version    string   `json:"version"`
		Repository string   `json:"repository"`
		Tags       []string `json:"tags"`
	} `json:"data"`
}

type agentBuddyComponentResponse struct {
	Data struct {
		Assets []struct {
			DownloadLink string `json:"download_link"`
			ContentType  string `json:"content_type"`
		} `json:"assets"`
	} `json:"data"`
}

// isAgentBuddyInput reports whether the import value is an AgentBuddy link or
// package identifier such as "skills:github.com/org/skills/review".
func isAgentBuddyInput(raw string) bool {
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(raw, "skills:") {
		return true
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return false
	}
	switch strings.ToLower(parsed.Hostname()) {
	case "skills.bytedance.net", "skills.byted.org":
		return true
	}
	return false
}

// agentBuddyIdentifier extracts a package identifier from a Skill link. An
// empty identifier means the caller should search using the last path segment.
func agentBuddyIdentifier(raw string) string {
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(raw, "skills:") {
		return raw
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	if value := strings.TrimSpace(parsed.Query().Get("identifier")); strings.HasPrefix(value, "skills:") {
		return value
	}
	decoded, err := url.PathUnescape(parsed.Path)
	if err != nil {
		decoded = parsed.Path
	}
	if index := strings.Index(decoded, "skills:"); index >= 0 {
		return strings.Trim(decoded[index:], "/")
	}
	return ""
}

func agentBuddySearch(ctx context.Context, query string) ([]agentBuddyPackage, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, invalidCodebase("Enter a Skill name to search AgentBuddy.")
	}
	var result agentBuddySearchResponse
	endpoint := agentBuddyAPIBase + "/api/v2/package/search/skills/" + url.PathEscape(query)
	if err := agentBuddyGet(ctx, endpoint, &result); err != nil {
		return nil, err
	}
	if len(result.Data) > agentBuddyMaxSearch {
		result.Data = result.Data[:agentBuddyMaxSearch]
	}
	return result.Data, nil
}

// importAgentBuddySkill downloads the newest version of a package and returns a
// workspace Skill. sourceURL is the value the user pasted, kept for provenance.
func importAgentBuddySkill(ctx context.Context, raw, sourceURL string) (store.Skill, error) {
	identifier := agentBuddyIdentifier(raw)
	if identifier == "" {
		parsed, err := url.Parse(strings.TrimSpace(raw))
		if err != nil {
			return store.Skill{}, invalidCodebase("Enter a valid AgentBuddy Skill link.")
		}
		segment := path.Base(strings.TrimRight(parsed.Path, "/"))
		matches, err := agentBuddySearch(ctx, segment)
		if err != nil {
			return store.Skill{}, err
		}
		for _, item := range matches {
			if strings.EqualFold(item.Name, segment) {
				identifier = item.Identifier
				break
			}
		}
		if identifier == "" && len(matches) > 0 {
			identifier = matches[0].Identifier
		}
		if identifier == "" {
			return store.Skill{}, invalidCodebase("No AgentBuddy Skill matched that link.")
		}
	}
	var pkg agentBuddyPackageResponse
	if err := agentBuddyGet(ctx, agentBuddyAPIBase+"/api/v2/package/"+url.PathEscape(identifier), &pkg); err != nil {
		return store.Skill{}, err
	}
	if pkg.Data.Identifier == "" {
		return store.Skill{}, upstreamCodebase("agentbuddy_incompatible", "AgentBuddy did not return a valid Skill package.")
	}
	repository := pkg.Data.Repository
	versionIdentifier := ""
	var versions agentBuddyVersionsResponse
	versionsURL := agentBuddyAPIBase + "/api/v2/package/versions/" + url.PathEscape(identifier)
	if repository != "" {
		versionsURL += "?repository=" + url.QueryEscape(repository)
	}
	if err := agentBuddyGet(ctx, versionsURL, &versions); err != nil {
		return store.Skill{}, err
	}
	for _, version := range versions.Data {
		for _, tag := range version.Tags {
			if tag == "newest" {
				versionIdentifier = version.Identifier
				break
			}
		}
		if versionIdentifier != "" {
			break
		}
	}
	if versionIdentifier == "" && len(versions.Data) > 0 {
		versionIdentifier = versions.Data[0].Identifier
	}
	if versionIdentifier == "" {
		return store.Skill{}, invalidCodebase("AgentBuddy Skill has no published version.")
	}
	var component agentBuddyComponentResponse
	componentURL := agentBuddyAPIBase + "/api/v2/component/" + url.PathEscape(versionIdentifier) + "?with_asset=true"
	if repository != "" {
		componentURL += "&repository=" + url.QueryEscape(repository)
	}
	if err := agentBuddyGet(ctx, componentURL, &component); err != nil {
		return store.Skill{}, err
	}
	downloadLink := ""
	for _, asset := range component.Data.Assets {
		if strings.Contains(asset.ContentType, "zip") && asset.DownloadLink != "" {
			downloadLink = asset.DownloadLink
			break
		}
	}
	if downloadLink == "" && len(component.Data.Assets) > 0 {
		downloadLink = component.Data.Assets[0].DownloadLink
	}
	if downloadLink == "" {
		return store.Skill{}, invalidCodebase("AgentBuddy Skill has no downloadable asset.")
	}
	files, err := agentBuddyDownloadSkillFiles(ctx, downloadLink)
	if err != nil {
		return store.Skill{}, err
	}
	content := skillContentFromFiles(files, "")
	name, description := parseSkillFrontmatter(content)
	if name == "" {
		name = pkg.Data.Name
	}
	if description == "" {
		description = pkg.Data.Description
	}
	if name == "" {
		name = identifier
	}
	source := strings.TrimSpace(sourceURL)
	if source == "" {
		source = "https://skills.bytedance.net/skills/" + identifier
	}
	return store.Skill{
		Name:        name,
		Description: description,
		Content:     content,
		Files:       files,
		SourceKind:  "agentbuddy",
		SourceURL:   &source,
	}, nil
}

func agentBuddyGet(ctx context.Context, endpoint string, result any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return invalidCodebase("Invalid AgentBuddy request.")
	}
	request.Header.Set("Accept", "application/json")
	response, err := agentBuddyHTTP.Do(request)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return upstreamCodebase("agentbuddy_unavailable", "Could not reach AgentBuddy. Check the network connection.")
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return upstreamCodebase("agentbuddy_read_failed", "Could not read the AgentBuddy response.")
	}
	if response.StatusCode == http.StatusNotFound {
		return invalidCodebase("AgentBuddy Skill was not found.")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return upstreamCodebase("agentbuddy_upstream_error", fmt.Sprintf("AgentBuddy returned HTTP %d.", response.StatusCode))
	}
	if err = json.Unmarshal(data, result); err != nil {
		return upstreamCodebase("agentbuddy_incompatible", "AgentBuddy did not return a compatible JSON response.")
	}
	return nil
}

// agentBuddyDownloadSkillFiles downloads a package and returns every regular
// file in it, so Steer can keep the whole Skill (scripts, references, assets)
// instead of only SKILL.md. A single wrapping directory is stripped so paths
// stay stable regardless of how the package was zipped.
func agentBuddyDownloadSkillFiles(ctx context.Context, link string) ([]store.SkillFile, error) {
	parsed, err := url.Parse(link)
	if err != nil || parsed.Scheme != "https" || parsed.User != nil || parsed.Hostname() == "" {
		return nil, invalidCodebase("AgentBuddy returned an unsupported download link.")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, invalidCodebase("Invalid AgentBuddy download link.")
	}
	response, err := agentBuddyHTTP.Do(request)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, upstreamCodebase("agentbuddy_unavailable", "Could not download the AgentBuddy Skill.")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, upstreamCodebase("agentbuddy_upstream_error", fmt.Sprintf("AgentBuddy download returned HTTP %d.", response.StatusCode))
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, agentBuddyMaxZip+1))
	if err != nil || len(data) > agentBuddyMaxZip {
		return nil, upstreamCodebase("agentbuddy_package_large", "AgentBuddy Skill package is too large.")
	}
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, upstreamCodebase("agentbuddy_incompatible", "AgentBuddy Skill package is not a valid zip archive.")
	}
	entries := make([]agentBuddyEntry, 0, len(reader.File))
	for _, file := range reader.File {
		name := strings.Trim(strings.TrimPrefix(strings.ReplaceAll(file.Name, "\\", "/"), "./"), "/")
		if name == "" || file.FileInfo().IsDir() || file.Mode()&fs.ModeSymlink != 0 {
			continue
		}
		if strings.HasPrefix(name, "__MACOSX/") || path.Base(name) == ".DS_Store" {
			continue
		}
		entries = append(entries, agentBuddyEntry{name: name, file: file})
	}
	if len(entries) == 0 {
		return nil, invalidCodebase("AgentBuddy Skill package is empty.")
	}
	if prefix := agentBuddyCommonRoot(entries); prefix != "" {
		for i := range entries {
			entries[i].name = strings.TrimPrefix(entries[i].name, prefix)
		}
	}
	entries, ok := agentBuddyStripEntrypointDir(entries)
	if !ok {
		return nil, invalidCodebase("AgentBuddy Skill package does not contain a SKILL.md.")
	}
	if len(entries) > maxSkillFiles {
		return nil, invalidCodebase(fmt.Sprintf("AgentBuddy Skill contains more than %d files.", maxSkillFiles))
	}
	files := make([]store.SkillFile, 0, len(entries))
	total := 0
	for _, entry := range entries {
		content, readErr := readAgentBuddyEntry(entry)
		if readErr != nil {
			return nil, readErr
		}
		total += len(content)
		if total > maxSkillTotalSize {
			return nil, invalidCodebase("AgentBuddy Skill files exceed the 8 MB limit.")
		}
		file := store.SkillFile{Path: entry.name, Size: len(content)}
		if isTextContent(content) {
			file.Encoding, file.Content = "text", string(content)
		} else {
			file.Encoding, file.Content = "base64", base64.StdEncoding.EncodeToString(content)
		}
		files = append(files, file)
	}
	sortSkillFiles(files)
	return files, nil
}

type agentBuddyEntry struct {
	name string
	file *zip.File
}

// agentBuddyCommonRoot returns the shared top-level directory, when every file
// lives under the same one.
func agentBuddyCommonRoot(entries []agentBuddyEntry) string {
	root := ""
	for _, entry := range entries {
		index := strings.Index(entry.name, "/")
		if index <= 0 {
			return ""
		}
		segment := entry.name[:index]
		if root == "" {
			root = segment
		} else if root != segment {
			return ""
		}
	}
	return root + "/"
}

// agentBuddyStripEntrypointDir falls back to the shallowest SKILL.md when the
// package nests it under a directory that is not a common root.
func agentBuddyStripEntrypointDir(entries []agentBuddyEntry) ([]agentBuddyEntry, bool) {
	best := -1
	for i, entry := range entries {
		if !strings.EqualFold(entry.name, skillEntrypoint) && !strings.EqualFold(path.Base(entry.name), skillEntrypoint) {
			continue
		}
		if best < 0 || strings.Count(entry.name, "/") < strings.Count(entries[best].name, "/") {
			best = i
		}
	}
	if best < 0 {
		return entries, false
	}
	if strings.EqualFold(entries[best].name, skillEntrypoint) {
		return entries, true
	}
	prefix := path.Dir(entries[best].name) + "/"
	filtered := make([]agentBuddyEntry, 0, len(entries))
	for _, entry := range entries {
		if !strings.HasPrefix(entry.name, prefix) {
			continue
		}
		entry.name = strings.TrimPrefix(entry.name, prefix)
		filtered = append(filtered, entry)
	}
	if len(filtered) == 0 {
		return entries, false
	}
	return filtered, true
}

func readAgentBuddyEntry(entry agentBuddyEntry) ([]byte, error) {
	if entry.file.UncompressedSize64 > maxSkillFileSize {
		return nil, invalidCodebase(fmt.Sprintf("AgentBuddy Skill file %q is larger than 1 MB.", entry.name))
	}
	handle, err := entry.file.Open()
	if err != nil {
		return nil, upstreamCodebase("agentbuddy_read_failed", "Could not read the AgentBuddy Skill.")
	}
	defer handle.Close()
	content, err := io.ReadAll(io.LimitReader(handle, maxSkillFileSize+1))
	if err != nil || len(content) > maxSkillFileSize {
		return nil, upstreamCodebase("agentbuddy_read_failed", fmt.Sprintf("Could not read AgentBuddy Skill file %q.", entry.name))
	}
	return content, nil
}

func isTextContent(data []byte) bool {
	if !utf8.Valid(data) {
		return false
	}
	return bytes.IndexByte(data, 0) < 0
}
