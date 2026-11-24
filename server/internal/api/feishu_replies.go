package api

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/KDF5000/steer/server/internal/store"
	"github.com/google/uuid"
	lark "github.com/larksuite/oapi-sdk-go/v3"
	"github.com/larksuite/oapi-sdk-go/v3/channel/normalize"
	"github.com/larksuite/oapi-sdk-go/v3/channel/outbound"
	channeltypes "github.com/larksuite/oapi-sdk-go/v3/channel/types"
	larkcore "github.com/larksuite/oapi-sdk-go/v3/core"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
)

// The channel SDK's SendInput does not expose reply_in_thread. Group replies
// use the native API explicitly; direct chats keep the existing channel path.
// There is no fallback to a standalone group message if thread delivery fails.
func (m *integrationManager) sendFeishuReply(ctx context.Context, integration store.WorkspaceIntegration, client *lark.Client, bot channeltypes.Channel, msg *channeltypes.NormalizedMessage, threadKey string, input *channeltypes.SendInput) (*channeltypes.SendResult, error) {
	if msg.ChatType != "group" {
		return bot.Send(ctx, input)
	}
	target := msg.MessageID
	if event, ok := msg.RawEvent.(*larkim.P2MessageReceiveV1); ok && event.Event != nil && event.Event.Message != nil && value(event.Event.Message.RootId) != "" {
		target = value(event.Event.Message.RootId)
	}
	msgType, contents, err := feishuReplyContents(input)
	if err != nil {
		return nil, err
	}
	result := &channeltypes.SendResult{ChatID: msg.ChatID}
	for i, content := range contents {
		// Reuse the same UUID during transient API retries, including chunked
		// answers, so a lost response does not add a duplicate topic reply.
		idempotency := uuid.NewSHA1(uuid.NameSpaceURL, []byte(integration.ID+":"+msg.MessageID+":"+msgType+":"+strconv.Itoa(i)+":"+content)).String()
		req := larkim.NewReplyMessageReqBuilder().MessageId(target).Body(larkim.NewReplyMessageReqBodyBuilder().MsgType(msgType).Content(content).ReplyInThread(true).Uuid(idempotency).Build()).Build()
		response, err := outbound.Retry(ctx, func(_ int) (interface{}, error) {
			resp, err := client.Im.V1.Message.Reply(ctx, req)
			if err != nil {
				return nil, err
			}
			if !resp.Success() {
				// SDK channel classification treats 99991400 as permission denied,
				// but Feishu defines it as a retryable frequency-limit response.
				if resp.Code == 99991400 {
					return nil, &channeltypes.FeishuChannelError{Code: channeltypes.ErrCodeRateLimited, Message: resp.Msg, Cause: &larkcore.CodeError{Code: resp.Code, Msg: resp.Msg}}
				}
				return nil, &larkcore.CodeError{Code: resp.Code, Msg: resp.Msg}
			}
			if resp.Data == nil || value(resp.Data.MessageId) == "" {
				return nil, fmt.Errorf("Feishu thread reply did not return a message ID")
			}
			return resp.Data, nil
		}, nil)
		if err != nil {
			return nil, err
		}
		data := response.(*larkim.ReplyMessageRespData)
		aliases := []string{}
		for _, id := range []string{value(data.ThreadId), value(data.RootId)} {
			if id != "" {
				aliases = append(aliases, "thread:"+id)
			}
		}
		if err := m.server.store.BindIntegrationThreadAliases(ctx, integration.ID, msg.ChatID, threadKey, aliases); err != nil {
			return nil, err
		}
		if result.MessageID == "" {
			result.MessageID = value(data.MessageId)
		}
		result.ChunkIDs = append(result.ChunkIDs, value(data.MessageId))
	}
	if len(result.ChunkIDs) == 1 {
		result.ChunkIDs = nil
	}
	return result, nil
}

func feishuReplyContents(input *channeltypes.SendInput) (string, []string, error) {
	switch {
	case input.Card != "":
		return "interactive", []string{input.Card}, nil
	case input.Post != "":
		return "post", []string{input.Post}, nil
	case input.Markdown != "":
		contents := []string{}
		for i, chunk := range outbound.SplitWithCodeFences(input.Markdown, 3500) {
			var mentions []channeltypes.Mention
			if i == 0 {
				mentions = input.Mentions
			}
			content, err := normalize.SimpleMarkdownToPost(input.Title, chunk, mentions)
			if err != nil {
				return "", nil, err
			}
			contents = append(contents, content)
		}
		return "post", contents, nil
	case input.Text != "":
		text := []rune(normalize.ComposeMentionsTextPrefix(input.Mentions) + input.Text)
		contents := []string{}
		for start := 0; start < len(text); start += 3500 {
			end := min(start+3500, len(text))
			content, _ := json.Marshal(map[string]string{"text": string(text[start:end])})
			contents = append(contents, string(content))
		}
		return "text", contents, nil
	default:
		return "", nil, fmt.Errorf("unsupported Feishu reply content")
	}
}

func (m *integrationManager) sendFeishuCardError(ctx context.Context, integration store.WorkspaceIntegration, client *lark.Client, bot channeltypes.Channel, event *channeltypes.CardActionEvent, actionErr error) error {
	_, token := feishuCardAction(event)
	card, err := m.server.store.IntegrationCard(ctx, integration.ID, token)
	if err != nil {
		return err
	}
	if card.ChatID != event.ChatID || card.MessageID != event.MessageID {
		return fmt.Errorf("Feishu card reply target does not match")
	}
	msg := &channeltypes.NormalizedMessage{ChatID: card.ChatID, MessageID: card.MessageID, ChatType: "group"}
	if card.ThreadKey == "p2p" {
		msg.ChatType = "p2p"
	}
	_, err = m.sendFeishuReply(ctx, integration, client, bot, msg, card.ThreadKey, &channeltypes.SendInput{ChatID: card.ChatID, ReplyMessageID: card.MessageID, Text: "卡片操作未完成：" + actionErr.Error()})
	return err
}
