# Conversation Task API

Task API 用于从外部系统异步调用 Steer Agent，同时复用网页端相同的会话、
Runtime、远端工作目录和 Agent 原生 thread。通过同一个 `conversationId`
持续提交任务，即可获得长对话能力；通过 SSE 接口可以实时接收 Agent 输出。

## 快速开始

Docker Compose 默认地址：

```text
Steer Web:       http://localhost:3000
Steer Server:    http://localhost:8080
Task API base:   http://localhost:8080/api/v1
Relay Server:    http://localhost:8787
```

如果 `.env` 修改了 `STEER_SERVER_PORT`，请将示例中的 `8080` 替换为实际端口。
可以通过以下命令查看端口映射：

```bash
docker compose port steer-server 8080
```

在 Steer 网页的 **Settings → API access** 中创建 API Key。Agent ID 可以在
Agent 列表右侧复制，Project ID 可以在 Project 菜单中复制。

```bash
export STEER_BASE_URL=http://localhost:8080/api/v1
export STEER_API_KEY=steer_sk_replace_me
export STEER_AGENT_ID=replace-with-agent-id
export STEER_PROJECT_ID=replace-with-project-id
```

提交第一个任务：

```bash
curl --fail-with-body --silent --show-error \
  --request POST "$STEER_BASE_URL/tasks" \
  --header "Authorization: Bearer $STEER_API_KEY" \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: example-request-001' \
  --data "$(jq -n \
    --arg agentId "$STEER_AGENT_ID" \
    --arg projectId "$STEER_PROJECT_ID" \
    --arg prompt '检查项目并总结其结构。' \
    '{agentId: $agentId, projectId: $projectId, prompt: $prompt}')"
```

仓库中还提供了完整的一键流式验证脚本：

```bash
STEER_API_KEY="$STEER_API_KEY" \
STEER_AGENT_ID="$STEER_AGENT_ID" \
STEER_PROJECT_ID="$STEER_PROJECT_ID" \
./scripts/verify-task-stream.sh
```

脚本依赖 `curl` 和 `jq`，会创建任务、实时打印正文，并在结束后查询最终状态。

## 鉴权与权限

外部客户端使用 Workspace 级 API Key：

```http
Authorization: Bearer steer_sk_...
```

API Key 自动绑定创建它的 Workspace，因此外部客户端不需要传递
`X-Steer-Workspace`。Key 只能访问所在 Workspace 中的 Agent、Project、会话和任务。

| Scope          | 允许的操作                   |
| -------------- | ---------------------------- |
| `tasks:write`  | 创建新会话任务、继续已有会话 |
| `tasks:read`   | 查询任务、订阅事件、查询产物 |
| `tasks:cancel` | 取消任务                     |

网页默认创建包含全部三个 Scope 的 Key。原始 Token 只返回一次；Steer 数据库仅保存
Token 哈希。API Key 不能创建、列举或撤销其他 API Key，这些管理操作必须使用网页登录
Session 完成。Token 泄露后应立即在网页中撤销并重新创建。

浏览器内的 Steer Web 继续使用 `steer_session` Cookie，现有登录和聊天接口保持兼容。

## API 概览

| Method | Endpoint                                         | Scope          | 用途                           |
| ------ | ------------------------------------------------ | -------------- | ------------------------------ |
| `POST` | `/api/v1/tasks`                                  | `tasks:write`  | 创建会话并提交第一个任务       |
| `POST` | `/api/v1/conversations/{conversationId}/tasks`   | `tasks:write`  | 在已有会话中继续对话           |
| `GET`  | `/api/v1/tasks/{taskId}`                         | `tasks:read`   | 查询状态、最终正文、事件和产物 |
| `GET`  | `/api/v1/tasks/{taskId}/events?after={sequence}` | `tasks:read`   | 订阅 SSE 实时事件              |
| `GET`  | `/api/v1/tasks/{taskId}/artifacts`               | `tasks:read`   | 查询任务产物                   |
| `POST` | `/api/v1/tasks/{taskId}/cancel`                  | `tasks:cancel` | 取消正在执行的任务             |

