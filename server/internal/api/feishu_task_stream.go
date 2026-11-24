package api

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"time"

	"github.com/KDF5000/relay"
	"github.com/KDF5000/steer/server/internal/store"
	lark "github.com/larksuite/oapi-sdk-go/v3"
	channeltypes "github.com/larksuite/oapi-sdk-go/v3/channel/types"
)

type feishuLiveReply struct{ MessageID, Token, Content string }

func (m *integrationManager) startFeishuTaskCard(ctx context.Context, integration store.WorkspaceIntegration, client *lark.Client, bot channeltypes.Channel, msg *channeltypes.NormalizedMessage, task store.Task, threadKey string, projection runProjection) (*feishuLiveReply, error) {
	snapshot, _ := json.Marshal(feishuCardContext{TaskID: task.ID, ConversationID: task.ConversationID})
	card, err := m.server.store.CreateIntegrationCard(ctx, store.IntegrationCard{IntegrationID: integration.ID, ChatID: msg.ChatID, ThreadKey: threadKey, Kind: "task", Context: snapshot})
	if err != nil {
		return nil, err
	}
	content := feishuExecutionCard(string(projection.Run.Status), projection.Events, "", card.ID)
	result, err := m.sendFeishuReply(ctx, integration, client, bot, msg, threadKey, &channeltypes.SendInput{ChatID: msg.ChatID, ReplyMessageID: msg.MessageID, Card: content})
	if err != nil {
		return nil, err
	}
	if err := m.server.store.BindIntegrationCardMessage(ctx, card.ID, result.MessageID); err != nil {
		return nil, err
	}
	return &feishuLiveReply{MessageID: result.MessageID, Token: card.ID, Content: content}, nil
}

func feishuTaskAnswer(projection runProjection) string {
	if projection.Run.Status == relay.RunSucceeded {
		if answer := strings.TrimSpace(projection.Content); answer != "" {
			return answer
		}
		return "任务已完成。"
	}
	answer := "任务" + feishuStatusText(string(projection.Run.Status))
	if projection.Error != nil {
		answer += "：" + *projection.Error
	}
	return answer
}

func (m *integrationManager) watchFeishuTask(ctx context.Context, integration store.WorkspaceIntegration, client *lark.Client, bot channeltypes.Channel, msg *channeltypes.NormalizedMessage, task store.Task, eventID, threadKey string) error {
	var reply *feishuLiveReply
	cardFailed := false
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		projection, err := m.server.syncRelayRun(ctx, integration.WorkspaceID, task.RelayRunID)
		if err != nil {
			return err
		}
		done := terminal(projection.Run.Status)
		answer := ""
		if done {
			answer = feishuTaskAnswer(projection)
		} else if integration.StreamReplies {
			answer = strings.TrimSpace(feishuFinalContent(projection.Events))
		}
		if reply == nil && !cardFailed {
			reply, err = m.startFeishuTaskCard(ctx, integration, client, bot, msg, task, threadKey, projection)
			if err != nil {
				cardFailed = true
				slog.Warn("Could not create Feishu task card", "task_id", task.ID, "error", err)
			}
		}
		if reply != nil && !cardFailed {
			content := feishuExecutionCard(string(projection.Run.Status), projection.Events, answer, reply.Token)
			if content != reply.Content {
				if err := patchFeishuCard(ctx, client, reply.MessageID, content); err != nil {
					cardFailed = true
					slog.Warn("Could not update Feishu task card", "task_id", task.ID, "error", err)
				} else {
					reply.Content = content
				}
			}
		}
		if done {
			status := "succeeded"
			if projection.Run.Status != relay.RunSucceeded {
				status = "failed"
			}
			if err := m.server.store.UpdateIntegrationEvent(ctx, integration.ID, eventID, status, &task.ID, projection.Error); err != nil {
				return err
			}
			// Completion must not overwrite a newer conversation/project/model
			// choice made while a terminal Run was still being projected.
			if err := m.server.store.ClearIntegrationActiveTask(ctx, integration.ID, msg.ChatID, threadKey, task.ID); err != nil {
				return err
			}
			// Preserve complete long answers when the process card's byte budget
			// requires truncation, and fall back if card APIs are unavailable.
			if cardFailed || len(answer) > 12<<10 {
				_, err := m.sendFeishuReply(ctx, integration, client, bot, msg, threadKey, &channeltypes.SendInput{ChatID: msg.ChatID, ReplyMessageID: msg.MessageID, Markdown: answer})
				return err
			}
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}
