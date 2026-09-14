# Steer Chat-first 产品设计

## 1. 产品定位

Steer 第一阶段不是 Goal、Issue 或多 Agent 项目管理系统，而是一个面向分布式开发环境的
Agent 桌面工作台。

它以接近 ChatGPT 桌面版的对话体验作为基础，但解决一个更具体的问题：用户不仅可以让
Agent 在当前电脑的项目目录中工作，还可以选择连接到 Relay 的远程 Runtime，让同一个
对话入口直接使用远程机器上的代码、算力、工具链和认证环境。

一句话定位：

> 在任何 Relay Runtime 上，打开一个项目并和 Agent 一起工作。

## 2. 核心对象

- **Project**：工作来源。可以是固定 Runtime 上的已有目录，也可以是能够在 Runtime 上构造的
  Git Repository，不绑定具体 Agent。
- **Agent**：执行角色、模型和 Runtime 选择策略。它可以固定 Runtime，也可以声明 Provider
  需求，但不能让已经开始的 Conversation 静默漂移到另一台机器。
- **Runtime**：Relay 管理的真实执行实例，提供机器、CLI、模型和容量。
- **Workspace Instance**：Project 在某个 Runtime 上物化出来的工作目录。Git Project 默认以
  Conversation 为复用范围创建隔离 worktree。
- **Conversation**：用户的连续工作上下文，创建后固定 Project、Runtime 和 Workspace
  Instance；允许切换与当前 Runtime 兼容的 Agent。
- **Run**：Conversation 中一次用户消息触发的实际执行，包含流式事件、状态和错误。
- **Artifact**：Run 有意产生的持久结果，例如文档、补丁、代码变更、图片或数据文件。

Inbox、Goal、Assignment 与 Goal Review 不属于这一产品模型，由具体业务产品在 Steer 或
Relay 之上按需实现。

## 3. 主流程

1. 用户进入应用，默认看到 New chat。
2. 选择 Project。目录 Project 已明确登记所在 Runtime；Git Project 可在目标 Runtime 构造。
3. 选择 Agent。首次执行据此确定 Conversation 的 Runtime，之后执行位置保持稳定。
4. 用户发送消息，Steer 创建 Conversation 和 Relay Run。
5. 中央对话区持续显示 Agent 回复；技术事件不打断正文。
6. Run 产生文件或代码变更时，在右侧 Review 面板提示，而不是强制把回复当成交付物。
7. 用户可以查看 diff、文档或文件，选择接受、继续修改或下载。

Conversation 一旦有消息，不允许切换 Project。可以切换 Agent，但新 Agent 必须兼容已经固定
的 Runtime。切换到其他 Runtime 应显式 Fork Conversation，并迁移 Git checkpoint，而不是
作为普通 Agent 切换处理。

## 4. 本地与远程项目

`local` Project 表示“指定 Runtime 节点上的已有目录”，不表示 Steer Server 所在机器的目录。

- Agent 固定到本机 Runtime：路径指向用户电脑上的目录。
- 创建目录 Project 时必须同时选择 Runtime，Relay 在该节点解释和验证绝对路径。
- Git Project 保存 Repository URL、默认 Ref 和可选 Subdirectory。Relay 在每个 Node 上复用
  bare mirror，并为每个 Conversation 创建可复用的隔离 worktree。
- 主 Project 的准备属于 Relay Workspace Provider；Agent 运行过程中临时获取其他仓库才属于
  Tool/Capability。Relay 不承载 Project、Conversation 或 Review 等业务语义。

## 5. 信息架构

左侧栏只承担高频导航：

- New chat
- Recent conversations
- Projects
- Artifacts
- Agents / Runtimes（System）

中央区域只承担对话；Project、Agent、Runtime 信息保持可见但不抢占内容空间。

右侧面板用于审查当前 Conversation 的运行结果：

- Changed files / diff
- Documents and generated files
- Run activity and errors
- Accept、Request changes、Download

右侧面板没有可审查内容时默认关闭。

## 6. 实施阶段

### Phase 1：Chat 基线

- Chat 成为默认入口；
- 最近对话持久化并可恢复；
- Project 独立建模；
- Conversation 绑定 Project 和 Agent；
- Project 路径传递给 Relay Workspace；
- 继续保留流式回复、停止执行和 Markdown 展示。

### Phase 2：Artifact Review

- 为当前 Run 增加右侧 Review 面板；
- 区分普通回复、文件 Artifact、Git diff 和需要确认的操作；
- 支持文档预览、代码 diff、下载与继续修改。

### Phase 3：开发工作流增强

- Git 项目克隆与分支策略；
- 项目与 Runtime 可达性检查；
- 会话派生、检查点和恢复；
- 权限审批与危险操作确认。
