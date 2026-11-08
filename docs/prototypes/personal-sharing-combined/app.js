const paths = {
  share:
    '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4m-6.8 7 6.8 4"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l3 4h6a2 2 0 0 1 2 2v10H3Z"/>',
  chat: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9H13a8.5 8.5 0 0 1 8 8v.5Z"/>',
  bot: '<rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 7V3M1 12h3m16 0h3M9 12v2m6-2v2m-6 3h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10" cy="10" r="7"/><path d="m16 16 5 5"/>',
  arrow: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="m12 5-7 7 7 7m-7-7h16"/>',
  send: '<path d="m22 2-7 20-4-9L2 9 22 2Zm-11 11 11-11"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V3H3v13h5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  inbox: '<path d="M4 4h16l2 12v4H2v-4L4 4Zm-2 12h6l2 3h4l2-3h6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  file: '<path d="M14 2H4v20h16V8l-6-6Zm0 0v6h6M8 13h8M8 17h8"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="m9 3-1 3-3 1-2 3 2 3 1 4 3 1 3 3 3-2 3-1 1-4 2-3-2-3-3-1-1-3Z"/>',
};
const icon = (n) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[n] || paths.chat}</svg>`;
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
const state = {
  concept: 'combined',
  identity: 'owner',
  view:
    new URLSearchParams(location.search).get('scene') === 'agents'
      ? 'agents'
      : 'collaboration',
  tab: 'owned',
  agentTab: 'mine',
  panel: false,
  invite: true,
  agentInvite: false,
  permission: 'participate',
  mode: 'task',
  messages: [],
  working: false,
  accepted: false,
  agentAccepted: false,
  agentUsed: false,
  query: '',
  members: [
    { email: 'linyue@example.com', role: 'participate', kind: 'session' },
  ],
  created: false,
};
const concepts = {
  a: {
    label: 'A · 集中共享入口',
    note: '共享内容独立集中在“共享给我”，自己的项目保持原样。适合共享对象逐渐增多。',
  },
  b: {
    label: 'B · 融入日常工作台',
    note: '共享会话直接进入侧栏，共享 Agent 在智能体列表内使用，来源始终可见。适合频繁协作。',
  },
  c: {
    label: 'C · 共享收件箱',
    note: '邀请先进入收件箱，在右侧面板确认对象、权限和执行来源，再进入自己的工作流。适合偶尔共享。',
  },
};
function row(action, name, ico, small = '', active = false, extra = '') {
  return `<button class="navrow ${active ? 'active' : ''} ${extra}" data-action="${action}">${icon(ico)}<span class="label">${name}</span>${small ? `<small>${small}</small>` : ''}</button>`;
}
function sidebar() {
  const guest = state.identity === 'guest';
  document.querySelector('#sidebar').innerHTML = `
 <div class="brand"><img src="../../../website/public/favicon.svg" alt="Steer"><div><strong>Steer</strong><small>${guest ? '林悦' : 'Alex'} 的个人空间</small></div></div>
 <label class="search">${icon('search')}<input id="search" placeholder="搜索会话与智能体" value="${esc(state.query)}"></label>
 ${row('private-session', '新对话', 'plus')}
 <div class="group-label">项目</div>
 ${row('private-session', guest ? '我的工具箱' : 'Steer', 'folder')}
 ${row(guest ? 'private-session' : 'session', guest ? '自己的探索与记录' : '登录重连与异常处理', 'chat', '', state.view === (guest ? 'private-session' : 'session'), 'session-nav')}
 ${!guest ? row('private-session', '模型配置探索', 'chat', '', '', 'session-nav') : ''}
 ${state.created && guest ? `<div class="group-label">授权项目 · Steer</div>${row('agent-session', '检查接口与数据归属', 'chat', 'Reviewer', state.view === 'agent-session', 'session-nav')}` : ''}
 <div class="group-label">工作区</div>
 ${row('collaboration', '协作会话', 'share', guest && !state.accepted ? '1' : '', state.view === 'collaboration')}
 ${row('assets', '资产', 'file')}${row('footprints', '足迹', 'file')}${row('artifacts', '产物', 'folder')}
 <div class="group-label">系统</div>${row('settings', '设置', 'settings')}${row('agents', '智能体', 'bot', '', state.view === 'agents')}${row('runtime', '运行环境', 'settings')}
 <div class="user"><span class="avatar">${guest ? '林' : 'A'}</span><div>${guest ? '林悦' : 'Alex'}<small>${guest ? 'linyue' : 'alex'}@example.com</small></div></div>`;
}
function topbar() {
  const guest = state.identity === 'guest';
  const shared = state.view === 'session';
  const title = shared
    ? '登录重连与异常处理'
    : state.view === 'agent-session'
      ? '检查接口与数据归属'
      : state.view === 'agents'
        ? '智能体'
        : state.view === 'collaboration'
          ? '协作会话'
          : '自己的探索与记录';
  document.querySelector('#topbar').innerHTML =
    `<button class="mobile-nav" data-action="menu" aria-label="打开导航">${icon('menu')}</button>${shared ? `<button class="back-collaboration" data-action="collaboration" aria-label="返回协作会话">${icon('back')}</button>` : ''}<div class="title"><strong>${title}</strong><small>${shared ? `Alex 的会话 · Steer · ${state.accepted ? '2 位参与者' : '1 位参与者，1 个待接受邀请'}` : state.view === 'agent-session' ? '林悦的独立会话 · 使用 Alex 提供的 Reviewer' : '个人 Workspace · 只开放主动共享的对象'}</small></div>${shared ? `<div class="people"><span class="avatar">A</span>${state.accepted ? '<span class="avatar blue">林</span>' : ''}</div><button data-action="${guest ? 'permissions' : 'share-session'}">${icon('share')}${guest ? '访问权限' : '管理共享'}</button>` : ''}${state.view === 'private-session' && !guest ? `<span class="pill">仅自己可见</span>` : ''}`;
}
function baseMessages() {
  return `<div class="message user"><div class="author">Alex · 10:24</div><div class="bubble">检查登录重连流程，补上连接断开后的重试和错误提示。</div></div><div class="message"><div class="response-status">Builder | Completed in 37s ›</div><p>已完成登录重连的处理。</p><ul><li>连接断开后自动重试，避免重复创建会话。</li><li>登录失败时保留输入，展示具体错误原因。</li><li>增加接口与页面交互回归。</li></ul><p>可以继续检查弱网和会话过期这两条路径。</p><div class="actions"><button data-action="quote" aria-label="引用回复">${icon('chat')}</button><button data-action="copy" aria-label="复制回复">${icon('copy')}</button><button data-action="download" aria-label="下载回复">${icon('file')}</button></div></div>`;
}
function session() {
  const guest = state.identity === 'guest';
  const locked =
    state.view === 'session' &&
    guest &&
    (!state.accepted || state.permission === 'view');
  const ownAgent = state.view === 'agent-session';
  const author = guest ? '林悦' : 'Alex';
  if (state.view === 'private-session')
    return `<div class="chat"><div class="transcript"><div class="messages"><div class="noticebar">${icon('lock')}<span>仅自己可见。这里的探索不会出现在协作会话区。</span></div><p>继续记录你的想法，或使用自己的智能体开始一项任务。</p>${state.messages
      .filter((m) => m.session === 'private-session')
      .map(
        (m) =>
          `<div class="message user"><div class="bubble">${esc(m.text)}</div></div>`,
      )
      .join(
        '',
      )}</div></div><div class="composer-wrap"><div class="composer"><textarea id="draft" aria-label="消息输入" placeholder="提出问题或描述一项任务…"></textarea><div class="composer-footer"><span>${guest ? '我的助手' : 'Builder'}</span><button class="send" data-action="send" aria-label="发送">${icon('send')}</button></div></div><div class="composer-note">个人会话 · 使用自己的执行环境</div></div></div>`;
  return `<div class="chat"><div class="transcript"><div class="messages">${guest && state.view === 'session' ? `<div class="noticebar">${icon('share')}<span>${!state.accepted ? 'Alex 邀请你参与这个会话。' : state.permission === 'view' ? '你可以查看此会话，执行权限由 Alex 管理。' : '你可以讨论和启动 Agent 任务，其他内容保持私密。'}</span><button data-action="${state.accepted ? 'permissions' : 'accept-session'}">${state.accepted ? '权限详情' : '接受邀请'}</button></div>` : ''}${ownAgent ? `<div class="noticebar">${icon('bot')}<span>Reviewer 由 Alex 提供 · 任务在授权项目的独立 Git worktree 执行</span><button data-action="agent-detail">使用范围</button></div><div class="system">${icon('lock')}此会话属于林悦，未与 Alex 共享。执行机器由 Alex 管理。</div>` : baseMessages()}${state.accepted && state.view === 'session' ? '<div class="system">' + icon('share') + '林悦已加入会话 · 可参与</div><div class="discussion"><small>林悦 · 10:27 · 讨论</small>我来补充一下测试场景：手机从 Wi-Fi 切到蜂窝网络时，也需要保留原会话。</div>' : ''}${state.messages
    .filter((m) => m.session === state.view)
    .map((m) =>
      m.type === 'discussion'
        ? `<div class="message discussion"><small>${esc(m.author)} · 刚刚 · 讨论</small>${esc(m.text)}</div>`
        : `<div class="message user"><div class="author">${esc(m.author)} · 刚刚 · 发给 Agent</div><div class="bubble">${esc(m.text)}</div></div>`,
    )
    .join(
      '',
    )}${state.working ? `<div class="system">${icon('bot')}${ownAgent ? 'Reviewer' : 'Builder'} 正在处理 ${state.concept === 'c' ? '<button class="text" data-action="permissions">查看执行信息</button>' : ''}</div>` : ''}</div></div><div class="composer-wrap"><div class="composer"><textarea id="draft" aria-label="消息输入" placeholder="${locked ? '接受邀请后参与，或以只读权限查看' : '提出问题或描述一项任务…'}" ${locked ? 'disabled' : ''}></textarea><div class="composer-footer">${!ownAgent ? `<div class="mode"><button class="${state.mode === 'task' ? 'active' : ''}" data-action="mode-task">发给 Agent</button><button class="${state.mode === 'discussion' ? 'active' : ''}" data-action="mode-discussion">讨论</button></div>` : ''}<button data-action="${ownAgent ? 'agent-detail' : 'agent-picker'}">${icon('bot')}${ownAgent ? 'Reviewer' : 'Builder'}</button><button class="send" data-action="send" aria-label="发送" ${locked || (state.working && state.mode === 'task') ? 'disabled' : ''}>${icon('send')}</button></div></div><div class="composer-note">${ownAgent ? 'Alex 提供 · dev-machine / Claude Code · 独立执行目录' : state.mode === 'discussion' ? '讨论发给会话参与者，不会自动启动 Agent' : '任务使用当前会话的项目目录；同一会话内串行执行'}</div></div></div>`;
}
function items(kind) {
  if (kind === 'sessions')
    return `<div class="item-row"><span class="avatar blue">${icon('chat')}</span><div class="item-info"><strong>登录重连与异常处理</strong><p>Alex 共享 · ${state.permission === 'view' ? '可查看' : '可参与'} · Steer 项目</p></div><span class="pill ${state.accepted ? '' : 'pending'}">${state.accepted ? '已加入' : '待接受'}</span><button class="${state.accepted ? 'outline' : 'primary'}" data-action="${state.accepted ? 'open-session' : 'accept-session'}">${state.accepted ? '打开会话' : '接受邀请'}</button></div>`;
  return `<div class="item-row"><span class="avatar green">${icon('bot')}</span><div class="item-info"><strong>Reviewer</strong><p>Alex 提供 · Claude Code · 仅 Steer 项目 · 独立 worktree</p></div><span class="pill">${state.agentAccepted ? '可使用' : '待接受'}</span><button class="outline" data-action="agent-detail">查看能力</button></div>`;
}
function shared() {
  const guest = state.identity === 'guest';
  const incoming = state.tab === 'joined';
  const empty = !state.invite || (incoming && !guest) || (!incoming && guest);
  return `<div class="page"><div class="page-head"><div><h1>协作会话</h1><p>共同推进一份工作。其他项目与探索仍留在各自的个人空间。</p></div></div>
 <div class="tabs" role="tablist" aria-label="协作会话分类"><button role="tab" aria-selected="${incoming}" class="${incoming ? 'active' : ''}" data-action="collab-joined">我参与的 <span>${guest ? '1' : '0'}</span></button><button role="tab" aria-selected="${!incoming}" class="${!incoming ? 'active' : ''}" data-action="collab-owned">我共享的 <span>${guest ? '0' : '1'}</span></button></div>
 <div class="list-toolbar"><span>${incoming ? '收到邀请并参与的会话' : '你主动开放给其他人的会话'}</span><label class="list-search">${icon('search')}<input id="collab-search" placeholder="搜索协作会话" aria-label="搜索协作会话"></label></div>
 ${empty ? `<div class="empty">${icon('chat')}<h3>${incoming ? '还没有收到会话邀请' : '还没有共享会话'}</h3><p>${incoming ? '收到邀请后，会在这里显示。' : '在聊天顶部选择“管理共享”，邀请同事一起推进。'}</p></div>` : `<div class="collaboration-row" data-search-row><div class="item-row"><span class="avatar blue">${icon('chat')}</span><div class="item-info"><strong>登录重连与异常处理</strong><p>Steer · ${incoming ? '所有者 Alex' : '你的会话'} · Builder</p></div><span class="pill ${state.accepted ? '' : 'pending'}">${state.accepted ? (state.permission === 'view' ? '可查看' : '可参与') : '待接受邀请'}</span><button class="${incoming && !state.accepted ? 'primary' : 'outline'}" data-action="${incoming && !state.accepted ? 'accept-session' : 'open-session'}">${incoming && !state.accepted ? '接受并打开' : '打开会话'}</button>${!incoming ? '<button class="icon-button" data-action="share-session" aria-label="管理会话共享">' + icon('settings') + '</button>' : ''}</div><div class="row-context"><span>${state.accepted ? 'Alex、林悦 · 2 位参与者' : 'Alex · 已邀请林悦'}</span><span>最近活动 · 今天 10:27</span></div></div>`}
 <p class="flow-note">会话仍属于原所有者，协作只开放该会话及其授权执行范围。</p></div>`;
}
function agents() {
  const guest = state.identity === 'guest';
  const incoming = state.agentTab === 'shared';
  return `<div class="page"><div class="page-head"><div><h1>智能体</h1><p>管理自己的智能体，也可以使用别人提供的能力。</p></div><button class="outline" data-action="new-agent">${icon('plus')} 添加智能体</button></div>
 <div class="tabs" role="tablist" aria-label="智能体分类"><button role="tab" aria-selected="${!incoming}" class="${!incoming ? 'active' : ''}" data-action="agent-mine">我的智能体 <span>${guest ? '1' : '2'}</span></button><button role="tab" aria-selected="${incoming}" class="${incoming ? 'active' : ''}" data-action="agent-shared">共享给我 <span>${guest ? '1' : '0'}</span></button></div>
 ${incoming ? (guest ? `<div class="item-row"><span class="avatar green">${icon('bot')}</span><div class="item-info"><strong>Reviewer</strong><p>Alex 提供 · Claude Code · Steer 授权项目</p></div><span class="pill">${state.agentAccepted ? '可使用' : '待接受'}</span><button class="outline" data-action="agent-detail">查看能力</button></div>` : '<div class="empty"><h3>还没有共享智能体</h3><p>别人授权的执行能力会出现在这里。</p></div>') : `<div class="item-row"><span class="avatar">${icon('bot')}</span><div class="item-info"><strong>${guest ? '我的助手' : 'Builder'}</strong><p>${guest ? '个人探索 · Codex' : '开发与协作 · dev-machine / Codex'}</p></div><span class="pill">仅自己可见</span><button class="outline" data-action="private-session">开始聊天</button></div>${!guest ? `<div class="item-row"><span class="avatar green">${icon('bot')}</span><div class="item-info"><strong>Reviewer</strong><p>代码审查 · dev-machine / Claude Code</p></div><span class="pill">${state.agentInvite ? '已共享 · 1 人' : '仅自己可见'}</span><button class="outline" data-action="share-agent">${icon('share')}${state.agentInvite ? '管理共享' : '共享能力'}</button></div>` : ''}`}
 <p class="flow-note">${incoming ? '使用共享智能体会在你的空间创建独立会话，不会自动进入协作会话区。' : '共享出去的智能体仍在“我的智能体”，你可以随时管理使用范围和成员。'}</p></div>`;
}
function panel() {
  const el = document.querySelector('#inspector');
  el.hidden = !state.panel;
  if (!state.panel) return;
  el.innerHTML = `<button class="panel-close" data-action="close-panel" aria-label="关闭面板">${icon('close')}</button>${state.panel === 'inbox' ? `<h2>共享收件箱</h2><p>先确认访问范围，再把共享对象加入自己的工作流。</p><div class="invite"><strong>登录重连与异常处理</strong><p>Alex 邀请你 · ${state.permission === 'view' ? '可查看' : '可参与'}<br>仅共享此会话和该会话的执行目录。</p><div class="invite-buttons"><button class="primary" data-action="accept-session">${state.accepted ? '打开会话' : '接受邀请'}</button><button class="text" data-action="permissions">查看范围</button></div></div><div class="invite"><strong>Reviewer</strong><p>Alex 提供的代码审查能力<br>仅 Steer 项目 · Claude Code</p><button class="outline" data-action="agent-detail">查看与使用</button></div>` : `<h2>此会话的访问权限</h2><p>你在自己的 Workspace 中访问 Alex 共享的这一个 Session。</p><div class="resource"><div class="row"><span>所有者</span><span>Alex</span></div><div class="row"><span>你的权限</span><span>${state.permission === 'view' ? '查看' : '讨论与启动 Agent'}</span></div><div class="row"><span>执行环境</span><span>dev-machine / Codex</span></div><div class="row"><span>工作目录</span><span>Steer / 当前 worktree</span></div></div><p>执行操作会影响这份共享工作。其他项目、会话和机器配置仍属于 Alex 的个人空间。</p><button class="outline" data-action="leave">退出此共享</button>`}`;
}
function render() {
  document
    .querySelectorAll('.preview-scenes button')
    .forEach((button) =>
      button.classList.toggle('active', button.dataset.action === state.view),
    );
  document.body.classList.remove('nav-open');
  document
    .querySelectorAll('[data-concept]')
    .forEach((b) =>
      b.classList.toggle('active', b.dataset.concept === state.concept),
    );
  sidebar();
  topbar();
  document.querySelector('#content').innerHTML =
    state.view === 'collaboration'
      ? shared()
      : state.view === 'agents'
        ? agents()
        : session();
  panel();
  document.querySelector('#identity').value = state.identity;
}
function toast(text) {
  const e = document.querySelector('#toast');
  e.textContent = text;
  e.style.display = 'block';
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (e.style.display = 'none'), 2600);
}
function modal(title, description, body, footer) {
  const d = document.querySelector('#modal');
  d.innerHTML = `<button class="close" data-action="close-modal" aria-label="关闭弹窗">${icon('close')}</button><h2>${title}</h2><p>${description}</p>${body}<footer>${footer}</footer>`;
  d.showModal();
}
function share(kind) {
  const agent = kind === 'agent';
  modal(
    agent ? '共享 Reviewer' : '共享会话',
    '只有被邀请的人可以访问。你的 Workspace 和其他内容保持私密。',
    `<div class="badge-line"><span class="pill">${agent ? '智能体使用权' : '可协作 Session'}</span><span class="hint">${agent ? '共享实际执行能力' : '登录重连与异常处理'}</span></div><label><span>邀请用户</span><div class="form-row"><input id="invite-email" type="email" placeholder="输入用户邮箱" value="linyue@example.com">${agent ? '' : `<select id="invite-role" aria-label="访问权限"><option value="participate">可参与</option><option value="view">可查看</option></select>`}</div></label>${agent ? `<div class="resource"><div class="row"><span>允许项目</span><span>Steer</span></div><div class="row"><span>执行环境</span><span>dev-machine / Claude Code</span></div><div class="row"><span>工作目录</span><span>每个会话独立 Git worktree</span></div><div class="row"><span>并发额度</span><span>1 个任务</span></div></div><p class="hint">接收者会创建自己的 Session。你仍管理执行机器，运行日志与工具凭据不等于独立的云端环境。</p>` : `<p class="hint" style="margin-top:12px">可参与：查看、讨论和启动 Agent。可查看：仅阅读。此会话历史、结果及执行目录在共享范围内。</p>`}<div id="members">${members(kind)}</div>`,
    `<button class="text" data-action="close-modal">完成</button><button class="primary" data-action="invite-${kind}">发送邀请</button>`,
  );
}
function members(kind) {
  return state.members
    .filter((m) => m.kind === kind)
    .map(
      (m) =>
        `<div class="member"><span class="avatar blue">${esc(m.email[0].toUpperCase())}</span><div class="member-info"><strong>${esc(m.email)}</strong><small>已邀请 · ${kind === 'agent' ? '可使用智能体' : m.role === 'view' ? '可查看' : '可参与'}</small></div>${kind === 'session' ? `<select class="permission-select" data-member="${esc(m.email)}"><option value="participate" ${m.role === 'participate' ? 'selected' : ''}>可参与</option><option value="view" ${m.role === 'view' ? 'selected' : ''}>可查看</option></select>` : ''}<button data-action="revoke" data-kind="${kind}" data-email="${esc(m.email)}">移除</button></div>`,
    )
    .join('');
}
function agentDetail() {
  const guest = state.identity === 'guest';
  modal(
    'Reviewer',
    '由 Alex 提供 · 独立检查代码与测试路径',
    `<div class="resource"><div class="row"><span>Runtime</span><span>Claude Code</span></div><div class="row"><span>机器</span><span>dev-machine</span></div><div class="row"><span>允许项目</span><span>Steer</span></div><div class="row"><span>目录隔离</span><span>独立 Git worktree</span></div></div><p>在你的 Workspace 创建独立会话，Agent 可以访问授权项目的代码。此会话不会自动共享给 Alex，但执行机器与原生日志由 Alex 管理。</p><label><span>选择项目</span><select><option>Steer · Alex 授权</option><option disabled>我的工具箱 · 不在授权范围</option></select></label><label><span>任务标题</span><input id="agent-task-title" value="检查接口与数据归属"></label>`,
    `<button class="text" data-action="close-modal">取消</button><button class="primary" data-action="use-agent">${guest && !state.agentAccepted ? '接受并开始聊天' : '开始独立会话'}</button>`,
  );
}
const actions = {
  collaboration: () => {
    state.view = 'collaboration';
    state.panel = false;
    render();
  },
  'collab-joined': () => {
    state.tab = 'joined';
    render();
  },
  'collab-owned': () => {
    state.tab = 'owned';
    render();
  },
  'agent-mine': () => {
    state.agentTab = 'mine';
    render();
  },
  'agent-shared': () => {
    state.agentTab = 'shared';
    render();
  },
  'private-session': () => {
    state.view = 'private-session';
    state.panel = false;
    render();
  },
  session: () => {
    state.view = 'session';
    state.panel = false;
    render();
  },
  'open-session': () => {
    state.view = 'session';
    state.panel = false;
    render();
  },
  shared: () => {
    state.view = 'collaboration';
    render();
  },
  agents: () => {
    state.view = 'agents';
    render();
  },
  'tab-sessions': () => {
    state.tab = 'sessions';
    render();
  },
  'tab-agents': () => {
    state.tab = 'agents';
    render();
  },
  'tab-mine': () => {
    state.tab = 'mine';
    render();
  },
  'agent-session': () => {
    state.view = 'agent-session';
    render();
  },
  'share-session': () => share('session'),
  'share-agent': () => share('agent'),
  'close-modal': () => document.querySelector('#modal').close(),
  'agent-detail': agentDetail,
  'accept-session': () => {
    state.accepted = true;
    state.view = 'session';
    state.panel = false;
    render();
    toast('已加入共享会话，可以在这里继续工作');
  },
  permissions: () => {
    state.panel = 'permissions';
    panel();
  },
  inbox: () => {
    state.panel = state.panel ? '' : 'inbox';
    panel();
  },
  'close-panel': () => {
    state.panel = false;
    panel();
  },
  leave: () => {
    state.accepted = false;
    state.panel = false;
    state.view = 'collaboration';
    render();
    toast('已退出这个共享，自己的工作内容保留');
  },
  'use-agent': () => {
    state.agentAccepted = true;
    state.created = true;
    state.view = 'agent-session';
    state.panel = false;
    document.querySelector('#modal').close();
    render();
    toast('已在你的个人空间创建独立会话');
  },
  'mode-task': () => {
    const draft = document.querySelector('#draft')?.value || '';
    state.mode = 'task';
    render();
    document.querySelector('#draft').value = draft;
    document.querySelector('#draft').focus();
  },
  'mode-discussion': () => {
    const draft = document.querySelector('#draft')?.value || '';
    state.mode = 'discussion';
    render();
    document.querySelector('#draft').value = draft;
    document.querySelector('#draft').focus();
  },
  send: () => {
    const draft = document.querySelector('#draft');
    const text = draft?.value.trim();
    if (!text) return;
    if (state.working && state.mode === 'task') {
      toast('当前任务正在执行，可先发送讨论');
      return;
    }
    state.messages.push({
      text,
      author: state.identity === 'guest' ? '林悦' : 'Alex',
      type: state.mode,
      session: state.view,
    });
    if (state.mode === 'task') {
      state.working = true;
      setTimeout(() => {
        state.working = false;
        render();
        toast('演示任务已结束；正式版将在这里同步执行结果');
      }, 3500);
    }
    render();
    document.querySelector('.transcript').scrollTop = 1e6;
  },
  menu: () => document.body.classList.toggle('nav-open'),
  quote: () => {
    document.querySelector('#draft').value =
      '基于上面的结果，检查弱网和会话过期路径。';
    document.querySelector('#draft').focus();
  },
  copy: () => toast('已复制示例回复'),
  download: () => toast('原型演示：正式版沿用已有下载功能'),
  new: () => {
    state.view = 'agent-session';
    state.created = true;
    render();
  },
  private: () => toast('这是 Alex 的私密探索会话，不会出现在接收者工作台'),
  'agent-picker': () =>
    toast('共享 Session 使用已授权的 Builder；切换 Agent 需要所有者授权'),
  'new-agent': () => toast('沿用现有添加智能体流程'),
};
document.addEventListener('click', (e) => {
  const button = e.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action.startsWith('invite-')) {
    const kind = action.slice(7);
    const email = document.querySelector('#invite-email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast('请输入有效的邮箱地址');
      return;
    }
    const role = document.querySelector('#invite-role')?.value || 'use';
    state.members = state.members.filter(
      (m) => !(m.email === email && m.kind === kind),
    );
    state.members.push({ email, role, kind });
    if (kind === 'session') {
      state.invite = true;
      state.permission = role;
    } else state.agentInvite = true;
    document.querySelector('#members').innerHTML = members(kind);
    toast('演示邀请已创建 · 可切换到林悦体验接收');
    return;
  }
  if (action === 'revoke') {
    state.members = state.members.filter(
      (m) =>
        !(m.email === button.dataset.email && m.kind === button.dataset.kind),
    );
    if (button.dataset.kind === 'session') {
      state.accepted = false;
      state.invite = false;
    } else {
      state.agentAccepted = false;
      state.agentInvite = false;
    }
    document.querySelector('#members').innerHTML = members(button.dataset.kind);
    toast('已移除访问授权');
    return;
  }
  if (actions[action]) actions[action]();
  else toast('原型保留当前页面，只演示对象共享流程');
});
document.querySelector('#identity').addEventListener('change', (e) => {
  state.identity = e.target.value;
  state.view = 'collaboration';
  state.tab = state.identity === 'guest' ? 'joined' : 'owned';
  state.agentTab = 'mine';
  state.panel = false;
  render();
});
document.addEventListener('change', (e) => {
  if (e.target.matches('[data-member]')) {
    const m = state.members.find(
      (m) => m.email === e.target.dataset.member && m.kind === 'session',
    );
    m.role = e.target.value;
    state.permission = e.target.value;
    toast('权限已更新');
  }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'collab-search') {
    document
      .querySelectorAll('[data-search-row]')
      .forEach(
        (row) =>
          (row.hidden = !row.textContent
            .toLowerCase()
            .includes(e.target.value.trim().toLowerCase())),
      );
  }
  if (e.target.id === 'search') {
    state.query = e.target.value;
    document
      .querySelectorAll('.session-nav')
      .forEach(
        (row) =>
          (row.hidden =
            !!state.query && !row.textContent.includes(state.query)),
      );
  }
});
document.querySelector('#modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    const r = e.currentTarget.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      e.currentTarget.close();
  }
});
render();
