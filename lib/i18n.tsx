'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

export type InterfaceLanguage = 'auto' | 'zh-CN' | 'en';
type ResolvedLanguage = Exclude<InterfaceLanguage, 'auto'>;
type TranslationValues = Record<string, string | number>;

const storageKey = 'steer.interface-language';
const languageEvent = 'steer:interface-language';

const zhCN: Record<string, string> = {
  'Loading image…': '正在加载图片…',
  'Image preview unavailable': '图片暂时无法预览',
  'Open image preview: {name}': '查看图片：{name}',
  'Show file browser': '展开文件浏览',
  'Hide file browser': '收起文件浏览',
  'Waiting to start': '等待执行',
  Processing: '正在处理',
  Stopping: '正在停止',
  View: '查看',

  'Press Backspace to remove': '按退格键移除',
  'Working in a separate conversation': '正在独立会话中执行',
  'Delegation finished': '委派已结束',
  'Open delegated conversation': '查看委派会话',

  'Quote reply': '引用回复',
  Quote: '引用',
  'View quotation': '查看引用',
  'Remove quotation': '移除引用',
  'Cancel delegation': '取消委派',
  'Delegate to an Agent on this machine': '委派给同机 Agent',
  'No available Agents on this machine': '没有可用的同机 Agent',
  'Delegated reply': '委派回复',
  'Hand back to {agent}': '交给 {agent} 继续',
  "Continue based on {agent}'s result.": '请根据 {agent} 的结果继续推进。',
  'This Agent is unavailable on the conversation machine. Choose another Agent.':
    '该 Agent 不在当前会话机器上，请重新选择。',

  'Getting started': '开始使用',
  'Finish this step and we will guide you to the next one.':
    '完成配置后，将自动引导你进行下一步。',
  'Your workspace is ready. Send your first task to get started.':
    '工作区已准备好，发送第一项任务即可开始。',
  'Bring your Agents into one workspace.': '把你的 Agent 接入同一个工作台。',
  'Four steps to your first conversation. Your progress is saved as you set things up.':
    '四步开始第一次对话。配置完成后，引导会自动更新进度。',
  'Setup progress': '设置进度',
  Completed: '已完成',
  'Connect a machine': '连接运行环境',
  'Install Relay Node on the machine where your Agent tools are available, then add its Runtimes to this workspace.':
    '在已安装 Agent 工具的机器上安装 Relay Node，再将运行环境添加到当前工作区。',
  'Create your first Agent': '添加第一个智能体',
  'Choose a Runtime and model, then give your Agent a name and instructions.':
    '选择运行环境和模型，为智能体设置名称与指令。',
  'Add your project': '添加项目',
  'Select a directory on your machine or connect a Git repository. Your conversations will live under this project.':
    '选择机器上的目录或接入 Git 仓库，在项目下组织你的会话。',
  'Start a conversation': '开始聊天',
  'Choose your Agent and project, then describe the first task you want to work on.':
    '选择智能体和项目，描述你想完成的第一项任务。',
  'Start chatting': '开始聊天',
  'Skip for now': '暂时跳过',
  'You can return to this guide from the sidebar.':
    '可以随时从侧栏重新打开引导。',
  Manage: '管理',
  'Account menu': '账户菜单',
  'Add document': '添加文档',
  'Add Runtime': '添加运行环境',
  'Add project': '添加项目',
  'Add to log': '添加到日志',
  '⌘ / Ctrl + Enter to add': '⌘ / Ctrl + Enter 快速添加',
  'Add to workspace': '添加到工作区',
  'Runtime disconnected from this workspace.': 'Runtime 已从当前工作区断开。',
  'Disconnect Runtime from workspace': '从工作区断开 Runtime',
  'Could not disconnect Runtime.': '无法断开 Runtime。',
  'AI & automation': 'AI 与自动化',
  'Agent workspace': '智能体工作台',
  Agent: '智能体',
  Agents: '智能体',
  'Ask a question or describe a task…': '提出问题或描述一项任务…',
  Artifacts: '产物',
  Assets: '资产',
  Automatic: '自动',
  Cancel: '取消',
  Chat: '对话',
  Close: '关闭',
  Concurrency: '并发数',
  Configure: '配置',
  'Create Agent': '创建智能体',
  'Edit Agent': '编辑智能体',
  'Create Project': '创建项目',
  'Create workspace': '创建工作区',
  'Create skill': '创建 Skill',
  'Daily records': '每日记录',
  Delete: '删除',
  Edit: '修改',
  'Delete Agent': '删除智能体',
  'Delete this conversation?': '删除此对话？',
  'Deleting…': '正在删除…',
  'Delete project': '删除项目',
  Documents: '文档',
  English: 'English',
  'Edit project': '编辑项目',
  'Copy Project ID': '复制 Project ID',
  'Project ID copied.': 'Project ID 已复制。',
  'Copy Agent ID': '复制 Agent ID',
  'Agent ID copied.': 'Agent ID 已复制。',
  General: '通用',
  Generate: '生成',
  Import: '导入',
  'Import Skill': '导入 Skill',
  'Interface language': '界面语言',
  'AI output language': 'AI 输出语言',
  'Language used throughout the Steer interface.': 'Steer 界面中使用的语言。',
  'Language used by the System Agent for generated summaries.':
    'System Agent 生成整理结果和周报时使用的语言。',
  'Loading earlier entries…': '正在加载更早的记录…',
  'Loading Steer…': '正在加载 Steer…',
  'Loading work log…': '正在加载工作日志…',
  'Loading conversation…': '正在加载对话…',
  'Loading workspace…': '正在加载工作区…',
  'Load earlier': '加载更早记录',
  'New chat': '新对话',
  'New Agent': '新建智能体',
  'New skill': '新建 Skill',
  'No project': '无项目',
  'No project selected': '未选择项目',
  'No agents available': '暂无可用智能体',
  'No records': '暂无记录',
  'No summary yet': '尚未生成总结',
  Projects: '项目',
  Refresh: '刷新',
  'Refreshing…': '正在刷新…',
  Retry: '重试',
  Runtimes: '运行环境',
  Save: '保存',
  'Save changes': '保存修改',
  Search: '搜索',
  'Select project': '选择项目',
  'Send message': '发送消息',
  Settings: '设置',
  'Settings updated.': '设置已更新。',
  'API access': 'API 访问',
  'Use API keys to submit Agent tasks from other tools.':
    '使用 API Key 从其他工具提交 Agent 任务。',
  Integrations: '集成',
  'Connect this workspace to messaging platforms.':
    '将当前工作区连接到消息平台。',
  'Connect Feishu': '连接飞书',
  'Loading integrations…': '正在加载集成…',
  'No integrations yet.': '尚未配置集成。',
  'Unknown Agent': '未知 Agent',
  Connected: '已连接',
  'Connecting…': '正在连接…',
  Disabled: '已停用',
  'Needs attention': '需要处理',
  Reconnect: '重新连接',
  Disable: '停用',
  Enable: '启用',
  'Edit Feishu integration': '编辑飞书集成',
  'Connect a Feishu app bot to an Agent in this workspace. Choose a Project later with bot commands.':
    '将飞书应用机器人绑定到当前工作区的 Agent，之后通过机器人指令选择项目。',
  'Bot configuration': '机器人配置',
  'Enter the credentials from the Feishu developer console.':
    '填写飞书开发者后台中的应用凭证。',
  'Task routing': '任务路由',
  'Choose which Agent handles messages. Project is selected separately in Feishu.':
    '选择由哪个 Agent 处理机器人消息；项目在飞书会话中单独选择。',
  'In Feishu, send /projects to list projects and /project <project name> to bind the current chat or thread.':
    '在飞书中发送 /projects 查看项目，发送 /project <项目名称> 为当前单聊或话题绑定项目。',
  'Choose a Project after connecting': '连接后在飞书中选择项目',
  'List available Projects': '查看可用项目',
  'Project name': '项目名称',
  'Bind this chat or thread': '绑定当前单聊或话题',
  'Feishu App ID': '飞书 App ID',
  'Feishu App Secret': '飞书 App Secret',
  'Integration name': '集成名称',
  'Shown only in Steer': '仅用于 Steer 内部识别',
  'e.g. Engineering assistant': '例如：研发助手',
  Configured: '已配置',
  'Leave blank to keep the current secret': '留空以保留当前 Secret',
  'Enable after saving': '保存后立即启用',
  'Start the bot connection immediately after saving.':
    '保存配置后立即建立机器人长连接。',
  'Required Feishu setup': '飞书侧必要配置',
  'View the three required configuration steps.':
    '查看飞书后台的三项必要配置。',
  'Enable Bot capability in the Feishu developer console.':
    '在飞书开发者后台启用机器人能力。',
  'Grant private-message, group mention, send-as-bot, and message read permissions.':
    '开通单聊消息、群聊 @、机器人发消息和读取消息权限。',
  'Subscribe to im.message.receive_v1 using long connection mode, then publish the app.':
    '使用长连接订阅 im.message.receive_v1，然后发布应用。',
  'Feishu integration saved.': '飞书集成已保存。',
  'Feishu integration deleted.': '飞书集成已删除。',
  'Reconnecting Feishu…': '正在重新连接飞书…',
  'Delete Feishu integration?': '删除飞书集成？',
  'The bot will disconnect immediately. Existing Steer conversations will be kept.':
    '机器人将立即断开连接，已有 Steer 会话会被保留。',
  'Generate API key': '生成 API Key',
  'Loading API keys…': '正在加载 API Key…',
  'No API keys yet.': '尚未创建 API Key。',
  Revoked: '已撤销',
  'Last used': '最后使用',
  'Never used': '从未使用',
  Revoke: '撤销',
  'API key ready': 'API Key 已生成',
  'Copy this key now. You will not be able to see it again.':
    '请立即复制并妥善保存，此后将无法再次查看。',
  'This key can submit, read, and cancel tasks in this workspace.':
    '此 Key 可以在当前工作区提交、读取和取消任务。',
  'Copy API key': '复制 API Key',
  'For example: Local automation': '例如：本地自动化',
  'Permissions: read, submit, and cancel Agent tasks.':
    '权限：读取、提交和取消 Agent 任务。',
  'API key generated.': 'API Key 已生成。',
  'API key copied.': 'API Key 已复制。',
  'API key revoked.': 'API Key 已撤销。',
  'Revoke API key?': '撤销 API Key？',
  'Any integration using this key will immediately lose access.':
    '所有使用此 Key 的集成将立即失去访问权限。',
  'Revoking…': '正在撤销…',
  'Sign in': '登录',
  'Sign out': '退出登录',
  'Simplified Chinese': '简体中文',
  Skills: 'Skills',
  System: '系统',
  'Switch workspace': '切换工作区',
  'System default': '跟随系统',
  Status: '状态',
  Stop: '停止',
  'Stop generating': '停止生成',
  Update: '更新',
  Week: '第',
  'Week {number}': '第 {number} 周',
  'Week {number} summary': '第 {number} 周总结',
  '{count} records': '{count} 条记录',
  'Weekly summaries': '周报',
  Workspace: '工作区',
  'Work log': '工作日志',
  'Choose a valid date range of up to 32 days.':
    '请选择有效的日期范围，最多 32 天。',
  Footprints: '足迹',
  'Review the work that happened in Steer and keep every step traceable.':
    '回看在 Steer 发生的工作，让每一次推进都有迹可循。',
  Overview: '概览',
  Reports: '报告',
  'Generate report': '生成报告',
  'Saved reports': '已保存的报告',
  'No reports yet': '还没有报告',
  'Choose a range and generate your first work report.':
    '选择时间范围，生成你的第一份工作报告。',
  Today: '今天',
  'Last 7 days': '近 7 天',
  Custom: '自定义',
  'Start date': '开始日期',
  'End date': '结束日期',
  'Filter by project': '按项目筛选',
  'All projects': '全部项目',
  'Loading footprints…': '正在加载足迹…',
  'Active conversations': '活跃会话',
  '{count} started in this range': '其中 {count} 个在此期间发起',
  'Your messages': '你的消息',
  'Messages sent by you': '按你发送的消息计数',
  'Agent replies': 'Agent 回复',
  'Tool calls and stream chunks excluded': '不包含工具调用与流式片段',
  'Known token usage': '已知 Token 用量',
  Input: '输入',
  Output: '输出',
  'Usage coverage': '用量统计覆盖',
  runs: '个任务',
  'Token usage is not available yet': '暂未获取到 Token 用量',
  'Partially reported': '部分上报',
  '{count} partially reported': '{count} 个部分上报',
  'Cache tokens are included in input; reasoning is included in output.':
    '输入已包含缓存 Token；输出已包含思考 Token。',
  'Token usage is assigned to the run completion date.':
    'Token 用量按任务结束日期统计。',
  'Token usage': 'Token 用量',
  'Runtime usage was not reported': 'Runtime 未上报用量',
  'Activity trend': '活动趋势',
  'See when work happened': '看看工作在哪些日子发生',
  Messages: '消息量',
  Conversations: '会话数',
  'Select a date to filter conversations.':
    '点击日期，查看当天最近活跃的会话。',
  'Statistics timezone': '统计时区',
  'Showing {from}–{to} of {total} conversations':
    '显示 {from}–{to} 条，共 {total} 个会话',
  'Rows per page': '每页条数',
  'Conversation pagination': '会话明细分页',
  'Previous page': '上一页',
  'Next page': '下一页',
  'Page {page} of {pages}': '第 {page} / {pages} 页',
  'Conversation details': '会话明细',
  '{count} conversations': '{count} 个会话',
  '{count} source conversations': '{count} 个来源会话',
  'Sorted by recent activity': '按最近活动排序',
  'Conversation / Project': '会话 / 项目',
  'Open conversation': '打开会话',
  Token: 'Token',
  'Recent activity': '最近活动',
  'New conversation': '新会话',
  'Not reported': '未上报',
  'No activity in this range': '这个范围内还没有活动',
  'Try another date or project.': '试试其他日期或项目。',
  'Message counts only include the selected range.':
    '消息数量仅统计所选时间范围。',
  'Token coverage': '用量覆盖',
  'Footprints only include activity inside Steer. Message and token counts do not measure work outcomes.':
    '足迹仅包含 Steer 内的活动；消息数量与 Token 用量不代表工作成果。',
  'Report saved.': '报告已保存。',
  'Back to reports': '返回报告列表',
  'Edit report': '编辑报告',
  'Report draft': '报告草稿',
  'Only messages inside this range will be summarized.':
    '只总结所选范围内的消息。',
  'Report title': '报告名称',
  Organization: '组织方式',
  'Group by project': '按项目归纳',
  'Group by day': '按日期回顾',
  'Additional instructions': '补充要求',
  Optional: '可选',
  'For example: focus on product decisions and list follow-ups separately.':
    '例如：重点总结产品决策，并单独列出待跟进事项。',
  'The report includes source conversations. Verify completion claims before sharing it.':
    '报告会附带来源会话；分享前请核对完成状态与结论。',
  'Generating report…': '正在生成报告…',
  'Report ready': '报告已生成',
  'You can keep working while the system Agent reviews the selected conversations.':
    '系统 Agent 正在整理所选会话，你可以继续处理其他工作。',
  'Report content': '报告内容',
  'Export Markdown': '导出 Markdown',
  'Save report': '保存报告',
  'Saving…': '正在保存…',
  'Basic preferences for Steer.': 'Steer 的基础偏好设置。',
  'Manage how Steer works across this workspace.':
    '管理 Steer 在此工作区中的运行方式。',
  'System Agent': 'System Agent',
  'Choose the Agent Steer uses for workspace-level AI features.':
    '选择 Steer 用于工作区级 AI 功能的智能体。',
  'Not configured': '未配置',
  'Select an Agent': '选择智能体',
  'Review outcomes first, then trace them back to daily records.':
    '先回顾成果，再追溯到每天的工作记录。',
  'Generate a concise weekly report from these daily records.':
    '根据这些每日记录生成简洁周报。',
  'Summary ready': '总结已就绪',
  'Not summarized': '尚未总结',
  'Generating…': '正在生成…',
  'Starting weekly summary…': '正在启动周报生成…',
  'Summarize today’s Agent activity': '整理今天的智能体活动',
  'Starting summary…': '正在启动整理…',
  'Summary in progress': '正在整理',
  'Summary ready to review': '整理结果待确认',
  'Review today’s draft': '确认今天的草稿',
  'Could not generate the summary': '无法生成整理结果',
  'Summarizing today’s Agent activity': '正在整理今天的智能体活动',
  'Running in the background. You can keep working or return later.':
    '任务正在后台运行，你可以继续工作或稍后返回。',
  'Keep outcomes, decisions, and next steps together with the conversations behind them.':
    '将成果、决策、后续行动及其相关对话集中记录。',
  'What moved forward? Record an outcome, a decision, or where to pick up next…':
    '今天推进了什么？记录成果、决策或下一步从哪里继续…',
  'Workspace library': '工作区资产库',
  'Workspace unavailable': '工作区不可用',
  'Reusable instructions for Agents and reference links for you.':
    '管理供智能体复用的指令和你的参考链接。',
  'Create your first Skill': '创建第一个 Skill',
  'Add a reference document': '添加参考文档',
  'Document link saved.': '文档链接已保存。',
  'Skill saved.': 'Skill 已保存。',
  'Relay connected': 'Relay 已连接',
  'Relay not connected': 'Relay 未连接',
  'Public Relay address': 'Relay 公网地址',
  'Install a new Relay Node': '安装新的 Relay Node',
  'Generate installation command': '生成安装命令',
  'This one-time enrollment token expires in 15 minutes.':
    '此一次性认领令牌将在 15 分钟后过期。',
  'Your Relay Nodes': '你的 Relay Node',
  'Select Runtime instances to share with this workspace.':
    '选择要共享给当前工作区的运行环境。',
  'No Relay Nodes owned by your account were found. Install a Node, then refresh.':
    '未找到属于当前账户的 Relay Node。安装 Node 后请刷新。',
  'Runtime nodes': '运行节点',
  Runtime: '运行环境',
  Model: '模型',
  Node: '节点',
  Location: '位置',
  Load: '负载',
  'Runtime environments': '运行环境',
  'No Runtime instances': '暂无运行环境实例',
  'Start Relay Server and connect at least one Relay Node.':
    '请启动 Relay Server，并至少连接一个 Relay Node。',
  'Configure reusable roles, models, and Runtime scheduling preferences.':
    '配置可复用的角色、模型和运行环境调度偏好。',
  'View execution nodes, Runtime versions, and capacity managed by Relay.':
    '查看由 Relay 管理的执行节点、运行环境版本和容量。',
  'Agents define reusable behavior; Runtimes are execution processes on local or remote machines.':
    '智能体定义可复用的行为；运行环境是在本地或远程机器上执行任务的进程。',
  'Online · heartbeat just now': '在线 · 刚刚收到心跳',
  'Online · last heartbeat {time}': '在线 · 最后心跳 {time}',
  'Offline · last heartbeat {time}': '离线 · 最后心跳 {time}',
  'unknown time': '时间未知',
  'Version unavailable': '版本不可用',
  'Create an Agent to start': '创建智能体后开始',
  'Connect a Runtime through Relay, then create an Agent.':
    '先通过 Relay 连接运行环境，然后创建智能体。',
  'What would you like to work on?': '你想处理什么？',
  'Select Agent': '选择智能体',
  'Select Project': '选择项目',
  'Open review panel': '打开审查面板',
  'Toggle sidebar': '展开或收起侧边栏',
  'Scroll to latest message': '滚动到最新消息',
  'This conversation is pinned to another Runtime':
    '此对话已固定到其他运行环境',
  'Different Runtime': '其他运行环境',
  'Choose how Steer handles workspace AI tasks.':
    '设置 Steer 如何处理工作区中的 AI 任务。',
  'Used for work log summaries and future AI features.':
    '用于工作日志整理及后续 AI 功能。',
  'Connect a local or remote machine to Relay. Installed Runtime CLIs are discovered automatically.':
    '将本地或远程机器连接到 Relay，已安装的运行环境 CLI 会被自动发现。',
  'Steer Server can reach Relay.': 'Steer Server 可以访问 Relay。',
  'Run this on the machine where Codex, Trae, or another Runtime is installed.':
    '请在安装了 Codex、Trae 或其他运行环境的机器上执行此命令。',
  'Install once on the machine where Codex, Trae, or another Runtime is available. The installation will belong to your account.':
    '只需在可使用 Codex、Trae 或其他运行环境的机器上安装一次，安装后的 Node 将归属于你的账户。',
  'Install once on the machine where Codex, Trae, Qoder, QwenWork, or another Runtime is available,':
    '在可使用 Codex、Trae、Qoder、千问办公或其他运行环境的机器上执行一次安装，',
  QwenWork: '千问办公',
  'Already have a Relay Node?': '已有 Relay Node？',
  'Back to adding a Runtime': '返回添加运行环境',
  'Choose Runtime instances from Relay Nodes owned by your account.':
    '从当前账户已有的 Relay Node 中选择运行环境并添加到工作区。',
  'Generating installation command…': '正在生成安装命令…',
  'Click to generate installation command': '点击生成安装命令',
  'The one-time enrollment token expires 15 minutes after it is generated.':
    '生成后的一次性认领令牌将在 15 分钟后过期。',
  'Detect the new Node': '检测新 Node',
  'Detection starts automatically after the installation command is generated.':
    '生成安装命令后将自动开始检测。',
  'Waiting for command': '等待生成命令',
  'Run the installation command. The new machine will appear here automatically.':
    '执行安装命令后，新机器会自动显示在这里。',
  'Waiting for the installed Node to connect…': '正在等待本次安装的 Node 连接…',
  'Available Relay Nodes': '可用的 Relay Node',
  'No Runtime CLI was discovered on this Node.':
    '此 Node 上未发现可用的运行环境 CLI。',
  'This Node is offline. Check the Relay Node service and refresh.':
    '此 Node 当前离线，请检查 Relay Node 服务后刷新。',
  'Relay deployment guide': 'Relay 部署指南',
  'Copy Relay Node install command': '复制 Relay Node 安装命令',
  'Relay Node install command copied': 'Relay Node 安装命令已复制',
  Copied: '已复制',
  'Copy command': '复制命令',
  'Refresh discovered Runtimes': '刷新发现的运行环境',
  'Relay Node refresh timed out. Check the Steer Server and Relay Server connection.':
    '刷新 Relay Node 超时，请检查 Steer Server 与 Relay Server 的连接。',
  'Choose an existing Node': '选择已有 Node',
  'Installed Node': '本次安装',
  'Remove offline Relay Node': '移除离线 Relay Node',
  'This removes the offline Node and its unused Runtime bindings from Steer. Conversation history is preserved and will select an available Runtime on its next turn. If an Agent or Project still uses this Node, migrate it first.':
    '这会从 Steer 中移除离线 Node 及其未使用的 Runtime 绑定。对话历史会保留，并在下次继续时选择可用的 Runtime。如果仍有智能体或项目使用此 Node，请先完成迁移。',
  'No other Relay Nodes are available for this account.':
    '当前账户没有其他可用的 Relay Node。',
  'Waiting for the installed Node to connect. Run the command, then refresh.':
    '正在等待本次安装的 Node 连接。请执行安装命令后刷新。',
  'Generate an installation command above to track the new Node here.':
    '请先在上方生成安装命令，本次安装的 Node 会显示在这里。',
  'Adding…': '正在添加…',
  'Projects, conversations, Agents, and Runtimes stay isolated inside this workspace.':
    '项目、对话、智能体和运行环境在此工作区内相互隔离。',
  Name: '名称',
  'Creating…': '正在创建…',
  'Try again': '重试',
  'Resize sidebar': '调整侧边栏宽度',
  'No results.': '未找到结果。',
  'Search projects, artifacts, or pages…': '搜索项目、产物或页面…',
  'Create an account': '创建账户',
  'Create account': '创建账户',
  'Create your account': '创建账户',
  'Welcome back': '欢迎回来',
  'Sign in to open your workspaces.': '登录以打开你的工作区。',
  Email: '邮箱',
  Password: '密码',
  'Display name': '显示名称',
  'Please wait…': '请稍候…',
  'New to Steer?': '第一次使用 Steer？',
  'Already have an account?': '已有账户？',
  'Your first private workspace will be ready immediately.':
    '你的第一个私人工作区将立即创建。',
};

