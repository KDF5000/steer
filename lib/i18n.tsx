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
  'Code block': '代码块',
  "Enter another user's email address.":
    '请输入其他账号的有效邮箱，不能邀请自己。',
  'Enter a valid email address, without a display name.':
    '请输入有效的邮箱地址，不要附带姓名。',
  'You already own this resource. Invite a different account.':
    '你已经是此资源的所有者，请填写其他账号的邮箱。',

  Result: '结果',
  'Search merge requests': '搜索 MR',
  'Workflow read only': '仅查看',
  'Page {page} · {count} merge requests': '第 {page} 页 · {count} 个 MR',

  'Share workflow': '共享流程',
  'My workflows': '我的流程',
  'Workflow source': '流程来源',
  'View this workflow and its results': '仅查看此流程及其运行结果',
  'Includes merge requests, run records and linked conversations. Future runs are visible automatically.':
    '包括 MR、运行记录和关联会话。后续运行自动可见。',
  'The recipient can accept the invitation in Shared with me after signing in.':
    '对方登录后，可在「与我共享」中接受邀请。',
  'The recipient can accept the invitation in Automation after signing in.':
    '对方登录后，可在「自动化」页面中接受邀请。',
  'Invitation sent to {email}.': '已向 {email} 发送邀请。',
  'Confirm revoke': '确认撤销',
  Ownership: '归属',
  'My repositories': '我的仓库',
  'Shared workflows': '与我共享的流程',
  'View result': '查看结果',
  'More actions': '更多操作',
  'Declining…': '正在拒绝…',
  'Leaving…': '正在退出…',
  'After declining, this invitation will be removed. Ask the owner to invite you again if needed.':
    '拒绝后，这条邀请将被移除。之后如需查看，需要请流程所有者重新发送邀请。',
  'Accepted "{name}".': '已接受「{name}」的共享邀请。',
  'Left "{name}".': '已退出「{name}」的共享。',
  'Auto-refresh failed temporarily. Showing the last loaded results.':
    '自动刷新暂时失败，当前仍显示上次已加载的结果。',
  'Repository or shared workflow': '仓库 / 共享流程',
  'No Codebase connection required': '无需配置 Codebase 连接',
  'Workflow, repository, agent, or owner': '流程、仓库、智能体或共享人',
  'Future runs are visible automatically': '后续运行自动可见',
  'Only this workflow is shared. Workspace membership is not granted.':
    '仅共享此流程，不授予工作区成员权限。',
  'Revoke access for {name}?': '撤销 {name} 的访问权限？',
  'No workflows shared with you': '暂无共享给你的流程',
  'Invitations from other people will appear here.':
    '其他人邀请你后，流程会出现在这里。',
  'Workflow or repository': '流程或仓库',
  '{name} invited you to view {workflow}': '{name} 邀请你查看「{workflow}」',
  'Accepting…': '正在接受…',
  'Accept invitation': '接受邀请',
  Decline: '拒绝',
  'View workflow': '查看流程',
  'Shared by {name}': '{name} 共享',
  'Future runs of shared workflows are visible automatically. No Codebase connection is required.':
    '共享流程的后续运行自动可见，无需配置 Codebase 连接。',
  'Decline invitation?': '拒绝此邀请？',
  'Leave workflow sharing?': '退出流程共享？',
  'You will no longer be able to view this workflow and its results.':
    '退出后，你将无法继续查看此流程及其运行结果。',
  'Shared workflow': '共享流程',
  'Workflow information': '流程信息',
  'View merge requests, run records and linked conversations':
    '查看 MR、运行记录和关联会话',
  'Contact the owner to re-run reviews or change this workflow.':
    '需要重跑或调整流程时，请联系流程所有者。',
  'Review task': '审查任务',
  'View review result': '查看审查结果',
  'No review yet': '尚无审查',
  'The review is still running. Results will appear here.':
    '审查仍在执行，结果将自动显示在这里。',

  'Approving automatically': '正在自动批准',
  'Automatically approving tool request…': '正在自动批准工具请求…',
  'Session auto-approval enabled. Resuming…': '已开启本会话自动批准，正在继续…',
  'Always allow in this conversation': '当前会话始终允许',
  'Automatically approve tool requests in this conversation, including later turns. Delegated conversations are separate.':
    '自动批准本会话的工具请求，包括后续追问；委派会话单独授权。',
  'Auto-approval enabled for this conversation': '本会话自动批准',
  'Turn off': '关闭',
  'Updating…': '更新中…',
  'Approval policy could not be updated. Try again.':
    '审批设置更新失败，请重试。',

  'Waiting for approval': '等待审批',
  'Waiting for background tasks': '等待后台任务完成',
  'Waiting for a machine': '待分配机器',
  'Machine unavailable': '机器不可用',
  'Finalizing response': '正在收尾',
  'Tool approval': '工具审批',
  'Approve command execution': '批准执行命令',
  'Approve tool execution': '批准使用工具',
  'Allow once': '允许一次',
  Reject: '拒绝',
  'Submitting…': '提交中…',
  'Approved once. Resuming…': '已允许一次，正在继续…',
  'Rejected. Notifying Agent…': '已拒绝，正在通知 Agent…',
  'A workspace member must handle this approval.': '请由工作区成员处理此审批。',
  'Approval could not be submitted. Try again.': '审批提交失败，请重试。',
  'This tool does not offer permission for a single execution.':
    '此工具不支持仅允许一次执行。',

  'Manage experimental features available in this workspace.':
    '管理当前工作区可用的实验功能。',
  'Configure MR review workflows in Automation, with manual or webhook triggers.':
    '在自动化中配置 MR 审查流程，支持手动发起和 Webhook 自动触发。',
  'Enabling adds Automation to the sidebar. Disabling hides the entry without pausing review workflows.':
    '开启后，侧栏显示“自动化”入口。关闭仅隐藏入口，不会暂停审查流程。',

  'Codebase configured': 'Codebase 已配置',
  'Review could not start. Open the run record for details.':
    '审查未能启动，请打开运行记录查看详情。',
  'Enable this workflow before starting a review.':
    '请先启用此流程，再发起审查。',
  'Connection settings': '连接设置',
  'Codebase connected': 'Codebase 已连接',
  'Configure reviews, track merge requests, and inspect run results.':
    '配置审查流程，跟踪 MR 并查看运行结果。',
  'Search workflows': '搜索流程',
  'Workflow, repository, or agent': '流程、仓库或智能体',
  Paused: '已暂停',
  '{count} workflows': '{count} 个流程',
  'No matching workflows': '没有匹配的流程',
  'Clear filters': '清除筛选',
  'Webhook + manual': 'Webhook / 手动',
  'Manual only': '仅手动',
  'MR writeback on': '回写 MR',
  'Steer results only': '仅保留 Steer 结果',
  '{count} Skills': '{count} 个 Skill',
  'Enable workflow {name}': '启用流程 {name}',
  'Delete workflow': '删除流程',
  'Workflow enabled.': '流程已启用。',
  'Workflow paused.': '流程已暂停。',
  'View workflows': '查看流程',
  'Remove associated workflows before removing this repository.':
    '请先删除关联流程，再移除此仓库。',
  'Review workflow': '审查流程',
  'Choose when starting': '发起时选择',
  'This workflow will review the merge request you select.':
    '使用所选流程审查你发起的 MR。',
  'Review submitted.': '审查任务已提交。',
  'Review could not start.': '审查任务未能启动。',
  'View run': '查看运行记录',
  'Run status': '运行状态',
  'All results': '全部结果',
  'In progress': '进行中',
  'Review succeeded': '审查成功',
  'Review failed': '审查失败',
  '{matched} of {count} loaded runs': '已加载 {count} 条，匹配 {matched} 条',
  'Newest first': '最新在前',
  'Live updates while running': '执行中自动更新',
  Duration: '耗时',
  '{minutes}m {seconds}s': '{minutes}分 {seconds}秒',
  '{seconds}s': '{seconds}秒',
  'No matching runs': '没有匹配的运行记录',
  'Clear status filter': '清除状态筛选',
  'Load more records': '加载更多记录',
  'Showing the latest 500 runs. Select a repository or workflow to narrow the history.':
    '当前展示最近 500 条记录，可按仓库或流程缩小范围。',
  'Execution and output': '执行与输出',
  'Requires a configured Codebase webhook. Turn off for manual reviews only.':
    '需先配置 Codebase Webhook；关闭后仅支持手动发起审查。',
  'Workflow enabled': '启用流程',
  'Paused workflows cannot start new reviews. Running reviews continue.':
    '暂停后不再接受新审查，已启动的任务继续执行。',

  'Preparing Git workspace': '正在准备 Git 工作区',
  'Preparing the workspace': '正在准备工作目录',
  'Starting Runtime': '正在启动 Runtime',
  'Command failed': '命令执行失败',
  'File update failed': '文件更新失败',
  'Search failed': '搜索失败',
  'Tool failed': '工具调用失败',
  'Conversation actions': '会话操作',
  Pinned: '已置顶',
  Archived: '已归档',
  'Pin conversation': '置顶会话',
  'Unpin conversation': '取消置顶',
  'Rename conversation': '重命名会话',
  'Use a short name that describes the task.':
    '用简短的名称描述这段会话的任务。',
  'Could not update conversation.': '无法更新会话。',
  'Conversation access is no longer available.': '此会话的访问权限已失效。',
  'Search workspace': '搜索工作区',
  'Search conversation titles and messages, projects, and results.':
    '搜索会话标题、消息正文、项目和成果。',
  'Search conversations and messages…': '搜索会话和消息…',
  'Last activity': '最近活动时间',
  'Any time': '不限时间',
  'Last 30 days': '最近 30 天',
  'Last 90 days': '最近 90 天',
  'No matching conversations.': '没有匹配的会话。',
  'Searching…': '正在搜索…',
  '{count} matching messages': '匹配 {count} 条消息',
  'Load more': '加载更多',
  'Collaborative conversation': '协作会话',
  Results: '成果',
  'Conversation results': '会话',
  'Delete conversation': '删除会话',
  'Collaborative projects': '协作项目',
  'Shared project': '共享项目',
  'Access revoked': '授权已收回',
  'Agent access has been revoked. You can still view this conversation.':
    '智能体授权已收回，你仍可查看此会话的历史记录。',
  'Accept Agent invitation': '接受智能体邀请',
  'Authorized project unavailable.': '授权项目暂不可用。',
  'Accepting adds the authorized project to your workspace. Click the project to start a private conversation.':
    '接受后，授权项目会出现在你的工作区中。点击项目即可开始私密对话。',
  'No collaborative projects yet.': '暂无协作项目',
  'Unable to load collaborative projects.': '协作项目加载失败',
  You: '你',
  'Accept conversation invitation': '接受会话邀请',
  'You can view messages and start tasks with this conversation’s Agent.':
    '你可以查看消息，并使用此会话的 Agent 发起任务。',
  'You can view this conversation’s messages and results.':
    '你可以查看此会话的消息和结果。',
  'View collaborators': '查看协作者',
  'Can collaborate': '可协作',
  '{count} people': '{count} 人',
  'Conversations shared with you, organized by project.':
    '别人与你共享的会话，按项目组织。',
  'Search projects, conversations, or providers…': '搜索项目、会话或提供者…',
  'Your shared conversations stay in your projects. Manage members from the conversation avatars.':
    '你共享的会话仍在自己的项目下，可通过顶部协作者头像管理成员。',
  'Agents are authorized by their providers. Using one creates a private conversation in your workspace.':
    '智能体由提供者授权；使用时会在你的工作区创建私密会话。',
  'Invite collaboration': '邀请协作',
  'This person is already invited.': '这个成员已经在邀请列表中。',
  'This conversation can only be shared for viewing.':
    '此会话仅支持共享查看权限。',
  'Collaborators can start Agent tasks in this conversation.':
    '可协作的成员可以在此会话发起 Agent 任务。',
  Collaborators: '协作者',
  Owner: '所有者',
  'Only this resource is shared. Your workspace stays private.':
    '仅开放此资源，个人工作区保持私有。',
  'Share view-only link': '分享查看链接',
  'Share a read-only snapshot of this conversation.':
    '分享当前会话的只读内容。',
  'View-only link': '查看链接',
  'Creating link…': '正在生成链接…',
  'Copy the link from the field.': '请从输入框手动复制链接。',
  'Anyone with this link can view the snapshot. Invite collaborators separately.':
    '拿到链接的人可以查看这份内容；参与协作需另行邀请。',
  'Runtime default': 'Runtime 默认模型',
  'Select Agent and model': '选择智能体和模型',
  'Select Effort': '选择 Effort',
  'Follow model default': '跟随模型默认值',
  'Model load': '模型负载',
  'Select model': '选择模型',
  Default: '默认',
  'Back to Agents': '返回智能体',
  'Search models…': '搜索模型…',
  'Follow Agent default': '跟随智能体默认',
  'No matching models': '没有匹配的模型',
  'No model list reported by this Runtime.': '运行环境尚未提供模型列表。',
  'Conversation access': '会话访问权限',
  'Access is limited to this conversation and its authorized execution environment.':
    '仅开放此会话和授权执行环境。',
  'Collaborative conversations': '协作会话',
  Participating: '我参与的',
  'Shared by me': '我共享的',
  'My Agents': '我的智能体',
  'Shared with me': '与我共享',
  'Access shared conversations while keeping your workspace private.':
    '访问共享会话，个人工作区保持私有。',
  'Search shared conversations': '搜索协作会话',
  'Share a conversation from its header to invite someone.':
    '在会话顶部管理共享，邀请其他人参与。',
  'Conversation invitations will appear here.': '收到的会话邀请会显示在这里。',
  'Your conversation': '你的会话',
  'Can execute': '可执行',
  'View only': '可查看',
  Invitations: '个邀请',
  'Pending invitation': '待接受邀请',
  Joined: '已加入',
  'Could not open shared conversation.': '无法打开共享会话。',
  'Accept and open': '接受并打开',
  'Manage sharing': '管理共享',
  'Leave sharing': '退出共享',
  'Agents shared with you will appear here.': '别人共享的智能体会显示在这里。',
  Available: '可使用',
  'View capability': '查看能力',
  'Creates a private conversation in your workspace using the authorized environment.':
    '使用授权环境，在你的工作区创建独立私密会话。',
  'Provided by': '提供者',
  'Directory or repository': '目录或仓库',
  'Execution directory': '执行目录',
  'Independent Git worktree': '独立 Git worktree',
  'Authorized local directory': '授权本地目录',
  'Concurrent tasks': '并发任务数',
  'The provider manages the machine and native execution logs. This does not share your workspace or conversation.':
    '运行机器和原生执行日志由提供者管理。你的工作区和会话不会因此共享。',
  'Decline or leave': '拒绝或退出',
  'Accept and start chatting': '接受并开始聊天',
  'Authorize this Agent for a specific project. Other resources remain private.':
    '指定此智能体可使用的项目，其他资源保持私有。',
  'Invite people to this conversation. Other workspace resources remain private.':
    '邀请其他人访问此会话，工作区其他资源保持私有。',
  'Authorized project': '授权项目',
  'Git projects use independent worktrees. Local projects use the authorized directory.':
    'Git 项目使用独立 worktree，本地项目使用授权目录。',
  Permission: '权限',
  Invite: '邀请',
  'Revoke access': '撤销访问',
  'Share Agent': '共享智能体',
  Shared: '已共享',
  'Private conversation': '私密会话',
  'Back to collaborative conversations': '返回协作会话',
  'This conversation is shared with view permission.': '此会话仅授予查看权限。',
  'This delegated conversation has not been shared.':
    '此委派会话尚未单独共享。',
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
  'Browse and edit every file in this Skill.':
    '浏览并编辑这个 Skill 的全部文件。',
  Files: '文件',
  files: '个文件',
  'Add file': '添加文件',
  'Loading files…': '正在加载文件…',
  binary: '二进制',
  'Delete file': '删除文件',
  'No files yet.': '还没有文件。',
  'Binary file': '二进制文件',
  'Binary files are stored as-is and cannot be edited here.':
    '二进制文件按原样保存，无法在此编辑。',
  'Select a file': '选择一个文件',
  'Choose a file to view its contents.': '选择文件以查看内容。',
  'You have unsaved file changes.': '有未保存的文件修改。',
  'SKILL.md is the entry point used by Agents.':
    'SKILL.md 是智能体使用的入口文件。',
  'Instructions are stored as SKILL.md. Use the Files tab to edit other files.':
    '指令内容保存为 SKILL.md，其他文件请在“文件”中编辑。',
  'Save files': '保存文件',
  'Skill files saved.': 'Skill 文件已保存。',
  'Could not load Skill files.': '无法加载 Skill 文件。',
  'Could not save Skill files.': '无法保存 Skill 文件。',
  'Back to Assets': '返回资产',
  Skill: 'Skill',
  'Created in Steer': '在 Steer 中创建',
  Imported: '已导入',
  'Reusable Agent instructions.': '可复用的智能体指令。',
  'Skill not found.': '未找到 Skill。',
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
  Labs: '实验室',
  Automation: '自动化',
  Experimental: '实验',
  'Experimental features': '实验功能',
  'Enable experimental features to try them in this workspace.':
    '开启实验功能，在当前工作区中体验。',
  'Preferences are saved for this account and workspace in this browser.':
    '开关按当前账号和工作区保存在此浏览器中。',
  'Automated code review': '自动化审查',
  'Connect Codebase and fetch merge requests.':
    '连接 Codebase，获取 Merge Requests。',
  'Agent review is not enabled in this stage.': '当前阶段不执行 Agent Review。',
  'Merge requests are synced; reviews run on demand.':
    'Merge Requests 会同步到本地，可按需发起审查。',
  'Open automation': '进入自动化',
  'Could not save the experiment preference.':
    '无法保存实验开关，请检查浏览器存储权限。',
  'Connect Codebase and fetch merge requests. Agent review is not enabled yet.':
    '连接 Codebase，获取 MR。当前阶段不执行 Agent Review。',
  Workflows: '流程',
  'Review rules': '审查规则',
  'Run records': '运行记录',
  'No review workflows': '尚未配置审查流程',
  'No review rules': '尚未配置审查规则',
  'No review runs': '暂无审查记录',
  Details: '详情',
  'Run details': '运行详情',
  'Failure details': '失败详情',
  'Run summary': '运行结果',
  'Copy log': '复制日志',
  'Copy failed.': '复制失败。',
  Trigger: '触发方式',
  Started: '开始时间',
  Finished: '结束时间',
  'Reasoning effort': '推理强度',
  'No output was recorded for this run.': '本次运行没有记录输出。',
  'This stage only fetches merge requests. It does not create Agent review tasks.':
    '当前阶段仅获取 MR，不创建 Agent Review 任务。',
  'Open Codebase connection': '打开 Codebase 连接',
  'No Codebase connection configured.': '尚未配置 Codebase 连接。',
  'Connection verified': '连接已验证',
  'Connect Codebase': '连接 Codebase',
  'Edit connection': '编辑连接',
  Disconnect: '断开连接',
  'Merge requests': 'Merge Requests',
  'Merge request': 'Merge Request',
  Repository: '仓库',
  'e.g. org/repository': '例如 org/repository',
  Verify: '验证',
  'Repository verified': '仓库已验证',
  'Namespace/project or project ID (optional)':
    '组织/仓库路径或项目 ID（选填）',
  'MR title (optional)': 'MR 标题（选填）',
  Open: '待合并',
  Merged: '已合并',
  Closed: '已关闭',
  All: '全部',
  Draft: '草稿',
  'Fetching…': '正在获取…',
  'Fetch MRs': '获取 MR',
  'Fetching merge requests': '正在获取 Merge Requests',
  Page: '第',
  'merge requests on this page': '条 MR（本页）',
  Previous: '上一页',
  Next: '下一页',
  'No matching merge requests': '没有匹配的 MR',
  'No merge requests fetched': '尚未获取 MR',
  'Fetch MRs to read the current Codebase data.':
    '点击“获取 MR”读取 Codebase 中的最新数据。',
  'Configure the connection before fetching merge requests.':
    '配置连接后即可获取 MR。',
  'Edit Codebase connection': '编辑 Codebase 连接',
  'Use a Codebase App to connect. The server verifies the credential and stores it encrypted.':
    '使用 Codebase App 进行连接，后端验证凭据并加密保存。',
  'Codebase API address': 'Codebase API 地址',
  'Codebase OpenAPI endpoint. Usually the default address works.':
    'Codebase OpenAPI 服务地址，通常使用默认地址即可。',
  'App ID': 'App ID',
  'Create a Codebase App and install it to target repositories to get the App ID.':
    '创建 Codebase App 并安装到目标仓库后，即可获得 App ID。',
  'App Secret': 'App Secret',
  'Leave blank to keep the saved App Secret. Changing the address or App ID requires a new secret.':
    '留空保留已保存的 App Secret。更换地址或 App ID 时需要重新填写。',
  'App Secret is paired with the App ID. Grant repository and merge request read permissions.':
    '与 App ID 配套使用，请授予仓库和 Merge Request 读取权限。',
  'Codebase connection': 'Codebase 连接',
  'Configure Webhook': '配置 Webhook',
  'Edit Webhook': '编辑 Webhook',
  'Enable Webhook': '启用 Webhook',
  'Generate a callback URL to enable receiving events.':
    '生成回调地址后，即可启用事件接收。',
  'Automation workflows will appear here.': '自动化流程将显示在这里。',
  'Published review Skills will appear here.':
    '已发布的审查 Skills 将显示在这里。',
  'Execution records will appear here when workflows run.':
    '流程执行后，可在这里查看运行记录。',
  'Configure a callback to receive Codebase events.':
    '配置回调地址，接收 Codebase 事件。',
  'Callback server address': '回调服务地址',
  'Callback URL': '回调地址',
  Enabled: '已启用',
  'Use a Steer address that Codebase can reach. Localhost only works on this machine.':
    '填写 Codebase 服务能够访问的 Steer 地址。localhost 只能在当前机器使用。',
  'Enter an HTTP(S) server address without a path or credentials.':
    '请填写 HTTP(S) 服务地址，不包含路径或账号密码。',
  'Copy callback URL': '复制回调地址',
  'Replace callback URL': '更换回调地址',
  'Generate callback URL': '生成回调地址',
  'Paste this URL into Codebase Webhook settings and select the MR events you want to receive.':
    '将此地址填入 Codebase 的 Webhook 设置，并选择需要接收的 MR 事件。',
  'Webhook deliveries are saved. Automatic MR updates are not connected yet.':
    '当前回调事件会保存到服务端，MR 列表自动更新尚未接通。',
  'Webhook is active. Workflows with Webhook trigger enabled will receive Codebase MR events.':
    'Webhook 已启用。开启「通过 Webhook 触发审查」的流程会自动接收 Codebase MR 事件。',
  'Enable Webhook above so workflows with Webhook trigger enabled can receive Codebase MR events.':
    '在上方启用 Webhook 后，开启「通过 Webhook 触发审查」的流程即可自动接收 Codebase MR 事件。',
  'Webhook is currently disabled in this workspace. Enable it in Connection settings to trigger reviews automatically.':
    '当前工作区尚未启用 Webhook。请先在「连接设置」中开启回调，否则仅支持手动发起审查。',
  'Go to connection settings': '前往连接设置',
  'Go to merge requests to run': '去合并请求立即运行',
  'Workflow "{name}" created.': '流程「{name}」已创建。',
  'Delete workflow "{name}"?': '删除流程「{name}」？',
  'Model, Skills & trigger options': '模型、Skills 与触发选项',
  'Re-run': '重新运行',
  'Re-running…': '正在重新提交…',
  'Latest review: {status}': '最近审查：{status}',
  'Needs setup': '待配置',
  'Clear search': '清空搜索',
  Dismiss: '关闭',
  'Replace callback URL?': '更换回调地址？',
  'The old callback URL will stop working. Update the URL in Codebase after replacing it.':
    '旧回调地址将立即失效。更换后，请同步更新 Codebase 中的地址。',
  'Webhook settings could not be loaded. Update the server and try again.':
    '无法加载 Webhook 设置，请更新后端服务后重试。',
  'Manage Codebase connections and merge requests.':
    '管理 Codebase 连接与 Merge Requests。',
  'Manage integrations and automation workflows.': '管理外部集成与自动化流程。',
  'Connection unavailable': '连接信息暂不可用',
  'Access token': '访问令牌',
  'Leave blank to keep the saved token. Changing the address requires a new token.':
    '留空保留已保存的令牌。更换地址时需要重新填写令牌。',
  'Use a token with read access to the repositories and merge requests.':
    '使用具有仓库和 MR 读取权限的令牌。',
  Authentication: '认证方式',
  'API configuration': 'API 配置',
  'API prefix': 'API 路径前缀',
  'Currently supports GitLab-compatible REST APIs. Confirm the API prefix with Codebase documentation.':
    '当前支持 GitLab 兼容 REST API，请根据 Codebase 文档确认路径前缀。',
  'Verifying…': '正在验证…',
  'Verify and save': '验证并保存',
  'Disconnect Codebase?': '断开 Codebase 连接？',
  'Remove the saved connection and App credential from this workspace. The Codebase App itself is not deleted.':
    '移除当前工作区保存的连接和 App 凭据，不会删除 Codebase 上的 App。',
  Project: '项目',
  Webhook: 'Webhook',
  'Loading…': '加载中…',
  Workflow: '流程',
  'Workflow name': '流程名称',
  'New workflow': '新建流程',
  'Edit workflow': '编辑流程',
  'Delete workflow?': '删除流程？',
  'Workflow created.': '流程已创建。',
  'Workflow updated.': '流程已更新。',
  'Workflow deleted.': '流程已删除。',
  'All workflows': '全部流程',
  'Select a workflow': '选择流程',
  Reviewer: '审查者',
  'Reviewer agent': '审查智能体',
  'Not assigned': '未分配',
  'Select an agent': '选择智能体',
  'Select a reviewer agent.': '请选择审查智能体。',
  'Create an agent in this workspace first.': '请先在此工作区创建智能体。',
  'Review instruction': '审查指令',
  'Optional guidance for the reviewer, e.g. focus on error handling and tests.':
    '给审查者的可选指引，例如重点关注错误处理和测试。',
  'Trigger review from webhook': '通过 Webhook 触发审查',
  'Verify the repository before saving.': '保存前请先验证仓库。',
  'e.g. Frontend review': '例如 前端审查',
  'Run review': '发起审查',
  'Review started.': '审查已开始。',
  'View MRs': '查看 MR',
  Manual: '手动',
  Queued: '排队中',
  Running: '运行中',
  Succeeded: '成功',
  Failed: '失败',
  Skipped: '已跳过',
  'Connect Codebase first': '请先连接 Codebase',
  'Configure the Codebase connection, then create a workflow to choose a repository.':
    '先配置 Codebase 连接，再创建流程以选择仓库。',
  'Create a workflow to bind a repository, then its merge requests appear here.':
    '创建流程并绑定仓库后，该仓库的 MR 会显示在这里。',
  'No merge requests match the current filters.': '没有符合当前筛选条件的 MR。',
  'Select a workflow to load its merge requests.': '选择一个流程以加载其 MR。',
  'Bind a repository to a reviewer agent. Merge requests are loaded per workflow, and webhook triggers are configured here.':
    '将仓库绑定到审查智能体。MR 按流程加载，Webhook 触发也在此配置。',
  'Bind a repository to a reviewer agent. The repository is verified against the Codebase connection.':
    '将仓库绑定到审查智能体。保存前会通过 Codebase 连接验证仓库。',
  'Create a workflow to bind a repository and reviewer agent.':
    '创建流程，绑定仓库和审查智能体。',
  'Connect Codebase before creating a workflow.':
    '创建流程前请先连接 Codebase。',
  'Run a review from the Merge requests tab to create a record.':
    '在 Merge Requests 页签发起审查后，这里会生成运行记录。',
  'No repositories yet': '尚未绑定仓库',
  'Create a workflow to bind a repository. Merge requests are shared by every workflow that reviews it.':
    '创建流程并绑定仓库。同一仓库的 MR 会被所有审查该仓库的流程共享。',
  'Configure the Codebase connection, then create a workflow to bind a repository.':
    '先配置 Codebase 连接，再创建流程并绑定仓库。',
  'Select a repository': '选择仓库',
  open: '开启中',
  total: '总计',
  'MR title': 'MR 标题',
  Sync: '同步',
  'Syncing…': '正在同步…',
  'Fetch new updates from Codebase. Known merge requests are not re-imported.':
    '从 Codebase 获取新增更新，已入库的 MR 不会重复导入。',
  'Last synced': '上次同步',
  'Not synced yet': '尚未同步',
  'No enabled workflow reviews this repository. Create one to start reviews from this list.':
    '当前没有启用中的流程审查此仓库。请先创建流程后再发起审查。',
  'Create an enabled workflow for this repository first.':
    '请先为此仓库创建并启用一个流程。',
  'Loading merge requests': '正在加载 MR',
  'No merge requests match the current filters. Sync to check for updates.':
    '没有符合当前筛选条件的 MR。可点击同步检查更新。',
  'Sync this repository to import its merge requests.': '同步此仓库以导入 MR。',
  'merge requests': '条 MR',
  'A workflow binds a repository to a reviewer agent. Several workflows can review the same repository with different agents.':
    '流程将仓库绑定到审查智能体。同一仓库可以配置多个流程，由不同智能体审查。',
  'workflows share this repository': '个流程共享此仓库',
  'All repositories': '全部仓库',
  'Synced {created} new and {updated} updated merge requests.':
    '同步完成：新增 {created} 条，更新 {updated} 条 MR。',
  'Merge requests are up to date.': 'MR 已是最新。',
  'Review started with {agent}.': '已由 {agent} 发起审查。',
  'Choose a reviewer': '选择审查流程',
  'Several workflows review this repository. Choose which one should review this merge request.':
    '此仓库有多个审查流程，请选择由哪个流程审查该 MR。',
  'Remove this workflow and its run records. Merge requests are kept while another workflow still reviews the repository.':
    '删除此流程及其运行记录。若仍有其他流程审查同一仓库，已同步的 MR 会保留。',
  'Disconnecting…': '正在断开…',
  'Open in Codebase': '在 Codebase 查看',
  'Reported to merge request': '已回写到 MR',
  'Reporting to merge request…': '正在回写 MR…',
  'Report failed': '回写 MR 失败',
  'Report skipped': '未回写 MR',
  'Write back to MR': '回写 MR',
  'When disabled, results stay in Steer and no MR comment is posted or updated.':
    '关闭后，结果仅保留在 Steer，不会创建或更新 MR 评论。',
  'Selected Skills are added to this review only, alongside the Agent instructions.':
    '所选 Skill 仅用于本流程的审查任务，与智能体自身指令一起生效。',
  'Runs on the Runtime that owns the reviewer Agent.':
    '任务在审查智能体所属的运行环境上执行。',
  'Describe the review focus, checklist, and output format. Long instructions are supported.':
    '说明审查重点、检查清单和输出格式，支持较长指令。',
  'Add Skills to the workspace library before selecting them here.':
    '请先在工作区的 Skill 库添加 Skill，再在此选择。',
  'You can select up to {count} Skills.': '最多选择 {count} 个 Skill。',
  'Show more Skills': '显示更多 Skill',
  'Import from AgentBuddy': '从 AgentBuddy 导入',
  'Close import': '收起导入',
  'Search AgentBuddy Skills': '搜索 AgentBuddy Skill',
  'Importing…': '正在导入…',
  'No Skills in this workspace yet. Import one from AgentBuddy.':
    '当前工作区还没有 Skill，可从 AgentBuddy 导入。',
  'No MR description.': '暂无 MR 描述。',
  Author: '作者',
  Updated: '更新时间',
  Labels: '标签',
  Repositories: '仓库',
  'Add repository': '添加仓库',
  'Add another repository': '添加其他仓库',
  'Remove repository': '移除仓库',
  'Remove repository?': '移除仓库？',
  'Repository path': '仓库路径',
  'Repository added.': '仓库已添加。',
  'Repository removed.': '仓库已移除。',
  'Removing…': '正在移除…',
  Remove: '移除',
  'No workflow': '未关联流程',
  workflows: '个流程',
  'Connect Codebase before adding a repository.':
    '请先连接 Codebase 再添加仓库。',
  'Configure the Codebase connection before adding repositories.':
    '请先配置 Codebase 连接，再添加仓库。',
  'Add a repository to sync its merge requests and bind it to review workflows.':
    '添加仓库后可同步其 MR，并绑定审查流程。',
  'Add a repository to sync its merge requests. Every workflow that reviews it shares the same synced list.':
    '添加仓库后可同步其 MR。所有审查该仓库的流程共享同一份已同步列表。',
  'Enter a Codebase repository path. It is verified against the saved connection before it is added.':
    '填写 Codebase 仓库路径，系统会通过已保存的连接验证后再添加。',
  'Use the namespace/project path shown in Codebase.':
    '请使用 Codebase 中显示的组织/仓库路径。',
  'This removes the repository and its synced merge requests from Steer. Workflows that review it must be deleted first.':
    '这会从 Steer 移除该仓库及其已同步的 MR。审查该仓库的流程需要先删除。',
  'This repository is used by a review workflow. Delete that workflow first.':
    '此仓库仍被审查流程使用，请先删除对应流程。',
  'Pick a managed repository and a reviewer agent. Repositories are added to the workspace once and shared by every workflow.':
    '选择已添加的仓库和审查智能体。仓库只需添加一次，可被多个流程共享。',
  'Add or select a repository before saving.': '保存前请先添加或选择仓库。',
  'Remove this workflow and its run records. The repository and its synced merge requests are kept.':
    '删除此流程及其运行记录，仓库和已同步的 MR 会保留。',
  'Request failed.': '请求失败。',
  'Invalid Codebase connection input.': 'Codebase 连接参数无效，请检查输入。',
  'Codebase token is invalid or expired.': 'Codebase 令牌无效或已过期。',
  'Codebase token does not have permission to read this resource.':
    'Codebase 令牌没有读取此资源的权限。',
  'Could not reach Codebase. Check the server address and network connection.':
    '无法连接 Codebase，请检查地址和服务器网络。',
  'Codebase API or repository was not found. Check the API path and repository permissions.':
    '未找到 Codebase API 或仓库，请检查 API 路径和仓库权限。',
  'Codebase rate limit exceeded. Try again later.':
    'Codebase 请求过于频繁，请稍后重试。',
  'Codebase redirected the API request. Check the API address and token authentication.':
    'Codebase 重定向了 API 请求，请检查 API 地址和令牌认证方式。',
  'Codebase returned an error. Try again later.':
    'Codebase 返回错误，请稍后重试。',
  'Codebase did not return a compatible JSON response. Check the API configuration.':
    'Codebase 未返回兼容的 JSON 数据，请检查 API 配置。',
  'Codebase did not return a compatible user response. Check the API configuration.':
    'Codebase 未返回兼容的用户信息，请检查 API 配置。',
  'Codebase did not return compatible merge requests. Check the API configuration.':
    'Codebase 未返回兼容的 MR 数据，请检查 API 配置。',
  'Enter a new token when changing the Codebase address or authentication settings.':
    '更换 Codebase 地址或认证配置时，请重新填写令牌。',
  'Connect Codebase before fetching merge requests.':
    '请先连接 Codebase，再获取 MR。',
  'Repository must be a project ID or a namespace/project path.':
    '仓库必须填写项目 ID 或组织/仓库路径。',
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
  'Stream replies': '流式回复',
  'Off by default. Send the complete reply when the task finishes.':
    '默认关闭，任务完成后一次性发送完整回复。',
  'Connect a Feishu app bot to an Agent and choose an optional default Project.':
    '将飞书机器人绑定到 Agent，并可选择默认项目。',
  'Default Project': '默认项目',
  'No default Project': '不设置默认项目',
  'Chat Project bindings take priority over the default Project.':
    '聊天中单独绑定的项目优先于默认项目。',
  'Private and group chats use the default Project unless separately bound.':
    '私聊和群聊未单独绑定项目时，使用默认项目。',
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
  'Add Skill': '添加 Skill',
  'Search Skills': '搜索 Skill',
  'No matching Skills': '没有匹配的 Skill',
  'All Skills added': '全部 Skill 已添加',
  'None selected': '未选择',
  '{count} selected': '已选 {count}',
  'Relay installs selected instructions into this Agent’s remote workspace for every run.':
    'Relay 会在每次运行时把选中的指令安装到该智能体的远程工作区。',
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
  Coverage: '覆盖',
  'Usage details': '用量明细',
  'Cache read': '缓存读取',
  'Cache write': '缓存写入',
  'Cache usage is included in input tokens.': '缓存用量已包含在输入 Token 中。',
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
