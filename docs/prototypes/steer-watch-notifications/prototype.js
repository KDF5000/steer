const paths = {
  back: '<path d="m15 18-6-6 6-6"/>',
  next: '<path d="m9 18 6-6-6-6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',
  spin: '<path d="M20 12a8 8 0 1 1-5.5-7.6"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/>',
  send: '<path d="m22 2-7 20-4-9-9-4 20-7ZM11 13 22 2"/>',
  more: '<path d="M5 12h.01M12 12h.01M19 12h.01"/>',
};
const icon = (name, cl = '') =>
  `<svg class="${cl}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.check}</svg>`;
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
const defs = [
  {
    id: 'a',
    name: '紧凑任务列表',
    label: 'A / QUICK SCAN',
    description:
      '一次看两个正在进行的任务；完成动态单独进入。适合同时关注多个 Agent，先看状态，再决定是否续聊。',
    foot: '<b>多任务扫描。</b> 进行中 → 最近动态 → 结果 → 语音。信息集中，操作逐层展开。',
  },
  {
    id: 'b',
    name: '单任务焦点页',
    label: 'B / FOCUS & SWITCH',
    description:
      '每屏关注一个任务，表冠或左右滑动切换。任务完成后，原位置直接变成结果和麦克风入口。',
    foot: '<b>持续关注一个任务。</b> 切换任务 → 结果原位出现 → 直接语音。状态更醒目，续聊少一步。',
  },
  {
    id: 'c',
    name: '通知直接续聊',
    label: 'C / NOTIFY & CONTINUE',
    description:
      '抬腕先看到完成通知和结果摘要，点麦克风直接续聊。需要主动查状态时，再进入正在进行的任务。',
    foot: '<b>通知驱动。</b> 收到结果 → 语音 → 确认发送。平时安静，需要下一步时再出现。',
    recommend: true,
  },
];
const seed = [
  {
    id: 'reconnect',
    title: '修复登录重连',
    project: 'Steer',
    agent: 'Codex',
    status: 'running',
    elapsed: '1:42',
    phase: '正在修改代码',
    summary: '重连问题已修复，测试通过。可以继续验证网络切换。',
  },
  {
    id: 'images',
    title: '优化图片输入',
    project: 'Steer',
    agent: 'Trae',
    status: 'waiting',
    elapsed: '0:18',
    phase: '等待运行环境',
    summary: '图片接收和引用已完善，相关测试通过。',
  },
  {
    id: 'website',
    title: '更新官网文案',
    project: 'Steer',
    agent: 'Writer',
    status: 'complete',
    elapsed: '刚刚',
    phase: '任务已完成',
    summary: '协作功能介绍已更新。可以继续补充安装说明。',
  },
];
const speech = '按这个结果继续，先不要提交。';
const states = {};
const active = (t) => ['running', 'waiting'].includes(t.status);
const task = (s) => s.tasks.find((t) => t.id === s.taskId);
const notices = (s) =>
  s.tasks.filter((t) => !active(t) && !s.cleared.has(t.id));
const label = (t) =>
  t.status === 'running'
    ? '正在执行'
    : t.status === 'waiting'
      ? '等待执行'
      : t.status === 'failed'
        ? '执行失败'
        : '已完成';
const watchButton = (
  text,
  action,
  { secondary = false, id = '', disabled = false } = {},
) =>
  `<button class="watch-action ${secondary ? 'secondary' : ''}" data-action="${action}" ${id ? `data-id="${id}"` : ''} ${disabled ? 'disabled' : ''}>${text}</button>`;