## 创建任务

### 创建新会话

```http
POST /api/v1/tasks
Authorization: Bearer steer_sk_...
Idempotency-Key: client-request-123
Content-Type: application/json

{
  "agentId": "agent-id",
  "projectId": "project-id",
  "prompt": "Inspect the project and summarize its architecture.",
  "metadata": {
    "source": "automation",
    "externalTaskId": "job-42"
  }
}
```

请求字段：

| 字段             | 必填           | 说明                                                       |
| ---------------- | -------------- | ---------------------------------------------------------- |
| `agentId`        | 是             | 当前 Workspace 中的 Agent ID                               |
| `prompt`         | 是（无图片时） | 本轮用户消息                                               |
| `projectId`      | 否             | 当前 Workspace 中的 Project ID；设置后会话固定到该 Project |
| `metadata`       | 否             | 任意合法 JSON，随 Task 持久化，方便外部系统关联任务        |
| `conversationId` | 否             | 兼容字段；建议续接会话时使用 URL 形式                      |
| `sessionId`      | 否             | `conversationId` 的兼容别名                                |
| `idempotencyKey` | 否             | Header 的兼容字段；建议使用 `Idempotency-Key` Header       |

成功创建返回 HTTP `202 Accepted`：

```json
{
  "taskId": "2f74d63c-...",
  "conversationId": "36b9af23-...",
  "sessionId": "36b9af23-...",
  "runId": "run_...",
  "status": "running",
  "task": {
    "id": "2f74d63c-...",
    "conversationId": "36b9af23-...",
    "runId": "run_...",
    "agentId": "agent-id",
    "status": "running",
    "source": "api"
  },
  "userMessage": {
    "id": "message-id"
  },
  "assistantMessage": {
    "id": "message-id"
  }
}
```

API 创建的会话是普通 Steer 会话，会出现在网页会话列表中。

### 幂等提交

生产调用应为每次逻辑请求设置唯一的 `Idempotency-Key`，最大长度 200 个字符。

- 第一次提交返回 `202 Accepted`。
- 使用相同 Key 重试时返回原 Task，HTTP 状态为 `200 OK`。
- 相同 Key 不会创建第二个 Relay Run，也不会重复写入用户消息。

Key 应在调用方生成并持久化。网络超时后应使用原 Key 重试，而不是生成新 Key。

### 图片输入

有图片时使用 `multipart/form-data`：

```bash
curl --fail-with-body --request POST "$STEER_BASE_URL/tasks" \
  --header "Authorization: Bearer $STEER_API_KEY" \
  --header 'Idempotency-Key: image-request-001' \
  --form "agentId=$STEER_AGENT_ID" \
  --form "projectId=$STEER_PROJECT_ID" \
  --form 'prompt=分析这张截图中的问题。' \
  --form 'metadata={"source":"screenshot-check"}' \
  --form 'images=@./screenshot.png'
```

限制：

- 最多 4 张图片。
- 单张最大 5 MiB。
- 总大小最大 16 MiB，请求最大 18 MiB。
- 支持 PNG、JPEG、WebP 和 GIF。
- `metadata` 在 multipart 请求中必须是 JSON 字符串。

## 复用长对话上下文

创建第一个 Task 后保存响应中的 `conversationId`。后续请求使用：

```http
POST /api/v1/conversations/{conversationId}/tasks
Authorization: Bearer steer_sk_...
Idempotency-Key: client-request-124
Content-Type: application/json

{
  "agentId": "agent-id",
  "prompt": "Now implement the first recommendation."
}
```

```bash
curl --fail-with-body --silent --show-error \
  --request POST \
  "$STEER_BASE_URL/conversations/$CONVERSATION_ID/tasks" \
  --header "Authorization: Bearer $STEER_API_KEY" \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: example-request-002' \
  --data "$(jq -n \
    --arg agentId "$STEER_AGENT_ID" \
    --arg prompt '继续实现刚才提到的第一项建议。' \
    '{agentId: $agentId, prompt: $prompt}')"
```

