package api

import (
	"context"
	"encoding/json"
	"io"
	"path"
	"strings"

	"github.com/KDF5000/steer/server/internal/store"
)

const maxReviewJSONBytes = 2 << 20

var (
	validRiskLevels    = map[string]bool{"R0": true, "R1": true, "R2": true, "R3": true}
	validReviewTracks  = map[string]bool{"fast": true, "deep": true}
	validDispositions  = map[string]bool{"changes_requested": true, "needs_human_review": true, "no_confirmed_findings": true}
	validMergePolicies = map[string]bool{
		"auto_approve_eligible": true,
		"human_review_light":    true,
		"human_review_required": true,
		"block":                 true,
	}
)

type parsedReviewDocument struct {
	SchemaVersion string `json:"schema_version"`
	Scope         struct {
		HeadSHA string `json:"head_sha"`
	} `json:"scope"`
	Triage struct {
		RiskFloor string `json:"risk_floor"`
		Track     string `json:"track"`
	} `json:"triage"`
	Risk struct {
		Level string `json:"level"`
	} `json:"risk"`
	Disposition string `json:"disposition"`
	MergePolicy string `json:"merge_policy"`
}

// parseCodebaseReviewJSON extracts structured review metadata from a Skill
// review.json payload (v0.1 or v0.2). Unknown or malformed documents return ok=false.
func parseCodebaseReviewJSON(raw []byte) (store.CodebaseRunReviewMeta, bool) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" {
		return store.CodebaseRunReviewMeta{}, false
	}
	var doc parsedReviewDocument
	if err := json.Unmarshal([]byte(trimmed), &doc); err != nil {
		return store.CodebaseRunReviewMeta{}, false
	}
	if doc.SchemaVersion == "" && doc.Disposition == "" && doc.MergePolicy == "" {
		return store.CodebaseRunReviewMeta{}, false
	}
	if doc.Disposition != "" && !validDispositions[doc.Disposition] {
		return store.CodebaseRunReviewMeta{}, false
	}
	if doc.MergePolicy != "" && !validMergePolicies[doc.MergePolicy] {
		return store.CodebaseRunReviewMeta{}, false
	}
	meta := store.CodebaseRunReviewMeta{
		HeadSHA:     strings.TrimSpace(doc.Scope.HeadSHA),
		ReviewJSON:  json.RawMessage(trimmed),
		Disposition: doc.Disposition,
		MergePolicy: doc.MergePolicy,
	}
	if validRiskLevels[doc.Risk.Level] {
		meta.RiskLevel = doc.Risk.Level
	}
	if validRiskLevels[doc.Triage.RiskFloor] {
		meta.RiskFloor = doc.Triage.RiskFloor
	}
	if validReviewTracks[doc.Triage.Track] {
		meta.ReviewTrack = doc.Triage.Track
	}
	return meta, true
}

// extractCodebaseReviewJSONFromText scans fenced ```json blocks in an agent
// reply as a fallback when review.json was not exposed as a Relay artifact.
func extractCodebaseReviewJSONFromText(text string) ([]byte, bool) {
	rest := text
	for {
		start := strings.Index(rest, "```")
		if start < 0 {
			return nil, false
		}
		rest = rest[start+3:]
		nl := strings.IndexByte(rest, '\n')
		if nl < 0 {
			return nil, false
		}
		lang := strings.ToLower(strings.TrimSpace(rest[:nl]))
		rest = rest[nl+1:]
		end := strings.Index(rest, "```")
		if end < 0 {
			return nil, false
		}
		block := strings.TrimSpace(rest[:end])
		rest = rest[end+3:]
		if lang != "" && lang != "json" {
			continue
		}
		if _, ok := parseCodebaseReviewJSON([]byte(block)); ok {
			return []byte(block), true
		}
	}
}

// extractCodebaseRunReviewMeta prefers the review.json Relay artifact produced
// by the run, and falls back to extracting a structured JSON block from summary.
func (s *Server) extractCodebaseRunReviewMeta(ctx context.Context, wid string, task store.Task, summary string) (store.CodebaseRunReviewMeta, bool) {
	if task.RelayRunID != "" && s.relayHTTP != nil {
		if artifacts, err := s.store.RunArtifacts(ctx, wid, task.RelayRunID); err == nil {
			for _, artifact := range artifacts {
				name := strings.ToLower(path.Base(strings.TrimSpace(artifact.Name)))
				if name != "review.json" || artifact.RelayArtifactID == nil || *artifact.RelayArtifactID == "" {
					continue
				}
				reader, openErr := s.relayHTTP.OpenArtifact(ctx, *artifact.RelayArtifactID)
				if openErr != nil {
					continue
				}
				data, readErr := io.ReadAll(io.LimitReader(reader, maxReviewJSONBytes+1))
				_ = reader.Close()
				if readErr != nil || len(data) > maxReviewJSONBytes {
					continue
				}
				if meta, ok := parseCodebaseReviewJSON(data); ok {
					return meta, true
				}
			}
		}
	}
	if raw, ok := extractCodebaseReviewJSONFromText(summary); ok {
		return parseCodebaseReviewJSON(raw)
	}
	return store.CodebaseRunReviewMeta{}, false
}
