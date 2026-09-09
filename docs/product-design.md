# Steer 产品设计（验证版）

## 1. 产品定义

Steer 是面向人与 Agent 协作的决策与成果工作台。Relay 负责跨机器 Runtime 的发现、调度和执行；Steer 负责把执行过程整理成人需要关注的决策、证据与成果。

核心假设：当 Agent 执行带宽快速增长后，人的注意力和判断力会成为系统瓶颈。产品价值不在于展示更多 Agent，而在于减少人必须处理的事项，并提高每次介入的质量。

一句话描述：

> Steer 将 Agent 的执行压缩为少量可判断的事项，并把结果沉淀为持续演进的成果。

## 2. 目标用户与场景

首轮用户是同时使用多个 Coding Agent 的个人开发者或小型研发团队负责人。他们需要推进一个有明确目标但包含研究、方案、代码和验证的工作，而不是管理 Agent 本身。

首个验证场景是“代码仓库改进”：

1. 人创建目标并声明成功标准与自治边界。
2. Steer 将执行请求提交给 Relay。
3. 多次 Run 在后台产生分析、方案、代码变更和测试报告。
4. Steer 聚合过程信息，只在需要取舍、输入或授权时进入 Attention。
5. 人根据摘要、风险和证据作出决定。
6. 决定成为后续执行约束，最终结果沉淀为 Artifact。

## 3. 设计原则

### 人拥有方向，Agent 拥有执行

人对目标、约束和最终决定负责。Agent 是执行来源，不成为业务对象的最终负责人。

### 默认安静

正常执行、自动恢复和低风险完成不进入 Attention。界面明确展示被系统吸收的工作量，让用户知道“没有通知”意味着工作仍在推进。

### 介入必须有理由

每个 Attention Item 必须说明：为什么现在需要人、推荐选项、替代方案、影响、不处理的后果，以及支撑判断的证据。

### 成果优先于消息

聊天和 Run Event 是过程；Artifact 是可继续使用的结果。Artifact 有类型、版本、状态、来源、依据和替代关系。

### 语义化决策

产品不使用万能的“批准”按钮。不同场景提供采用方案、接受变更、补充信息、授权操作、承担风险或终止路线等动作。

### 逐步授予自治

自治策略以风险和副作用为边界：自动执行、执行后通知、阶段 Review、决策前暂停、外部操作前授权。

## 4. 领域模型

### Workstream

围绕一个业务目标组织当前状态、约束、决策、成果和执行记录。它不是 Todo 容器。

关键字段：`goal`、`success_criteria`、`constraints`、`state`、`autonomy_policy`、`current_summary`。

### Attention Item

需要人投入判断力的事项，是首页的核心对象。

类型包括：`decision`、`review`、`input_required`、`authorization`、`exception`。它包含推荐动作、候选项、影响、风险、截止时间和 Evidence 引用。

### Decision

人作出的结构化决定。Decision 不只是评论，它会成为后续 Agent 执行的约束，并记录决定者、理由、选择和可撤销性。

### Artifact

可交付或可继续使用的成果，例如方案、代码变更、分析报告、测试报告和发布包。

生命周期：`draft → pending_review → accepted → superseded / published`。

### Evidence

支撑摘要和决策的可追溯依据，可以指向代码位置、测试、文档、外部来源、Run Event 或其他 Artifact。

### Activity

完整审计轨迹，连接 Relay Run、Runtime、Agent 输出、Artifact 版本和人的 Decision。它用于追溯和排障，不作为日常主界面。

## 5. 信息架构

### Attention

回答“现在什么事情值得我投入判断力”。按影响和时效排序，默认不展示普通通知和完整执行日志。

### Workstreams

回答“目标推进到哪里、下一处关键阻塞是什么”。展示状态摘要、已接受成果、待判断事项、风险和里程碑。

### Artifacts

回答“系统已经形成了哪些有效成果”。按 Workstream、类型和状态管理版本，而不是按聊天或 Agent 分散保存附件。

### Activity

回答“这项结论和成果是怎么产生的”。展示完整执行轨迹，并允许下钻到 Relay Run，但不抢占首页注意力。

Agent、Runtime 和 Relay 连接状态进入设置或诊断入口，不占据一级导航。

## 6. 核心交互

Attention 采用主从布局：左侧是压缩后的待判断列表，右侧在同一上下文中展示推荐、风险、依据和动作，避免频繁进入详情页。

采用推荐方案后：

1. 生成 Decision 记录。
2. 当前 Attention Item 进入已处理状态。
3. Decision 写入 Workstream Context。
4. Steer 根据下一步策略提交新的 Relay Request。
5. 新 Artifact 与原 Decision 建立来源关系。

要求调整时，用户表达缺少的依据或约束，原事项保持可追溯，新一轮执行不能覆盖历史方案。

## 7. Relay 边界

Steer 拥有 Workstream、Attention Item、Decision、Artifact 版本关系和自治策略。Relay 不理解这些业务对象。

Relay 提供：Runtime Inventory、Run、Event、Interaction、Cancellation、Workspace 和原始 Artifact 传输。Steer 使用 `source`、`session_id` 和业务侧关联表建立映射。

第一轮真实接入优先验证：

- 增量 Event 能否可靠生成当前状态摘要；
- Interaction 是否足以承载结构化的人类输入；
- Artifact 是否需要增加业务元数据，还是完全由 Steer 保存；
- 一次 Decision 触发后续 Run 的幂等性和可追溯性。

## 8. MVP 范围

包含：

- 单用户、单工作区；
- 创建代码改进 Workstream；
- Relay Runtime 选择与执行；
- Attention 聚合和三种类型：决策、Review、补充输入；
- Artifact 列表、状态和版本；
- Decision 驱动下一次执行；
- Activity 审计轨迹。

暂不包含：

- 通用 Todo 和 Issue 管理；
- Agent 人设、组织结构和社交式 Agent 列表；
- 可视化 DAG 工作流编辑器；
- 长期记忆平台；
- 企业权限、计费与跨组织协作；
- 对 Multica 的接入和迁移。

## 9. 验证指标

核心不是“创建了多少 Agent”，而是：

- 人每个 Workstream 每天被打断的次数；
- Attention Item 中真正需要人判断的比例；
- 从打开事项到作出决定的时间；
- 人需要阅读的原始 Agent 输出比例；
- Artifact 被接受、复用或替代的比例；
- 决策与最终成果之间能否完整追溯；
- 用户是否愿意让系统提升自治等级。

第一阶段成功标准：用户能在不查看 Agent 列表和完整聊天记录的情况下，理解目标状态、完成关键判断，并找到所有已接受成果。

## 10. 原型走查任务

1. 在 Attention 中选择不同类型的事项。
2. 查看推荐依据和证据预览。
3. 采用推荐方案或要求调整，观察事项从 Attention 中移除。
4. 在 Workstreams 中理解目标状态并返回下一项决策。
5. 在 Artifacts 中识别哪些成果是当前有效版本。
6. 在 Activity 中追溯一次成果由哪个执行和决定产生。