同一个 `conversationId` 会复用：

- Steer 会话历史与压缩后的上下文。
- Relay `sessionId` 和 Agent Runtime 原生 thread。
- 已选定的 Project、Runtime 和远端工作目录。
- Git Project 的可复用 session worktree（启用该执行模式时）。

不要在同一会话中并发执行两轮任务。已有 Task 未结束时再次提交会返回：

```http
HTTP/1.1 409 Conflict
Content-Type: application/json

{
  "error": "This conversation already has an active task.",
  "code": "conversation_busy"
}
```

不同会话可以并发执行，最终并发能力由 Relay Node 的 Runtime capacity 决定。

## 流式输出

Task 创建接口立即返回，不保持请求连接。调用方随后使用返回的 `taskId` 连接 SSE：

```bash
curl --no-buffer --fail-with-body \
  "$STEER_BASE_URL/tasks/$TASK_ID/events?after=0" \
  --header "Authorization: Bearer $STEER_API_KEY" \
  --header 'Accept: text/event-stream'
```

事件格式：

```text
id: 26
event: relay.event
data: {"sequence":26,"type":"assistant.message.delta","data":{"delta":"Hello"}}

event: steer.done
data: {}
```

| SSE event     | 含义                                                  |
| ------------- | ----------------------------------------------------- |
| `relay.event` | Relay Run 产生的实时事件，完整事件位于 `data` JSON 中 |
| `steer.done`  | 本次事件流正常结束                                    |
| `steer.error` | 事件流中断，`data.error` 包含错误信息                 |

消费 Agent 正文时建议使用标准事件：

```json
{
  "sequence": 26,
  "type": "assistant.message.delta",
  "data": {
    "delta": "增量正文",
    "item_id": "message-item-id"
  }
}
```

Relay 还可能同时发送 `runtime.<provider>.item.agentMessage.delta` 等 Runtime 原生事件。
它们用于展示 provider 特有的执行过程，正文可能与标准 `assistant.message.delta` 重复。
只需要文本流的调用方应仅拼接标准事件，避免输出两遍。

工具调用、命令执行、推理进度等也通过 `relay.event` 发送。调用方可以根据
`data.type` 选择展示或忽略，未知事件类型应安全忽略，以兼容 Relay 后续扩展。

### 断线续传

保存每个事件的 `sequence` 或 SSE `id`。连接中断后使用最后成功处理的序号重连：

```text
GET /api/v1/tasks/{taskId}/events?after={lastSequence}
```

服务只返回该序号之后的事件，调用方还应按 `sequence` 去重。`after` 必须是非负整数。

SSE 正常结束后建议再调用一次 `GET /tasks/{taskId}`，以服务端投影的 `content`
作为最终正文。最终投影可以处理 provider 的 completed/final 事件，可靠性高于客户端自行
拼接所有 delta。

### 反向代理配置

Steer Server 已返回：

```http
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
X-Accel-Buffering: no
```

域名或 LB 前仍需确认：

- 关闭响应缓冲与压缩聚合。
- 允许长连接，并将读取超时设置为 Agent 任务可能运行的最长时间。
- 不缓存 `/api/v1/tasks/*/events`。
- 及时向客户端转发小数据块，而不是积累到固定大小后一次性发送。

浏览器原生 `EventSource` 不能设置 `Authorization` Header。外部网页应用应使用
`fetch()` + `ReadableStream` 读取 SSE，或者通过自己的后端代理，不要把 API Key 放入
URL 查询参数。

## 查询任务

```http
GET /api/v1/tasks/{taskId}
Authorization: Bearer steer_sk_...
```

响应示例：