function resolveLanguage(language: InterfaceLanguage): ResolvedLanguage {
  if (language !== 'auto') return language;
  if (typeof navigator !== 'undefined' && navigator.languages) {
    return navigator.languages.some((value) =>
      value.toLowerCase().startsWith('zh'),
    )
      ? 'zh-CN'
      : 'en';
  }
  return 'en';
}

export function setInterfaceLanguage(language: InterfaceLanguage) {
  try {
    window.localStorage.setItem(storageKey, language);
  } catch {
    // The persisted workspace setting remains the source of truth.
  }
  window.dispatchEvent(new CustomEvent(languageEvent, { detail: language }));
}

function interfaceLanguageSnapshot(): InterfaceLanguage {
  try {
    const value = window.localStorage.getItem(storageKey);
    if (value === 'en' || value === 'zh-CN' || value === 'auto') return value;
  } catch {
    // Use the default until workspace settings load.
  }
  return 'auto';
}

function subscribeInterfaceLanguage(onChange: () => void) {
  const update = () => onChange();
  window.addEventListener(languageEvent, update);
  window.addEventListener('storage', update);
  window.addEventListener('languagechange', update);
  return () => {
    window.removeEventListener(languageEvent, update);
    window.removeEventListener('storage', update);
    window.removeEventListener('languagechange', update);
  };
}

