package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/KDF5000/steer/server/internal/store"
	"github.com/google/uuid"
	lark "github.com/larksuite/oapi-sdk-go/v3"
	channeltypes "github.com/larksuite/oapi-sdk-go/v3/channel/types"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
)

func TestFeishuRepliesStayInOriginalTopic(t *testing.T) {
	db := os.Getenv("STEER_TEST_DATABASE_URL")
	if db == "" {
		t.Skip("set STEER_TEST_DATABASE_URL")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	st, err := store.Open(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err = st.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	wid := "feishu-threads-" + uuid.NewString()
	if err = st.EnsureWorkspace(ctx, wid, "Thread test"); err != nil {
		t.Fatal(err)
	}
	makeIntegration := func() store.WorkspaceIntegration {
		t.Helper()
		i, err := st.CreateWorkspaceIntegration(ctx, store.WorkspaceIntegration{WorkspaceID: wid, Provider: "feishu", Name: "Bot", ExternalAppID: uuid.NewString(), AgentID: "agent", Status: "disabled", EncryptedCredentials: []byte("test")})
		if err != nil {
			t.Fatal(err)
		}
		return i
	}
	integration := makeIntegration()
	m := New(st, "http://127.0.0.1:1", "", "", wid, nil).integrations
	bot := &feishuTestChannel{}
	var mu sync.Mutex
	type sent struct {
		Content string `json:"content"`
		Type    string `json:"msg_type"`
		Thread  bool   `json:"reply_in_thread"`
		UUID    string `json:"uuid"`
	}
	var requests []sent
	var fail, rateLimit bool
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/auth/") {
			writeJSON(w, 200, map[string]any{"code": 0, "tenant_access_token": "thread-test-token", "expire": 7200})
			return
		}
		if r.Method != "POST" || !strings.HasSuffix(r.URL.Path, "/reply") {
			t.Errorf("standalone send or unexpected API: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(400)
			return
		}
		var input sent
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			t.Error(err)
		}
		if !input.Thread || input.UUID == "" {
			t.Errorf("missing thread flag or idempotency key: %+v", input)
		}
		// Root-bearing replies always target the first user message. Thread-only
		// messages can target the current reply, which Feishu keeps in its topic.
		if !strings.Contains(r.URL.Path, "/messages/root/reply") && !strings.Contains(r.URL.Path, "/messages/thread-only/reply") {
			t.Errorf("wrong reply target: %s", r.URL.Path)
		}
		mu.Lock()
		defer mu.Unlock()
		requests = append(requests, input)
		if fail {
			writeJSON(w, 200, map[string]any{"code": 230011, "msg": "message revoked"})
			return
		}
		if rateLimit {
			rateLimit = false
			writeJSON(w, 200, map[string]any{"code": 99991400, "msg": "rate limited"})
			return
		}
		writeJSON(w, 200, map[string]any{"code": 0, "data": map[string]string{"message_id": fmt.Sprintf("reply-%d", len(requests)), "chat_id": "chat", "root_id": "root", "thread_id": "native-thread"}})
	}))
	defer remote.Close()
	client := lark.NewClient("thread-test-app", uuid.NewString(), lark.WithOpenBaseUrl(remote.URL))
	root := &channeltypes.NormalizedMessage{ChatID: "chat", ChatType: "group", MessageID: "root", MentionedBot: true, RawContentType: "text", Content: "Task"}
	const sessionID = "original-session"
	if err = st.SaveIntegrationConversation(ctx, store.IntegrationConversation{IntegrationID: integration.ID, ChatID: "chat", ThreadKey: "thread:root", ConversationID: sessionID}); err != nil {
		t.Fatal(err)
	}
	if err = st.SetIntegrationConversationModel(ctx, integration.ID, "chat", "thread:root", "chosen-model", "high"); err != nil {
		t.Fatal(err)
	}
	// Initial output creates the Feishu topic and saves its native thread alias.
	if _, err = m.sendFeishuReply(ctx, integration, client, bot, root, "thread:root", &channeltypes.SendInput{ChatID: "chat", ReplyMessageID: "root", Card: feishuExecutionCard("succeeded", nil, "Done", "token")}); err != nil {
		t.Fatal(err)
	}
	makeReply := func(id, command string, includeRoot bool) *channeltypes.NormalizedMessage {
		msg := &channeltypes.NormalizedMessage{ChatID: "chat", ChatType: "group", MessageID: id, EventID: id, RawContentType: "text", Content: command}
		native := "native-thread"
		original := "root"
		parent := "bot-reply"
		message := &larkim.EventMessage{ThreadId: &native, ParentId: &parent}
		if includeRoot {
			message.RootId = &original
		}
		msg.RawEvent = &larkim.P2MessageReceiveV1{Event: &larkim.P2MessageReceiveV1Data{Message: message}}
		return msg
	}
	for _, msg := range []*channeltypes.NormalizedMessage{makeReply("question", "/help", true), makeReply("thread-only", "/help", false)} {
		key, err := st.ResolveIntegrationThread(ctx, integration.ID, msg.ChatID, feishuThreadKeys(msg))
		if err != nil || key != "thread:root" {
			t.Fatalf("reply lost original session: %s %v", key, err)
		}
		mu.Lock()
		before := len(requests)
		mu.Unlock()
		// Explicitly mentioned replies reuse the existing native alias/session.
		msg.MentionedBot = true
		if err = m.acceptMessage(ctx, integration, client, bot, msg); err != nil {
			t.Fatal(err)
		}
		waitWorkers := func() {
			t.Helper()
			deadline := time.Now().Add(5 * time.Second)
			for time.Now().Before(deadline) {
				m.mu.Lock()
				active := len(m.workers)
				m.mu.Unlock()
				if active == 0 {
					return
				}
				time.Sleep(10 * time.Millisecond)
			}
			t.Fatal("reply worker did not finish")
		}
		waitWorkers()
		mu.Lock()
		count := len(requests)
		mu.Unlock()
		if count != before+1 {
			t.Fatalf("known-thread reply was ignored or duplicated: %d -> %d", before, count)
		}
		current, err := st.IntegrationConversation(ctx, integration.ID, "chat", key)
		if err != nil || current.ConversationID != sessionID || value(current.ModelOverride) != "chosen-model" || value(current.ReasoningEffort) != "high" {
			t.Fatalf("reply replaced original session: %+v %v", current, err)
		}
		if id := feishuReplyContextID(msg, current); id != "" {
			t.Fatalf("known session redundantly imported parent: %s", id)
		}
	}
	// Unknown unmentioned topics cannot start a task or leak another topic's
	// context; aliases are isolated by both integration and chat.
	unknown := makeReply("unrelated", "/help", true)
	differentRoot, differentThread := "different-root", "different-thread"
	unknown.RawEvent.(*larkim.P2MessageReceiveV1).Event.Message.RootId = &differentRoot
	unknown.RawEvent.(*larkim.P2MessageReceiveV1).Event.Message.ThreadId = &differentThread
	mu.Lock()
	before := len(requests)
	mu.Unlock()
	if err = m.acceptMessage(ctx, integration, client, bot, unknown); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	if len(requests) != before {
		t.Error("unrelated unmentioned topic was accepted")
	}
	mu.Unlock()
	for _, scope := range []struct{ id, chat string }{{makeIntegration().ID, "chat"}, {integration.ID, "other-chat"}} {
		key, err := st.ResolveIntegrationThread(ctx, scope.id, scope.chat, []string{"thread:native-thread"})
		if err != nil || key != "thread:native-thread" {
			t.Fatalf("alias escaped scope: %s %v", key, err)
		}
	}
	// Older thread-ID sessions remain usable, without copying their state into
	// another integration_conversations row.
	if err = st.SaveIntegrationConversation(ctx, store.IntegrationConversation{IntegrationID: integration.ID, ChatID: "legacy-chat", ThreadKey: "thread:legacy-native", ConversationID: "legacy-session"}); err != nil {
		t.Fatal(err)
	}
	legacyKeys := []string{"thread:legacy-root", "thread:legacy-native"}
	key, err := st.ResolveIntegrationThread(ctx, integration.ID, "legacy-chat", legacyKeys)
	if err != nil || key != "thread:legacy-native" {
		t.Fatalf("legacy mapping lost: %s %v", key, err)
	}
	if err = st.BindIntegrationThreadAliases(ctx, integration.ID, "legacy-chat", key, legacyKeys); err != nil {
		t.Fatal(err)
	}
	if key, err = st.ResolveIntegrationThread(ctx, integration.ID, "legacy-chat", legacyKeys[:1]); err != nil || key != "thread:legacy-native" {
		t.Fatalf("root-only legacy reply split session: %s %v", key, err)
	}
	if err = st.ResetIntegrationConversation(ctx, integration.ID, "chat", "thread:root"); err != nil {
		t.Fatal(err)
	}
	key, err = st.ResolveIntegrationThread(ctx, integration.ID, "chat", []string{"thread:native-thread"})
	if err != nil {
		t.Fatal(err)
	}
	reset, err := st.IntegrationConversation(ctx, integration.ID, "chat", key)
	if err != nil || reset.ConversationID != "" || reset.ModelOverride != nil || reset.ReasoningEffort != nil {
		t.Fatalf("/new left stale alias state: %+v %v", reset, err)
	}
	// Markdown fallback and long Unicode text remain inside the same topic.
	followup := makeReply("question", "", true)
	if _, err = m.sendFeishuReply(ctx, integration, client, bot, followup, "thread:root", &channeltypes.SendInput{Markdown: "## Answer\n\n- Complete result\n\n```go\nfmt.Println(\"done\")\n```"}); err != nil {
		t.Fatal(err)
	}
	text := strings.Repeat("中文🙂", 4000)
	mu.Lock()
	before = len(requests)
	mu.Unlock()
	if _, err = m.sendFeishuReply(ctx, integration, client, bot, followup, "thread:root", &channeltypes.SendInput{Text: text}); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	longRequests := append([]sent(nil), requests[before:]...)
	mu.Unlock()
	var reconstructed strings.Builder
	for _, item := range longRequests {
		var body struct{ Text string }
		if err = json.Unmarshal([]byte(item.Content), &body); err != nil {
			t.Fatal(err)
		}
		reconstructed.WriteString(body.Text)
	}
	if reconstructed.String() != text || len(longRequests) < 2 {
		t.Fatal("chunked Unicode text was lost")
	}
	// API retries reuse the same UUID; failures never downgrade to a new group
	// message. Direct chat replies continue through the standard SDK channel.
	mu.Lock()
	before = len(requests)
	rateLimit = true
	mu.Unlock()
	if _, err = m.sendFeishuReply(ctx, integration, client, bot, root, "thread:root", &channeltypes.SendInput{Text: "retry"}); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	retried := append([]sent(nil), requests[before:]...)
	fail = true
	mu.Unlock()
	if len(retried) != 2 || retried[0].UUID != retried[1].UUID {
		t.Fatalf("retry was not idempotent: %+v", retried)
	}
	if _, err = m.sendFeishuReply(ctx, integration, client, bot, root, "thread:root", &channeltypes.SendInput{Text: "revoked"}); err == nil {
		t.Fatal("revoked topic should fail")
	}
	if len(bot.Sent) != 0 {
		t.Fatal("group reply fell back to standalone send")
	}
	private := &channeltypes.NormalizedMessage{ChatType: "p2p", ChatID: "private", MessageID: "private-message"}
	if _, err = m.sendFeishuReply(ctx, integration, client, bot, private, "p2p", &channeltypes.SendInput{ChatID: "private", ReplyMessageID: "private-message", Text: "private answer"}); err != nil || len(bot.Sent) != 1 {
		t.Fatalf("private reply changed: %v", err)
	}
}