function row(t) {
  return `<button class="task-row ${t.status}" data-action="task" data-id="${t.id}"><i class="row-dot"></i><span class="row-copy"><strong>${esc(t.title)}</strong><small>${esc(t.agent)} · ${active(t) ? t.elapsed : label(t)}</small></span>${icon('next')}</button>`;
}
function draft(s) {
  return s.drafts[s.taskId] || '';
}
function shell(
  s,
  head,
  content,
  buttons = '',
  {
    back = false,
    close = false,
    more = false,
    style = '',
    paired = false,
  } = {},
) {
  const chrome = back
    ? `<button class="head-control" data-action="back" aria-label="返回并保留草稿">${icon('back')}</button>`
    : '';
  const right = close
    ? `<button class="head-control" data-action="clear" aria-label="清除当前通知">${icon('close')}</button>`
    : more
      ? `<button class="head-control" data-action="menu" aria-label="通知操作">${icon('more')}</button>`
      : `<span class="watch-time">${s.offline ? '离线' : '10:09'}</span>`;
  return `<div class="watch-head">${chrome}<span class="head-label">${head}</span>${right}</div><div class="view-body ${style}">${content}</div>${buttons ? `<div class="watch-actions ${paired ? 'paired' : ''}">${buttons}</div>` : ''}`;
}
function result(s, { notice = false, focus = false } = {}) {
  const t = task(s);
  const content = `<h3 class="task-title">${esc(t.title)}</h3><span class="project-agent">${esc(t.project)} · ${esc(t.agent)}</span><p class="result-summary">${esc(t.summary)}</p>`;
  const heading = notice
    ? `<button class="source-app-control" data-action="active" aria-label="打开 Steer 查看运行任务"><i class="mini-mark">S</i>${label(t)}</button>`
    : focus
      ? `${label(t)} ${s.index + 1}/${s.tasks.length}`
      : label(t);
  return shell(
    s,
    heading,
    content,
    watchButton(`${icon('mic')}${draft(s) ? '继续草稿' : '语音续聊'}`, 'voice'),
    {
      back: !notice && !focus,
      close: notice,
      more: !notice && !focus,
      style: `result ${notice ? 'notice' : focus ? 'focus' : ''}`,
    },
  );
}
function running(s, { focus = false } = {}) {
  const t = task(s);
  const state = focus
    ? ''
    : `<div class="task-state ${t.status}">${icon('spin', t.status === 'running' ? 'busy' : '')}${label(t)}</div>`;
  const content = `<span class="project-agent">${esc(t.project)} · ${esc(t.agent)}</span><h3 class="task-title">${esc(t.title)}</h3><div class="running-info">${state}<div class="elapsed">${t.elapsed}</div><p class="running-phase">${t.phase}</p>${focus ? '' : '<p class="fine-note">结束时通知你</p>'}</div>`;
  return shell(
    s,
    focus ? `${label(t)} ${s.index + 1}/${s.tasks.length}` : '任务状态',
    content,
    focus ? watchButton('切换任务', 'chooser', { secondary: true }) : '',
    { back: !focus, style: focus ? 'focus' : '' },
  );
}
function home(s) {
  if (s.def.id === 'b') {
    s.taskId = s.tasks[s.index].id;
    return active(task(s))
      ? running(s, { focus: true })
      : result(s, { focus: true });
  }
  if (s.def.id === 'c') {
    const next = notices(s)[0];
    if (next) {
      s.taskId = next.id;
      return result(s, { notice: true });
    }
    return shell(
      s,
      '通知',
      `<div class="empty-state">${icon('check')}<strong>暂无新动态</strong><p>任务完成后，<br>结果会出现在这里。</p></div>`,
      watchButton(`进行中 · ${s.tasks.filter(active).length}`, 'active', {
        secondary: true,
      }),
    );
  }
  return shell(
    s,
    `进行中 · ${s.tasks.filter(active).length}`,
    `<div class="task-list">${s.tasks.filter(active).map(row).join('') || '<div class="empty-state"><strong>任务都已结束</strong><p>查看最近动态，<br>或等待新的任务。</p></div>'}</div>`,
    watchButton(`最近动态 · ${notices(s).length}`, 'inbox', {
      secondary: true,
    }),
  );
}
function body(s) {
  if (s.view === 'home') return home(s);
  if (s.view === 'detail') return active(task(s)) ? running(s) : result(s);
  if (s.view === 'notification') return result(s, { notice: true });
  if (['active', 'inbox', 'chooser'].includes(s.view)) {
    const list =
      s.view === 'active'
        ? s.tasks.filter(active)
        : s.view === 'inbox'
          ? notices(s)
          : s.tasks;
    return shell(
      s,
      s.view === 'active'
        ? '正在进行'
        : s.view === 'inbox'
          ? '最近动态'
          : '选择任务',
      `<div class="task-list">${list.map(row).join('') || '<div class="empty-state"><strong>暂时没有新动态</strong></div>'}</div>`,
      s.view === 'active' && s.def.id === 'c'
        ? watchButton('返回通知', 'home', { secondary: true })
        : '',
      { back: true },
    );
  }
  if (s.view === 'voice')
    return shell(
      s,
      '正在听写',
      `<div class="voice-context">${esc(task(s).agent)} · ${esc(task(s).title)}</div><div class="voice-center"><div class="mic-orb">${icon('mic')}</div><div class="waves">${[7, 12, 18, 10, 15, 8, 17, 11, 6].map((h, i) => `<i style="--height:${h}px;--delay:${i * 0.07}s"></i>`).join('')}</div><p class="voice-help">说出下一步要求</p></div>`,
      watchButton('完成听写', 'finish'),
      { back: true },
    );
  if (s.view === 'confirm')
    return shell(
      s,
      '确认发送',
      `${s.sendError ? '<div class="send-error">未发送 · 草稿保留</div>' : s.offline ? '<div class="send-error">离线 · 草稿保留</div>' : ''}<span class="project-agent">${esc(task(s).agent)} · ${esc(task(s).title)}</span><p class="quote">${esc(draft(s))}</p>`,
      watchButton(s.offline ? '待联网' : '发送', 'send', {
        disabled: s.offline || !draft(s),
      }) + watchButton('重录', 'rerecord', { secondary: true }),
      { back: true, paired: true, style: 'confirm' },
    );
  if (s.view === 'sent')
    return shell(
      s,
      '已发送',
      `<div class="sent-screen">${icon('check')}<strong>任务已接续</strong><p>${esc(task(s).agent)} 已接收要求，<br>完成后通知你。</p></div>`,
      watchButton('跟踪状态', 'track'),
      { back: true },
    );
  if (s.view === 'menu')
    return shell(
      s,
      '通知操作',
      `<div class="task-list"><button class="task-row" data-action="clear"><span class="row-copy"><strong>清除这条通知</strong><small>任务结果仍然保留</small></span></button><button class="task-row" data-action="back"><span class="row-copy"><strong>返回结果</strong><small>继续查看或语音续聊</small></span></button></div>`,
      '',
      { back: true },
    );
  return '';
}
function render(s) {
  if (['voice', 'confirm', 'sent', 'active'].includes(s.view)) s.stage = s.view;
  else if (s.view === 'notification' || s.view === 'inbox')
    s.stage = 'notification';
  else if (s.view === 'detail')
    s.stage = active(task(s)) ? 'active' : 'notification';
  const screen = s.root.querySelector('.screen');
  screen.classList.toggle('offline', s.offline);
  screen.dataset.view = s.view;
  screen.innerHTML = body(s);
  s.root.querySelector('.scene-description').textContent =
    s.toast ||
    {
      home:
        s.def.id === 'b'
          ? '左右滑动或点表冠切换任务。'
          : s.def.id === 'c'
            ? '点左上角 S 查看进行中；× 只清除通知。'
            : '点任务查看状态；底部进入最近动态。',
      voice: '听写模拟，不需要在手表里输入文字。',
      confirm: '确认后才发送；返回会保留草稿。',
      sent: '已发送到同一会话，开始新的执行。',
      detail: '正在进行时只看状态；结束后可以语音续聊。',
      notification: '收到结果，可以直接语音续聊。',
    }[s.view] ||
    '可在手表内点选，或使用场景按钮。';
  s.root
    .querySelectorAll('[data-stage]')
    .forEach((b) =>
      b.setAttribute('aria-pressed', b.dataset.stage === s.stage),
    );
  const offline = s.root.querySelector('[data-demo="offline"]');
  offline.textContent = s.offline ? '恢复网络' : '模拟离线';
}
function go(s, view) {
  s.history.push(s.view);
  s.view = view;
  render(s);
}
function act(s, action, id) {
  if (action === 'back') {
    s.view = s.history.pop() || 'home';
    s.toast = '';
    render(s);
    return;
  }
  if (action === 'home') {
    s.view = 'home';
    s.history = [];
    render(s);
    return;
  }
  if (['active', 'inbox', 'chooser', 'menu'].includes(action)) {
    go(s, action);
    return;
  }
  if (action === 'task') {
    s.taskId = id;
    s.index = s.tasks.findIndex((t) => t.id === id);
    if (s.def.id === 'b') {
      s.view = 'home';
      render(s);
    } else go(s, 'detail');
    return;
  }
  if (action === 'next') {
    if (s.def.id !== 'b') return;
    s.index = (s.index + 1) % s.tasks.length;
    s.taskId = s.tasks[s.index].id;
    s.view = 'home';
    s.history = [];
    render(s);
    return;
  }
  if (action === 'previous') {
    if (s.def.id !== 'b') return;
    s.index = (s.index + s.tasks.length - 1) % s.tasks.length;
    s.taskId = s.tasks[s.index].id;
    s.view = 'home';
    s.history = [];
    render(s);
    return;
  }
  if (action === 'voice') {
    if (active(task(s))) return;
    s.sendError = false;
    go(s, draft(s) ? 'confirm' : 'voice');
    return;
  }
  if (action === 'rerecord') {
    go(s, 'voice');
    return;
  }
  if (action === 'finish') {
    s.drafts[s.taskId] = speech;
    s.sendError = false;
    if (s.history.at(-1) === 'confirm') s.history.pop();
    s.view = 'confirm';
    render(s);
    return;
  }
  if (action === 'send') {
    if (s.offline || !draft(s)) return;
    if (s.failNext) {
      s.failNext = false;
      s.sendError = true;
      render(s);
      return;
    }
    s.sentCount += 1;
    const t = task(s);
    t.status = 'running';
    t.elapsed = '0:01';
    t.phase = '准备执行追问';
    s.cleared.delete(t.id);
    delete s.drafts[s.taskId];
    s.sendError = false;
    s.history = ['home'];
    s.view = 'sent';
    render(s);
    return;
  }
  if (action === 'track') {
    s.view = s.def.id === 'b' ? 'home' : 'detail';
    s.history = ['home'];
    render(s);
    return;
  }
  if (action === 'clear') {
    s.cleared.add(s.taskId);
    s.view = s.def.id === 'c' ? 'home' : 'inbox';
    s.history = [];
    render(s);
  }
}
function stage(s, value) {
  s.toast = '';
  s.stage = value;
  s.history = [];
  s.sendError = false;
  if (value === 'initial') {
    s.view = 'home';
    render(s);
    return;
  }
  if (value === 'active') {
    s.view = s.def.id === 'a' ? 'home' : s.def.id === 'b' ? 'home' : 'active';
    s.index = 0;
    s.taskId = s.tasks[0].id;
    render(s);
    return;
  }
  const last = s.tasks.find((t) => !active(t)) || s.tasks[2];
  last.status = last.status === 'failed' ? 'failed' : 'complete';
  s.cleared.delete(last.id);
  s.taskId = last.id;
  s.index = s.tasks.indexOf(last);
  if (value === 'notification') {
    s.view = s.def.id === 'b' ? 'home' : 'notification';
  }
  if (value === 'voice') {
    s.view = 'voice';
    s.history = [s.def.id === 'b' ? 'home' : 'detail'];
  }
  if (value === 'confirm') {
    s.drafts[s.taskId] = speech;
    s.view = 'confirm';
    s.history = [s.def.id === 'b' ? 'home' : 'detail'];
  }
  render(s);
}
function simulate(s, value) {
  s.toast = '';
  if (value === 'reset') {
    s.tasks = structuredClone(seed);
    s.taskId = 'reconnect';
    s.index = 0;
    s.view = 'home';
    s.stage = 'initial';
    s.offline = false;
    s.failNext = false;
    s.sendError = false;
    s.drafts = {};
    s.cleared = new Set();
    s.history = [];
    s.sentCount = 0;
    render(s);
    return;
  }
  if (value === 'offline') {
    s.offline = !s.offline;
    render(s);
    return;
  }
  if (value === 'failure') {
    stage(s, 'confirm');
    s.failNext = true;
    s.toast = '点“发送”模拟一次失败，之后可重试。';
    render(s);
    return;
  }
  if (value === 'complete' || value === 'failed') {
    if (s.offline) {
      s.toast = '离线状态保留上次快照，恢复网络后再模拟同步。';
      render(s);
      return;
    }
    const t = active(task(s)) ? task(s) : s.tasks.find(active) || task(s);
    t.status = value === 'failed' ? 'failed' : 'complete';
    t.elapsed = '刚刚';
    if (value === 'failed')
      t.summary = '仓库访问失败，执行已停止。可以语音说明下一步处理要求。';
    s.cleared.delete(t.id);
    if (['voice', 'confirm'].includes(s.view)) {
      s.toast = '新通知已进入动态列表，当前听写和草稿保留。';
    } else if (s.def.id === 'c') {
      s.taskId = t.id;
      s.view = 'notification';
      s.history = [];
    }
    render(s);
  }
}
for (const def of defs) {
  const root = document.createElement('article');
  root.id = `concept-${def.id}`;
  root.className = 'concept';
  root.innerHTML = `<div class="concept-top"><span class="concept-tag">${def.label}</span>${def.recommend ? '<span class="recommend">推荐方向</span>' : ''}</div><h2>${def.name}</h2><p class="description">${def.description}</p><div class="hardware-stage"><div class="hardware"><div class="screen" tabindex="0" role="region" aria-label="${def.name}手表界面"></div><button class="crown" data-action="next" ${def.id === 'b' ? '' : 'disabled'} aria-label="表冠：切换到下一个任务"></button><div class="side-button"></div></div></div><div class="scene-controls"><p class="scene-description"></p><div class="scene-buttons">${[
    ['initial', '初始界面'],
    ['active', '进行中'],
    ['notification', '完成通知'],
    ['voice', '听写'],
    ['confirm', '确认发送'],
  ]
    .map(
      ([id, label]) =>
        `<button data-stage="${id}" aria-pressed="false">${label}</button>`,
    )
    .join('')}</div><div class="scenario-buttons">${[
    ['complete', '任务完成'],
    ['failed', '任务失败'],
    ['offline', '模拟离线'],
    ['failure', '发送失败'],
    ['reset', '重置'],
  ]
    .map(([id, label]) => `<button data-demo="${id}">${label}</button>`)
    .join('')}</div></div><p class="concept-foot">${def.foot}</p>`;
  document.querySelector('.concepts').append(root);
  const s = {
    def,
    root,
    tasks: structuredClone(seed),
    view: 'home',
    stage: 'initial',
    taskId: 'reconnect',
    index: 0,
    history: [],
    drafts: {},
    cleared: new Set(),
    offline: false,
    failNext: false,
    sendError: false,
    sentCount: 0,
    toast: '',
  };
  states[def.id] = s;
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.stage) stage(s, b.dataset.stage);
    else if (b.dataset.demo) simulate(s, b.dataset.demo);
    else if (b.dataset.action) act(s, b.dataset.action, b.dataset.id);
  });
  let pointer;
  root.querySelector('.screen').addEventListener('pointerdown', (e) => {
    pointer = { x: e.clientX, y: e.clientY };
  });
  root.querySelector('.screen').addEventListener('pointerup', (e) => {
    if (s.def.id === 'b' && s.view === 'home' && pointer) {
      const dx = e.clientX - pointer.x,
        dy = e.clientY - pointer.y;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy))
        act(s, dx < 0 ? 'next' : 'previous');
    }
    pointer = null;
  });
  root.querySelector('.screen').addEventListener('keydown', (e) => {
    if (
      s.def.id === 'b' &&
      s.view === 'home' &&
      ['ArrowLeft', 'ArrowRight'].includes(e.key)
    ) {
      e.preventDefault();
      act(s, e.key === 'ArrowRight' ? 'next' : 'previous');
    }
  });
  render(s);
  const column = document.createElement('article');
  column.className = 'flow-column';
  column.innerHTML = `<h3>${def.id.toUpperCase()} · ${def.name}</h3><div class="story-images">${[
    ['result', '结果'],
    ['voice', '听写'],
    ['confirm', '确认'],
    ['sent', '接续'],
  ]
    .map(
      ([view, label], i) =>
        `<figure><img src="previews/${def.id}-${view}.png" alt="${def.name}的${label}界面"><figcaption>${i + 1}. ${label}</figcaption></figure>`,
    )
    .join('')}</div><p>${def.foot}</p>`;
  document.querySelector('.flow-grid').append(column);
}
let actualScale = false;
function updateDisplay() {
  const large = document.body.classList.contains('large');
  document.querySelector('.size-note').textContent =
    `${large ? '44mm / 184 × 224' : '40mm / 162 × 197'} pt · ${actualScale ? '1:1 比例' : '当前放大预览'}`;
  if (actualScale)
    document.documentElement.style.setProperty('--preview-scale', '1');
  else document.documentElement.style.removeProperty('--preview-scale');
  document.querySelector('[data-scale]').textContent = actualScale
    ? '切换到放大预览'
    : '切换到 1:1 比例';
}
document.querySelectorAll('[data-size]').forEach((b) =>
  b.addEventListener('click', () => {
    const large = b.dataset.size === '44';
    document.body.classList.toggle('large', large);
    document.documentElement.style.setProperty(
      '--watch-w',
      large ? '184px' : '162px',
    );
    document.documentElement.style.setProperty(
      '--watch-h',
      large ? '224px' : '197px',
    );
    document
      .querySelectorAll('[data-size]')
      .forEach((other) =>
        other.setAttribute('aria-pressed', String(other === b)),
      );
    updateDisplay();
  }),
);
document.querySelector('[data-scale]').addEventListener('click', () => {
  actualScale = !actualScale;
  updateDisplay();
});
