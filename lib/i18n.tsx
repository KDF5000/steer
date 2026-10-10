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
  'Relay deployment guide': 'Relay 部署指南',
  'Copy Relay Node install command': '复制 Relay Node 安装命令',
  'Relay Node install command copied': 'Relay Node 安装命令已复制',
  Copied: '已复制',
  'Copy command': '复制命令',
  'Refresh discovered Runtimes': '刷新发现的运行环境',
  'Relay Node refresh timed out. Check the Steer Server and Relay Server connection.':
    '刷新 Relay Node 超时，请检查 Steer Server 与 Relay Server 的连接。',
  'Choose an existing Node': '选择已有 Node',
  'Show installed Node': '显示本次安装的 Node',
  'Remove offline Relay Node': '移除离线 Relay Node',
  'No other Relay Nodes are available for this account.':
    '当前账户没有其他可用的 Relay Node。',
  'Waiting for the installed Node to connect. Run the command, then refresh.':
    '正在等待本次安装的 Node 连接。请执行安装命令后刷新。',
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
  return () => {
    window.removeEventListener(languageEvent, update);
    window.removeEventListener('storage', update);
  };
}

function serverInterfaceLanguageSnapshot(): InterfaceLanguage {
  return 'auto';
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

  const language = resolveLanguage(setting);
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
