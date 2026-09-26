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
  'Add to workspace': '添加到工作区',
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
  'Create Project': '创建项目',
  'Create workspace': '创建工作区',
  'Create skill': '创建 Skill',
  'Daily records': '每日记录',
  Delete: '删除',
  'Delete this conversation?': '删除此对话？',
  'Deleting…': '正在删除…',
  'Delete project': '删除项目',
  Documents: '文档',
  English: 'English',
  'Edit project': '编辑项目',
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
  Search: '搜索',
  'Select project': '选择项目',
  'Send message': '发送消息',
  Settings: '设置',
  'Settings updated.': '设置已更新。',
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
  'Install Relay Node': '安装 Relay Node',
  'Discovered Runtimes': '发现的运行环境',
  'Select which Runtimes this workspace may use.':
    '选择此工作区可以使用的运行环境。',
  'No unassigned Runtimes found. Start or restart Relay Node, then refresh.':
    '未发现可分配的运行环境。请启动或重启 Relay Node 后刷新。',
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
  'Relay deployment guide': 'Relay 部署指南',
  'Copy Relay Node install command': '复制 Relay Node 安装命令',
  'Relay Node install command copied': 'Relay Node 安装命令已复制',
  Copied: '已复制',
  'Copy command': '复制命令',
  'Refresh discovered Runtimes': '刷新发现的运行环境',
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
