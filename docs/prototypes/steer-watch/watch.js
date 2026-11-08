const icons = {
  back: '<path d="m15 18-6-6 6-6"/>',
  next: '<path d="m9 18 6-6-6-6"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  circle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  spin: '<path d="M20 12a8 8 0 1 1-5.5-7.6"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 .3l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7-.3l-3 3a5 5 0 0 0 7 7l2-2"/>',
  cloud:
    '<path d="M7 18a5 5 0 0 1-1-10 7 7 0 0 1 13 2 4 4 0 0 1-1 8m-9-9 6 6m0-6-6 6"/>',
  phone:
    '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>',
  send: '<path d="m22 2-7 20-4-9-9-4 20-7ZM11 13 22 2"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>',
};
const svg = (name, cl = '') =>
  `<svg class="${cl}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.check}</svg>`;
const escapeHtml = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
const definitions = [
  {
    id: 'a',
    name: '列表工作台',
    label: 'A / LIST WORKSPACE',
    description:
      '全部会话放在一个列表里，先找任务，再进入结果和语音。适合快速扫描多个会话。',
    foot: '<b>扫描效率优先。</b> 列表 → 会话详情 → 听写确认。状态集中，操作分层。',
    initial: 'home',
  },
  {
    id: 'b',
    name: '会话卡片',
    label: 'B / SESSION CAROUSEL',
    description:
      '一个会话占一屏，滑动或转动表冠切换。状态、摘要、语音入口直接在卡片上。',
    foot: '<b>阅读和续聊优先。</b> 切换卡片 → 直接听写。每段会话有完整空间，逐个浏览。',
    initial: 'home',
  },
  {
    id: 'c',
    name: '动态收件箱',
    label: 'C / ACTION INBOX',
    description:
      '只把刚完成、失败的任务放进待处理。看完继续对话，或标记已处理，让列表回归清爽。',
    foot: '<b>下一步行动优先。</b> 待处理 → 查看结果 → 续聊／处理完成。运行任务单独查看。',
    initial: 'home',
  },
];
const taskSeed = [
  {
    id: 'git',
    project: 'Relay',
    name: '大仓库任务恢复',
    agent: 'Codex',
    state: 'running',
    duration: '8 分钟',
    summary: '正在准备 Git 工作区。仓库较大，下载仍在进行。',
    prompt: '修复大仓库首次执行的问题。',
  },
  {
    id: 'feishu',
    project: 'Steer',
    name: '飞书图片输入',
    agent: 'Builder',
    state: 'complete',
    duration: '刚刚',
    summary:
      '已支持图片和富文本输入，相关测试通过。可以继续检查群聊中的图片引用。',
    prompt: '实现飞书图片输入，完成后告诉我。',
  },
  {
    id: 'site',
    project: 'Steer',
    name: '更新官网',
    agent: 'Writer',
    state: 'failed',
    duration: '3 分钟前',
    summary: '无法访问远程仓库，任务已停止。请在手机或电脑检查网络与仓库授权。',
    prompt: '更新官网的协作功能介绍。',
  },
];
const instances = {};
function make(def) {
  const state = {
    def,
    view: def.initial,
    task: 'feishu',
    offline: false,
    failSend: false,
    draft: '',
    sent: false,
    tab: 'pending',
    cardIndex: 1,
    toast: '',
    history: [],
    tasks: structuredClone(taskSeed),
  };
  instances[def.id] = state;
  const root = document.createElement('article');
  root.className = 'concept';
  root.id = `concept-${def.id}`;
  root.innerHTML = `<div class="concept-head"><span class="concept-tag">${def.label}</span>${def.id === 'a' ? '<span class="recommend">推荐首版</span>' : ''}</div><h2>${def.name}</h2><p class="concept-description">${def.description}</p><div class="hardware-stage"><div class="watch"><button class="crown" data-action="card-next" aria-label="转动表冠：下一个会话" ${def.id !== 'b' ? 'disabled' : ''}></button><div class="side-button"></div><div class="screen" role="region" aria-label="${def.name}手表原型"></div></div></div><div class="demo-controls"><p>场景模拟 · ${def.id === 'b' ? '横向滑动／点表冠切换卡片' : '在手表内滚动查看更多内容'}</p><div><button data-demo="complete">任务完成</button><button data-demo="offline">模拟离线</button><button data-demo="failure">发送失败</button><button data-demo="reset">重置</button></div></div><p class="concept-foot">${def.foot}</p>`;
  document.querySelector('.concepts').append(root);
  state.root = root;
  root.addEventListener('click', (event) => {
    const demo = event.target.closest('[data-demo]');
    if (demo) {
      simulate(state, demo.dataset.demo);
      return;
    }
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    act(state, button.dataset.action, button.dataset.id);
  });
  root.addEventListener('input', (event) => {
    if (event.target.matches('textarea')) {
      state.draft = event.target.value;
      const send = root.querySelector('[data-action="send"]');
      if (send) send.disabled = !state.draft.trim();
    }
  });
  let touchStart;
  root.querySelector('.screen').addEventListener('pointerdown', (event) => {
    touchStart = { x: event.clientX, y: event.clientY };
  });
  root.querySelector('.screen').addEventListener('pointerup', (event) => {
    if (def.id !== 'b' || state.view !== 'home' || !touchStart) return;
    const dx = event.clientX - touchStart.x,
      dy = event.clientY - touchStart.y;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy))
      act(state, dx < 0 ? 'card-next' : 'card-prev');
    touchStart = undefined;
  });
  root.querySelector('.screen').addEventListener('keydown', (event) => {
    if (
      def.id === 'b' &&
      state.view === 'home' &&
      ['ArrowLeft', 'ArrowRight'].includes(event.key)
    ) {
      event.preventDefault();
      act(state, event.key === 'ArrowRight' ? 'card-next' : 'card-prev');
    }
  });
  root.querySelector('.screen').tabIndex = 0;
  render(state);
}
const button = (label, action, style = '', icon = '', extra = '') =>
  `<button class="watch-button ${style}" data-action="${action}" ${extra}>${icon ? svg(icon) : ''}${label}</button>`;
