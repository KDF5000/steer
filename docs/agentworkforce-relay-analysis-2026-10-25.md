# AgentWorkforce Relay 与 Steer 的场景比较

日期：2026-10-25。外部仓库检查基线：`c3a92d9c179972963756ebce3fcd106679302934`。Steer 基线：`115f8e0`。

## 判断

有类似场景，值得借鉴，尤其是跨工具历史与工作记录。它更接近“让现有 Agent 协作的基础设施”，Steer 当前更接近“让个人通过统一界面使用 Agent 的工作台”。执行层存在竞争与重合，个人工作体验上仍有不同的探索空间。

这里的 AgentWorkforce Relay，与本项目依赖的 KDF5000/relay 是两个独立项目，协议与 Node 概念不可直接等同。

本次阅读官方仓库、文档、关联项目及部分 SDK 源码，未安装运行。源码存在不代表完成了真实 CLI、网络故障或第三方回写的可靠性验证。

## 1. 它在解决什么

[主仓库](https://github.com/AgentWorkforce/relay)将问题定义为：减少人在不同 Agent 与协作工具之间复制粘贴，让已有 Agent、工具、人和机器参与同一个工作流程。生态拆分包括消息协作、外部数据接入、历史检索、决策记录和流程执行。

| 组成 | 所读公开资料表达的能力 | 对 Steer 的意义 |
| --- | --- | --- |
| Messaging / Relaycast | Agent 通过频道、私信和话题协作，消息持久化并投递到会话 | 可从用户手动切换走向异步协作；不必把所有内部通信展示给用户 |
| Relayhistory | 跨 harness 索引历史、搜索、生成有 token 预算的上下文包 | 用户不必把所有工作迁入 Steer 才能获得连续性 |
| Trajectories | 按任务记录阶段、决定、结果和相关文件 | 为持续工作建立比单个 Chat 更稳定的载体 |
| Flows | 代码定义步骤、检查与人工关卡 | 高频工作可以逐渐固化为可验证过程 |
| Relayfile | 外部系统事件转为带权限的文件视图，并支持回写 | 个人工作台可以响应工作变化，而不只响应用户发消息 |

这些是同一组织生态中的不同项目，不应把整个生态的能力都算作主仓库单一安装包开箱即用。

来源：[消息层介绍](https://agentrelay.com/docs/introduction)、[Relayhistory](https://github.com/AgentWorkforce/relayhistory)、[Trajectories](https://github.com/AgentWorkforce/trajectories)、[Flows](https://github.com/AgentWorkforce/flows)、[Relayfile](https://github.com/AgentWorkforce/relayfile)。

## 2. 与我们重合在哪里

| 用户场景 | Steer 当前方式 | AgentWorkforce 的方式 / 方向 |
| --- | --- | --- |
| 不同 Agent 在已有机器上工作 | Relay Node、Runtime、项目和会话 | Node/provider、会话、Agent runtime 和消息路由 |
| Agent A 完成后交给 B | 用户引用回复并委派，子会话回传结果 | Agent 消息与 action，可被流程组织起来 |
| 换工具后继续工作 | Steer 内可见对话历史、引用和 continuation prompt | 本地历史索引与上下文包 |
| 离开后回来知道发生什么 | 会话、Run、文件与工作记录 | 消息回执、会话活动、历史与轨迹 |
| 持续处理外部工作 | Task API 与飞书消息触发 | 工具事件、监听器与流程触发 |

术语差异很重要：[它的架构文档](https://agentrelay.com/docs/architecture)把 Node 定义为 Workspace 中登记的上下文，通常是项目目录，也可能是应用；provider 是实际接入进程。我们这里 Node 更接近物理执行机器。应比较职责，不应根据同名对象直接映射数据表。

## 3. 对个人工作台最有价值的借鉴

### A. 接纳用户在其他工具中已经完成的工作

Relayhistory 提供本地跨工具会话索引、原生恢复命令和有预算的上下文包。它将“找回工作”与“必须由本产品执行工作”分开。这可能是 Steer 更低摩擦的采用路径：继续使用原生工具，同时在个人工作台里查找、关联和继续工作。

建议先做用户明确授权的只读接入，限定目录、可排除记录、可删除索引。不要默认上传所有本机会话。历史导入也不等于远程控制一个已有会话，更不等于搬迁原生 Agent 的完整内部状态。

来源：[Relayhistory](https://github.com/AgentWorkforce/relayhistory)。

### B. 用工作记录承接多个会话

Trajectories 按任务组织阶段、关键决定和成果引用。值得借鉴的是可携带的工作记录结构。其 README 的能力概述与 roadmap 存在成熟度差异，数据库后端、自动采集等不能仅凭概述视为全部已经完成。

Steer 可以先增加一个跨会话的 WorkItem：目标、关联会话、当前成果、已确认决定、未解决问题与来源。用户确认的决定和 Agent 提议分开，修改与撤销可追溯。不要把模型生成的解释当作完整、真实的内部思考，也不要把所有日志塞进工作摘要。

来源：[Trajectories README](https://github.com/AgentWorkforce/trajectories)。

### C. 让变化形成待处理事项

Relayfile 把外部事件转为可读的数据视图。对 Steer 的启发是：外部工作发生变化时，用户回来能看到真正需要处理的事。先选一种来源、一个只读场景即可，例如关联 PR 检查失败后，形成待确认的诊断事项。

不建议第一步就建设通用虚拟文件系统。文件写入能否代表业务成功、缓存时效、权限与冲突都需要独立契约。其“文件比 typed tools 更可靠”的论断应当作为待实验假设；读取聚合和有副作用的写操作可以采用不同接口。

来源：[Relayfile](https://github.com/AgentWorkforce/relayfile)。

### D. 让重复工作逐渐变成程序约束

Flows 将步骤和检查写入代码。其 authoring reference 提供持久化的人类确认等待，命令非零退出也有明确的失败/记录策略。这比在 prompt 中写“务必检查”更可验证。

Steer 可以先把一种用户反复执行的过程做成固定模板。比如资料更新 → 对比变化 → 生成草稿 → 等待用户接受。自然语言用来表达目标，程序负责检查是否满足推进条件。不要一开始要求用户自己维护 TypeScript 流程。

确定的是控制流程和校验规则，Agent 输出本身仍然可能错误；重放还需要处理外部副作用的幂等性。

来源：[Flows](https://github.com/AgentWorkforce/flows)、[Authoring reference](https://github.com/AgentWorkforce/flows/blob/main/packages/surface/AUTHORING.md)。

## 4. 工程上可直接参考的设计

1. **投递与任务完成分开。** 官方 Delivery 文档区分 accepted/delivered/deferred/failed，并描述不同会话边界的投递时机；SDK `runner.ts` 实际包含 ack/defer/fail 分支。用户界面应能区分“已排队”“Agent 已收到”“需要介入”和“任务完成”。投递回执不是业务成功，也不保证副作用只发生一次。
2. **按当前会话声明能力。** Session capabilities 包括投递、事件、生命周期等。不要仅凭 provider 名字推断支持暂停、图片、fork 或恢复；同一 provider 的会话也可能因权限与传输不同而能力不同。
3. **明确观测的可信程度。** SDK 类型区分 exact/inferred/unavailable，活动 reducer 也对推断出的工作状态附带精度。这能避免用户把猜测出的“思考中”当作可靠事实。

源码与文档：[Delivery](https://agentrelay.com/docs/delivery)、[Session Capabilities](https://agentrelay.com/docs/session-capabilities)、[runner.ts 固定版本](https://github.com/AgentWorkforce/relay/blob/c3a92d9c179972963756ebce3fcd106679302934/packages/sdk/src/delivery/runner.ts)、[session/types.ts 固定版本](https://github.com/AgentWorkforce/relay/blob/c3a92d9c179972963756ebce3fcd106679302934/packages/sdk/src/session/types.ts)、[activity-reducer.ts 固定版本](https://github.com/AgentWorkforce/relay/blob/c3a92d9c179972963756ebce3fcd106679302934/packages/sdk/src/session/activity-reducer.ts)。

## 5. 不建议照搬的部分

- 不必把个人工作台变成 Agent 的 Slack。频道/私信是协作机制，用户通常只需要结果、证据与待决策事项。
- 自由通信不能替代权限、任务所有权和文件冲突控制。共享信息不等于共享目录允许并行写。
- 不要同时引入消息引擎、历史服务、文件系统与流程内核，先证明一个持续工作场景，避免运维成本先于收益增长。
- 不根据生态功能列表推断市场成立；本次没有其真实留存、付费或成本数据。
- [自托管说明](https://github.com/AgentWorkforce/relay/blob/main/docs/self-hosting/README.md)明确：自托管 Relaycast 替代的是消息引擎；Cloud 命令、云 sandbox、托管 dashboard 和 shared sessions 等仍需 Cloud 账户。当地 broker 与消息能力可指向自建引擎。它不是现成的全功能自托管个人工作台。

## 6. 对 Steer 的具体建议

暂不替换我们已有 Relay 执行层。当前没有证据证明它能以更低成本覆盖我们的工作区生命周期、原生会话、产物和流式体验；双方控制面职责还有重合，直接叠加可能增加同步与排障负担。

优先做一个小范围实验：

> “Steer 产品定位研究”作为持续工作，关联竞争分析、后续会话、用户确认的判断和待验证假设。几天后回来，先看到当前结论、变化和下一步，再从具体事项进入 Chat。

初期无需引入它的基础设施，只借鉴 WorkItem 与可追溯记录。之后若用户明显需要找回外部工具的历史，再隔离评估 Relayhistory 的格式、许可证、增量索引、删除语义和兼容性；外部事件与 Flows 随真实重复需求逐步加入。

对这次实验，核心指标是隔几天回来后恢复工作的耗时、重复解释次数和用户修正摘要的负担，而不是新增多少 Agent 或流程节点。

**结论：它强化了“跨会话、跨工具持续承载工作”的探索价值；但并没有证明某一种非 Chat 界面已经胜出。Steer 可以借鉴它的数据与执行机制，再自行验证个人工作台应该如何呈现。**