```json
{
  "task": {
    "id": "task-id",
    "conversationId": "conversation-id",
    "runId": "run-id",
    "agentId": "agent-id",
    "source": "api",
    "status": "succeeded",
    "result": "最终完整回复",
    "error": null,
    "metadata": {
      "externalTaskId": "job-42"
    },
    "createdAt": "2026-09-30T10:00:00Z",
    "updatedAt": "2026-09-30T10:00:12Z",
    "startedAt": "2026-09-30T10:00:01Z",
    "completedAt": "2026-09-30T10:00:12Z"
  },
  "run": {
    "id": "run-id",
    "status": "succeeded"
  },
  "content": "最终完整回复",
  "error": null,
  "events": [],
  "artifacts": []
}
```

可能的状态：

| 状态         | 含义                              |
| ------------ | --------------------------------- |
| `queued`     | 已进入队列，等待 Runtime capacity |
| `running`    | Agent 正在执行                    |
| `cancelling` | 已请求取消，等待 Runtime 确认     |
| `cancelled`  | 已取消                            |
| `succeeded`  | 执行成功                          |
| `failed`     | 执行失败，查看 `error`            |

读取 Task 时 Steer 会同步 Relay 最新状态、最终正文和产物，并将投影持久化到数据库。

## 取消任务

```bash
curl --fail-with-body --silent --show-error \
  --request POST "$STEER_BASE_URL/tasks/$TASK_ID/cancel" \
  --header "Authorization: Bearer $STEER_API_KEY"
```

取消是异步过程。接口接受请求后仍应继续查询 Task，直到状态变为 `cancelled`、
`succeeded` 或 `failed`。

## 查询产物

```bash
curl --fail-with-body --silent --show-error \
  "$STEER_BASE_URL/tasks/$TASK_ID/artifacts" \
  --header "Authorization: Bearer $STEER_API_KEY"
```

Task 进入终态后，Steer 会同步 Relay 暴露的可交付产物。不是每个 Task 都会产生 Artifact；
普通聊天回复位于 Task 的 `content` 字段。

## 错误处理

错误响应统一至少包含 `error`：

```json
{
  "error": "human-readable error message"
}
```

常见 HTTP 状态：

| 状态  | 场景                                            | 建议                              |
| ----- | ----------------------------------------------- | --------------------------------- |
| `400` | 字段缺失、ID 不匹配、图片或幂等 Key 不合法      | 修正请求，不要原样重试            |
| `401` | API Key 无效、已撤销或格式错误                  | 更换 Key                          |
| `403` | Key 缺少所需 Scope                              | 创建具有正确 Scope 的 Key         |
| `404` | Task、Agent、Project 或会话不属于当前 Workspace | 检查 ID 和 Key 所属 Workspace     |
| `409` | 会话忙、Project/Runtime 与会话不兼容            | 等待当前 Task 结束，或使用新会话  |
| `5xx` | Steer、Relay 或 Runtime 暂时异常                | 使用原 `Idempotency-Key` 退避重试 |

不要对 `409 conversation_busy` 自动创建新会话，否则会丢失原会话的长上下文和 Runtime
thread。应等待现有 Task 进入终态后，再使用原 `conversationId` 提交下一轮。

## API Key 管理接口

以下接口仅供已登录的 Steer Web 或带登录 Cookie 的管理客户端使用，不能使用 API Key
调用：

```text
GET    /api/v1/api-keys
POST   /api/v1/api-keys
DELETE /api/v1/api-keys/{apiKeyId}
```

创建请求：

```json
{
  "name": "CI automation",
  "scopes": ["tasks:read", "tasks:write", "tasks:cancel"]
}
```

创建响应中的 `token` 只显示一次，应立即保存到 Secret Manager，不要提交到 Git、日志或
前端代码。

## 兼容性

原有 `POST /api/v1/chat` 保持支持，并维持历史响应结构。它现在是统一 Task 执行链路上的
兼容适配器，因此网页和外部 API 在会话上下文、Runtime thread、持久化和 Relay 执行行为
上保持一致。

新集成应优先使用 Task API，因为它提供稳定的 `taskId`、幂等提交、SSE、状态查询、取消
和产物接口。