const taskFor = (s) => s.tasks.find((t) => t.id === s.task);
function banner(s) {
  return s.offline
    ? '<div class="offline-note">离线 · 上次同步 10:08<br>当前状态可能已变化</div>'
    : '';
}
function taskStatus(task) {
  return task.state === 'running'
    ? ['运行中', 'spin', 'wait']
    : task.state === 'complete'
      ? ['已完成', 'circle', '']
      : task.state === 'cancelled'
        ? ['已停止', 'stop', '']
        : ['执行失败', 'error', 'error'];
}
function row(task) {
  const [, icon] = taskStatus(task);
  return `<button class="task" data-action="detail" data-id="${task.id}"><span class="status-icon">${svg(icon, task.state === 'running' ? 'spinning' : '')}</span><div><strong>${escapeHtml(task.name)}</strong><small>${escapeHtml(task.project)} · ${task.state === 'running' ? '执行 ' + task.duration : taskStatus(task)[0] + ' · ' + task.duration}</small></div>${svg('next')}</button>`;
}
function listHome(s) {
  const running = s.tasks.filter((t) => t.state === 'running').length,
    complete = s.tasks.filter((t) => t.state === 'complete').length;
  return `<div class="watch-head"><h3>任务</h3><p class="connection">${svg(s.offline ? 'cloud' : 'link')}${s.offline ? '未连接' : '已同步 · 10:09'}</p></div>${banner(s)}<div class="numbers"><div><strong>${running}</strong><small>运行中</small></div><div><strong>${complete}</strong><small>已完成</small></div></div><div class="list-title">当前关注 <span>3 个会话</span></div>${s.tasks.map(row).join('')}`;
}
function switchTask(s, id) {
  const current = taskFor(s);
  current.draft = s.draft;
  current.sent = s.sent;
  s.task = id;
  s.draft = taskFor(s).draft || '';
  s.sent = taskFor(s).sent || false;
}
function cardHome(s) {
  const task = s.tasks[s.cardIndex];
  if (s.task !== task.id) switchTask(s, task.id);
  const [label, icon, color] = taskStatus(task);
  return `${banner(s)}<div class="card-pagination"><button data-action="card-prev" aria-label="上一个会话">${svg('back')}</button><span>${s.cardIndex + 1} / ${s.tasks.length} 个会话</span><button data-action="card-next" aria-label="下一个会话">${svg('next')}</button></div>
 <div class="session-deck"><div class="task-meta">${escapeHtml(task.project)} · ${escapeHtml(task.agent)}</div><h3 class="deck-title">${escapeHtml(task.name)}</h3><div class="state-label ${color}">${svg(icon, task.state === 'running' ? 'spinning' : '')}${label} · ${task.duration}</div><p class="deck-summary">${escapeHtml(task.summary)}</p>
 ${task.state === 'running' ? button('停止任务', 'stop-confirm', 'danger', 'stop') : button(s.draft && !s.sent ? '编辑草稿' : '语音继续', 'voice', 'primary', 'mic')}
 </div><div class="page-dots">${s.tasks.map((t, i) => `<button data-action="card-index" data-id="${i}" aria-label="切换到${escapeHtml(t.name)}" aria-pressed="${s.cardIndex === i}"></button>`).join('')}</div><button class="text-link" data-action="detail" data-id="${task.id}">完整结果 ${svg('next')}</button>`;
}
function inboxHome(s) {
  const pending = s.tasks.filter((t) => t.state !== 'running' && !t.handled),
    running = s.tasks.filter((t) => t.state === 'running'),
    handled = s.tasks.filter((t) => t.handled && t.state !== 'running');
  const list =
    s.tab === 'running' ? running : s.tab === 'handled' ? handled : pending;
  return `<div class="watch-head"><h3>${s.tab === 'running' ? '运行任务' : s.tab === 'handled' ? '已处理' : '待处理'} <em>${list.length}</em></h3><p>${s.tab === 'pending' ? '完成与异常，等你决定下一步' : s.tab === 'running' ? '后台运行，结束后进入待处理' : '已处理动态仍可再次查看'}</p></div>${banner(s)}
 <div class="pill-menu"><button data-action="inbox-tab" data-id="pending" class="${s.tab === 'pending' ? 'selected' : ''}">待处理 ${pending.length}</button><button data-action="inbox-tab" data-id="running" class="${s.tab === 'running' ? 'selected' : ''}">运行 ${running.length}</button></div>
 ${list.length ? list.map((t) => `<button class="task inbox-task ${t.state === 'failed' ? 'is-error' : ''}" data-action="detail" data-id="${t.id}"><span class="status-icon">${svg(taskStatus(t)[1], t.state === 'running' ? 'spinning' : '')}</span><div><strong>${escapeHtml(t.name)}</strong><small>${t.state === 'failed' ? '需要检查' : taskStatus(t)[0]} · ${t.duration}</small><p>${t.state === 'failed' ? '仓库访问失败' : t.state === 'running' ? '正在准备工作区' : '等待查看结果或继续'}</p></div>${svg('next')}</button>`).join('') : '<div class="inbox-empty">' + svg('circle') + '<strong>这里已经处理完了</strong><p>任务完成后，新的动态会出现在这里。</p></div>'}
 <button class="text-link" data-action="inbox-tab" data-id="${s.tab === 'handled' ? 'pending' : 'handled'}">${s.tab === 'handled' ? '返回待处理' : '已处理 ' + handled.length}</button>`;
}
function home(s) {
  return s.def.id === 'a'
    ? listHome(s)
    : s.def.id === 'b'
      ? cardHome(s)
      : inboxHome(s);
}
function notification(s) {
  const task = taskFor(s);
  return `${banner(s)}<div class="notice-icon">${svg('check')}</div><h3 class="notice-heading">任务完成了</h3><p class="notice-sub">${escapeHtml(task.project)} · ${escapeHtml(task.agent)}<br>${escapeHtml(task.name)} · ${task.duration}</p><p class="notice-summary">${escapeHtml(task.summary)}</p>${button('语音继续', 'voice', 'primary', 'mic')}${button('查看结果', 'detail', '', '', `data-id="${task.id}"`)}<button class="text-link" data-action="home">所有任务</button>`;
}
function detail(s) {
  const task = taskFor(s),
    [label, icon, color] = taskStatus(task);
  return `${banner(s)}<div class="task-meta">${escapeHtml(task.project)} <i>·</i> ${escapeHtml(task.agent)}</div><h3 class="result-title">${escapeHtml(task.name)}</h3><div class="state-label ${color}">${svg(icon, task.state === 'running' ? 'spinning' : '')}${label} · ${task.duration}</div><div class="answer"><p>${escapeHtml(task.summary)}</p></div>${task.state === 'running' ? button('停止任务', 'stop-confirm', 'danger', 'stop', '') + '<p class="sub-note">任务结束后可以继续对话</p>' : button(s.draft && !s.sent ? '继续编辑草稿' : '语音继续', 'voice', 'primary', 'mic')}${s.def.id === 'c' && task.state !== 'running' && !task.handled ? button('标记已处理', 'handled', 'secondary', 'check') : ''}${document.body.dataset.concept === 'a' ? button('查看对话', 'chat', 'secondary') : ''}${button('在手机查看', 'phone', 'secondary', 'phone')}`;
}
function chat(s) {
  const task = taskFor(s);
  return `${banner(s)}<div class="task-meta">${escapeHtml(task.project)} <i>·</i> ${escapeHtml(task.agent)}</div><h3 class="result-title">${escapeHtml(task.name)}</h3><div class="conversation-label">你 · 10:01</div><div class="bubble-user">${escapeHtml(s.sent ? s.draft : task.prompt)}</div><div class="answer"><p class="author">${escapeHtml(task.agent)} · ${taskStatus(task)[0]}</p><p>${escapeHtml(task.summary)}</p></div>${task.state === 'running' ? button('查看运行状态', 'detail', '', '', `data-id="${task.id}"`) : button(s.draft && !s.sent ? '继续编辑草稿' : '语音继续', 'voice', 'primary chat-mic', 'mic')}<button class="text-link" data-action="home">切换会话</button>`;
}
function voice(s) {
  const task = taskFor(s);
  return `<div class="context-strip">发送到 ${escapeHtml(task.project)}<br>${escapeHtml(task.name)} · ${escapeHtml(task.agent)}</div><div class="voice-center"><div class="mic-disc">${svg('mic')}</div><div class="waves">${[10, 19, 26, 14, 23, 17, 10, 22, 14].map((h, i) => `<i style="--h:${h}px;--delay:${i * 0.08}s"></i>`).join('')}</div><div class="voice-help">模拟听写中<br>点完成，检查识别文字</div></div>${button('完成听写', 'finish', 'primary', 'check')}<p class="sub-note">也可以在下一步编辑文字</p>`;
}
function confirm(s) {
  const task = taskFor(s);
  return `<h3 class="confirm-heading">确认发送</h3><div class="context-strip">${escapeHtml(task.project)} · ${escapeHtml(task.agent)}<br>${escapeHtml(task.name)}</div>${s.view === 'failed-send' ? '<div class="failed-note">尚未发送 · 草稿已保留<br>检查连接后再试一次</div>' : s.offline ? '<div class="failed-note">离线 · 暂时无法发送<br>可以编辑并保留草稿</div>' : ''}<textarea aria-label="听写文字" maxlength="500">${escapeHtml(s.draft)}</textarea>${button(s.view === 'failed-send' ? '重试发送' : '发送', 'send', 'primary', 'send', s.draft.trim() ? '' : 'disabled')}${button('稍后再发', 'save', 'secondary')}<p class="sub-note">确认后才会启动新任务</p>`;
}
function sent(s) {
  return `<div class="small-check">${svg('circle')}</div><h3 class="notice-heading">已发送</h3><p class="notice-sub">${escapeHtml(taskFor(s).agent)} 已接收你的要求</p><div class="answer">${escapeHtml(s.draft)}</div><p class="sub-note">新任务已进入执行队列</p>${button('返回会话', 'chat', 'primary')}`;
}
function phone(s) {
  return `<div class="small-check">${svg('phone')}</div><h3 class="notice-heading">在手机接着看</h3><p class="muted-body">手机将打开这段会话，查看完整结果和执行详情。</p><div class="context-strip">${escapeHtml(taskFor(s).project)}<br>${escapeHtml(taskFor(s).name)}</div>${button('返回', 'back', 'secondary')}<p class="sub-note">原型中模拟手机接续入口</p>`;
}
function render(s) {
  const labels = {
    home: 'Steer',
    notification: 'Steer',
    detail: '任务',
    chat: '会话',
    voice: '听写',
    confirm: '听写',
    sent: '完成',
    phone: '手机',
    'failed-send': '听写',
    'stop-confirm': '任务',
  };
  const isHome = s.view === 'home' || s.view === s.def.initial;
  const content =
    s.view === 'home'
      ? home(s)
      : s.view === 'notification'
        ? notification(s)
        : s.view === 'detail'
          ? detail(s)
          : s.view === 'chat'
            ? chat(s)
            : s.view === 'voice'
              ? voice(s)
              : s.view === 'confirm' || s.view === 'failed-send'
                ? confirm(s)
                : s.view === 'sent'
                  ? sent(s)
                  : s.view === 'phone'
                    ? phone(s)
                    : `<h3 class="confirm-heading">停止这个任务？</h3><p class="muted-body">停止当前执行，已完成的改动不会自动撤销。</p>${button('停止任务', 'stop', 'danger', 'stop')}${button('继续运行', 'back', 'secondary')}`;
  s.root.querySelector('.screen').innerHTML =
    `<div class="screen-top">${isHome ? `<span>${labels[s.view]}</span>` : `<button class="back" data-action="back" aria-label="返回">${svg('back')}${labels[s.view]}</button>`}<time>10:09</time></div><div class="viewport">${content}</div>${s.toast ? `<div class="toast" role="status">${escapeHtml(s.toast)}</div>` : ''}`;
  if (document.body.dataset.concept === 'a') {
    const screen = s.root.querySelector('.screen');
    screen.dataset.view = s.view;
    const viewport = screen.querySelector('.viewport');
    const actions = [
      ...viewport.querySelectorAll(
        ':scope > .watch-button, :scope > .text-link',
      ),
    ];
    if (actions.length) {
      const footer = document.createElement('div');
      footer.className = 'watch-actions';
      if (actions.length === 3) footer.classList.add('three-actions');
      if (['confirm', 'failed-send', 'stop-confirm'].includes(s.view))
        footer.classList.add('paired-actions');
      actions.forEach((action) => footer.append(action));
      screen.append(footer);
    }
  }
  const off = s.root.querySelector('[data-demo="offline"]');
  off.textContent = s.offline ? '恢复网络' : '模拟离线';
  off.classList.toggle('network-off', s.offline);
}
function navigate(s, view) {
  s.history.push(s.view);
  s.view = view;
  render(s);
}
function act(s, action, id) {
  if (
    action === 'card-next' ||
    action === 'card-prev' ||
    action === 'card-index'
  ) {
    s.cardIndex =
      action === 'card-index'
        ? Number(id)
        : (s.cardIndex + (action === 'card-next' ? 1 : -1) + s.tasks.length) %
          s.tasks.length;
    switchTask(s, s.tasks[s.cardIndex].id);
    s.view = 'home';
    render(s);
    return;
  }
  if (action === 'inbox-tab') {
    s.tab = id;
    s.view = 'home';
    s.history = [];
    render(s);
    return;
  }
  if (action === 'handled') {
    taskFor(s).handled = true;
    s.tab = 'pending';
    s.view = 'home';
    s.history = [];
    render(s);
    return;
  }
  if (action === 'back') {
    s.view = s.history.pop() || s.def.initial;
    render(s);
    return;
  }
  if (action === 'home') {
    s.history = [];
    s.view = 'home';
    render(s);
    return;
  }
  if (action === 'detail') {
    if (id) switchTask(s, id);
    navigate(s, 'detail');
    return;
  }
  if (action === 'voice') {
    s.sent = false;
    navigate(s, s.draft ? 'confirm' : 'voice');
    return;
  }
  if (action === 'finish') {
    s.draft = '按这个方案继续实现，先不要提交。';
    navigate(s, 'confirm');
    return;
  }
  if (action === 'send') {
    if (!s.draft.trim()) return;
    if (s.offline || s.failSend) {
      s.failSend = false;
      navigate(s, 'failed-send');
      return;
    }
    s.sent = true;
    const task = taskFor(s);
    task.state = 'running';
    task.handled = false;
    task.duration = '刚开始';
    task.summary = '已收到追问，正在准备执行。';
    navigate(s, 'sent');
    return;
  }
  if (action === 'save') {
    s.view = s.def.id === 'b' ? 'home' : 'detail';
    s.toast = '草稿已保留';
    render(s);
    setTimeout(() => {
      s.toast = '';
      render(s);
    }, 1800);
    return;
  }
  if (action === 'stop') {
    const task = taskFor(s);
    task.state = 'cancelled';
    task.duration = '刚刚';
    task.summary = '任务已停止，已有结果保留。';
    s.view = s.def.id === 'b' ? 'home' : 'detail';
    render(s);
    return;
  }
  navigate(s, action);
}
function simulate(s, action) {
  if (action === 'reset') {
    s.tasks = structuredClone(taskSeed);
    s.task = 'feishu';
    s.cardIndex = 1;
    s.tab = 'pending';
    s.view = s.def.initial;
    s.offline = false;
    s.failSend = false;
    s.draft = '';
    s.sent = false;
    s.history = [];
    s.toast = '';
    render(s);
    return;
  }
  if (action === 'offline') {
    s.offline = !s.offline;
    render(s);
    return;
  }
  if (action === 'failure') {
    switchTask(s, 'feishu');
    s.cardIndex = 1;
    s.failSend = true;
    s.draft = s.draft || '按这个方案继续实现，先不要提交。';
    s.view = 'confirm';
    s.history = [];
    render(s);
    return;
  }
  if (action === 'complete') {
    if (s.offline) {
      s.toast = '离线时不更新缓存 · 恢复网络后再试';
      render(s);
      setTimeout(() => {
        s.toast = '';
        render(s);
      }, 2000);
      return;
    }
    const task =
      taskFor(s).state === 'running'
        ? taskFor(s)
        : s.tasks.find((t) => t.state === 'running') || taskFor(s);
    task.state = 'complete';
    task.duration = '刚刚';
    task.summary = '已完成修复并通过回归测试。可以继续验证发布与部署步骤。';
    task.handled = false;
    if (s.task === task.id) {
      s.draft = '';
      s.sent = false;
    }
    s.view = 'home';
    s.history = [];
    render(s);
  }
}
definitions
  .filter(
    (def) =>
      !document.body.dataset.concept ||
      def.id === document.body.dataset.concept,
  )
  .forEach(make);