function serverInterfaceLanguageSnapshot(): InterfaceLanguage {
  return 'auto';
}

function resolvedLanguageSnapshot(): ResolvedLanguage {
  return resolveLanguage(interfaceLanguageSnapshot());
}

function serverResolvedLanguageSnapshot(): ResolvedLanguage {
  return 'en';
}

type I18nContextValue = {
  language: ResolvedLanguage;
  setting: InterfaceLanguage;
  t: (key: string, values?: TranslationValues) => string;
};

const I18nContext = createContext<I18nContextValue>({
  language: 'en',
  setting: 'auto',
  t: (key) => key,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const setting = useSyncExternalStore(
    subscribeInterfaceLanguage,
    interfaceLanguageSnapshot,
    serverInterfaceLanguageSnapshot,
  );

  // Match the server's initial language during hydration, then resolve the
  // browser preference. Reading navigator during hydration can mismatch SSR.
  const language = useSyncExternalStore(
    subscribeInterfaceLanguage,
    resolvedLanguageSnapshot,
    serverResolvedLanguageSnapshot,
  );
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const t = useCallback(
    (key: string, values?: TranslationValues) => {
      const template = language === 'zh-CN' ? zhCN[key] || key : key;
      if (!values) return template;
      return Object.entries(values).reduce(
        (result, [name, value]) =>
          result.replaceAll(`{${name}}`, String(value)),
        template,
      );
    },
    [language],
  );
  const value = useMemo(
    () => ({ language, setting, t }),
    [language, setting, t],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
