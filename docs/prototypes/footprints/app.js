const $ = (s) => document.querySelector(s);
const icons = {
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  edit: '<path d="M12 4H4v16h16v-8M10 14l1-5 8-8 4 4-8 8z"/>',
  folder: '<path d="M3 7V4h6l3 3h9v13H3z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  box: '<path d="m12 3 9 5v10l-9 4-9-4V8zm-9 5 9 5 9-5M12 13v9"/>',
  foot: '<path d="M7 3c-3 0-4 8-1 10 4 2 5-10 1-10zm10 7c-3 0-4 8-1 10 4 2 5-10 1-10M5 17l3 1m7 5 3-1"/>',
  file: '<path d="M5 3h9l5 5v13H5zm9 0v6h5M8 13h8M8 17h5"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="m9 3-1 3-3 1-2 4 2 3 1 4 4 3 3-2 4-1 3-4-2-3-1-4-4-3z"/>',
  agent:
    '<rect x="4" y="7" width="16" height="13" rx="4"/><path d="M12 3v4M8 12v2m8-2v2M9 17h6"/>',
  server:
    '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 7h.1M7 17h.1"/>',
  spark: '<path d="m12 3 3 6 6 3-6 3-3 6-3-6-6-3 6-3zM20 2v4m-2-2h4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  chat: '<path d="M21 11a9 9 0 0 1-13 8l-5 2 1-6A9 9 0 1 1 21 11Z"/>',
  user: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-3a8 8 0 0 1 16 0v3"/>',
  token: '<path d="m12 2 9 5v10l-9 5-9-5V7zM12 7v10M8 9h8"/>',
};
const icon = (n) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[n] || icons.file}</svg>`;
document
  .querySelectorAll('[data-icon]')
  .forEach((e) => (e.outerHTML = icon(e.dataset.icon)));
const topics = [
  '足迹产品方案设计',
  'SSH 连接稳定性修复',
  '优化工作区导航体验',
  '固件升级流程梳理',
  '会话上下文保留策略',
  '修复产物预览布局',
  'Agent 运行状态展示',
  '设备配网异常排查',
];
const data = Array.from({ length: 20 }, (_, i) => ({
  id: i,
  title: topics[i % 8],
  project: [3, 7].includes(i % 8) ? 'FoloToy' : 'Steer',
  day: 19 + Math.floor((i * 7) / 20),
  human: 5 + ((i * 3) % 14),
  agent: 7 + ((i * 5) % 19),
  tokens: i === 18 ? null : 42000 + ((i * 7127) % 130000),
  fresh: i % 5 !== 0,
  time: `${10 + (i % 10)}:${i % 2 ? '42' : '18'}`,
}));
let start = '2026-10-19',
  end = '2026-10-25',
  project = 'all',
  day = null,
  reportScope = [],
  returnFocus = null;
let reports = [];
try {
  reports = JSON.parse(
    localStorage.getItem('steer-footprints-design-reports') || '[]',
  );
} catch {}
const date = (d) => `2026-10-${d}`;
const fmt = (n) =>
  n >= 1e6
    ? (n / 1e6).toFixed(2) + 'M'
    : n >= 1000
      ? (n / 1000).toFixed(1) + 'K'
      : n.toLocaleString();
const filtered = () =>
  data.filter(
    (d) =>
      date(d.day) >= start &&
      date(d.day) <= end &&
      (project === 'all' || d.project === project),
  );
const sum = (a, k) => a.reduce((n, d) => n + (d[k] || 0), 0);
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
function render() {
  const a = filtered();
  $('#range-label').textContent =
    `${start.replaceAll('-', '.')} — ${end.replaceAll('-', '.')}`;
  const cards = [
    [
      '活跃会话',
      a.length,
      `其中 <b>${a.filter((x) => x.fresh).length}</b> 个在此期间发起`,
      'chat',
    ],
    ['你的消息', sum(a, 'human'), '按用户发送的消息计数', 'user'],
    ['Agent 回复', sum(a, 'agent'), '不包含工具调用与流式片段', 'agent'],
    [
      'Token 用量',
      fmt(sum(a, 'tokens')),
      a.some((x) => x.tokens === null)
        ? '已知用量 · 1 个会话未上报'
        : '输入 + 输出 · Runtime 上报',
      'token',
    ],
  ];
  $('#metrics').innerHTML = cards
    .map(
      ([l, v, s, i]) =>
        `<div class="metric"><div class="metric-label">${l}${icon(i)}</div><div class="metric-value">${v}</div><div class="metric-sub ${i === 'token' && a.some((x) => x.tokens === null) ? 'warn' : ''}">${s}</div></div>`,
    )
    .join('');
  const m = $('#metric').value;
  const dates = [];
  for (
    const t = new Date(start + 'T00:00:00Z');
    t <= new Date(end + 'T00:00:00Z');
    t.setUTCDate(t.getUTCDate() + 1)
  )
    dates.push(t.toISOString().slice(0, 10));
  const groups = dates.map((d) => a.filter((x) => date(x.day) === d));
  const max = Math.max(
    1,
    ...groups.map((g) =>
      m === 'messages'
        ? Math.max(sum(g, 'human'), sum(g, 'agent'))
        : m === 'sessions'
          ? g.length
          : sum(g, 'tokens'),
    ),
  );
  $('#axis').innerHTML = [max, Math.round(max / 2), 0]
    .map((v) => `<span>${fmt(v)}</span>`)
    .join('');
  $('#legend').innerHTML =
    m === 'messages'
      ? '<span><i></i>你的消息</span><span><i class="agent"></i>Agent 回复</span>'
      : `<span><i></i>${m === 'sessions' ? '活跃会话' : '已知 Token'}</span>`;
  $('#chart').innerHTML = dates
    .map((d, i) => {
      const g = groups[i],
        v =
          m === 'messages'
            ? [sum(g, 'human'), sum(g, 'agent')]
            : [m === 'sessions' ? g.length : sum(g, 'tokens')];
      return `<button class="day ${day === d ? 'chosen' : ''}" data-day="${d}" aria-label="${d} ${v.join(' / ')}" title="${d}：${v.map(fmt).join(' / ')}"><span class="bars">${v.map((n, j) => `<span class="bar ${j ? 'agent' : ''}" style="height:${(n / max) * 110}px"></span>`).join('')}</span><span class="day-label">${d.slice(5).replace('-', '/')}</span></button>`;
    })
    .join('');
  const rows = a
    .filter((x) => !day || date(x.day) === day)
    .sort((a, b) => b.day - a.day || b.time.localeCompare(a.time));
  $('#session-count').textContent =
    `${rows.length} 个会话${day ? ' · ' + day.slice(5).replace('-', '/') : ''}`;
  $('#clear-day').hidden = !day;
  $('#rows').innerHTML = rows.length
    ? rows
        .map(
          (d) =>
            `<tr><td><button data-session="${d.id}">${esc(d.title)}</button><small>${d.project} · ${d.id % 2 ? 'Claude Code' : 'Codex'}${d.fresh ? ' · 新会话' : ''}</small></td><td>${d.human}</td><td>${d.agent}</td><td>${d.tokens === null ? '<span title="Runtime 未提供用量；不计为 0">未上报</span>' : fmt(d.tokens)}</td><td>10/${d.day} ${d.time}</td><td>›</td></tr>`,
        )
        .join('')
    : '<tr><td colspan="6" class="empty">这个时间范围内还没有活动，试试其他日期。</td></tr>';
  $('#coverage').textContent =
    `用量覆盖 ${a.filter((x) => x.tokens !== null).length} / ${a.length} 个会话`;
  $('#report-open').disabled = !a.length;
  renderReports();
}
function renderReports() {
  $('#report-count').textContent = reports.length;
  $('#report-list').innerHTML = reports.length
    ? reports
        .map(
          (r, i) =>
            `<button class="report-card" data-report="${i}"><div>${esc(r.title)}<small>${esc(r.range)} · ${r.ids.length} 个来源会话</small></div><span>查看报告 →</span></button>`,
        )
        .join('')
    : '<div class="empty">还没有报告<br><small>选择时间范围，生成你的第一份工作总结。</small></div>';
}
function open(title, subtitle) {
  returnFocus = document.activeElement;
  $('#drawer-title').textContent = title;
  $('#drawer-subtitle').textContent = subtitle;
  $('#drawer').hidden = false;
  $('#shade').hidden = false;
  document.querySelector('.app').inert = true;
  document.body.style.overflow = 'hidden';
  $('#close').focus();
}
function close() {
  $('#drawer').hidden = true;
  $('#shade').hidden = true;
  document.querySelector('.app').inert = false;
  document.body.style.overflow = '';
  returnFocus?.focus();
}
$('#close').onclick = close;
$('#shade').onclick = close;
document.addEventListener('keydown', (e) => {
  if ($('#drawer').hidden) return;
  if (e.key === 'Escape') close();
  if (e.key === 'Tab') {
    const f = [
      ...$('#drawer').querySelectorAll('button,input,textarea,select'),
    ].filter((x) => !x.disabled);
    if (e.shiftKey && document.activeElement === f[0]) {
      e.preventDefault();
      f.at(-1).focus();
    } else if (!e.shiftKey && document.activeElement === f.at(-1)) {
      e.preventDefault();
      f[0].focus();
    }
  }
});
function session(id) {
  const d = data.find((x) => x.id === id);
  open(d.title, `${d.project} · 10/${d.day} ${d.time} · 来源预览`);
  $('#drawer-body').innerHTML =
    `<span class="report-tag">示例会话</span><div class="scope-box" style="margin-top:18px">${d.human} 条用户消息 · ${d.agent} 条 Agent 回复<small>Token：${d.tokens === null ? '未上报' : fmt(d.tokens)} · 以下仅展示示例摘录</small></div><div class="message human"><small>你 · ${d.time}</small>我们来梳理一下「${d.title}」，明确问题和下一步的方案。</div><div class="message"><small>Agent</small>已整理这项工作的讨论要点与待验证事项。当前结论仍需要结合实际代码和验证结果确认。</div><p class="help">正式实现中，来源链接定位到原会话对应时间的消息。原型不跳转到真实会话。</p>`;
}
$('#report-open').onclick = () => {
  reportScope = filtered().filter((x) => !day || date(x.day) === day);
  open('生成报告', '将这一段工作，整理成可复用的总结。');
  $('#drawer-body').innerHTML =
    `<div class="scope-box"><strong>${day || start + ' — ' + end}</strong><small>${project === 'all' ? '全部项目' : project} · ${reportScope.length} 个会话 · ${sum(reportScope, 'human') + sum(reportScope, 'agent')} 条消息</small><small>仅使用所选范围内的消息，不包含范围外的上下文。</small></div><label class="field"><span>报告名称</span><input id="title" value="${day || start.slice(5).replace('-', '.') + ' — ' + end.slice(5).replace('-', '.')} 工作回顾"></label><label class="field"><span>组织方式</span><select id="group"><option>按项目归纳</option><option>按日期回顾</option></select></label><label class="field"><span>补充要求 <span class="muted">（可选）</span></span><textarea id="instruction" placeholder="例如：重点总结产品设计和已解决的问题，单独列出待跟进事项。"></textarea></label><p class="help">AI 总结将附带来源。请核对完成状态与结论后再使用。此原型生成固定规则的示例报告，不调用 AI。</p><button id="generate" class="primary full">${icon('spark')}生成报告</button>`;
  $('#generate').onclick = () => {
    const title = $('#title').value || '工作回顾',
      group = $('#group').value,
      instruction = $('#instruction').value;
    const keys = [
      ...new Set(
        reportScope.map((x) =>
          group === '按项目归纳' ? x.project : date(x.day),
        ),
      ),
    ];
    let body = keys
      .map(
        (k) =>
          `${k}\n${[...new Set(reportScope.filter((x) => (group === '按项目归纳' ? x.project : date(x.day)) === k).map((x) => x.title))].map((t) => '• 讨论与推进：' + t + '（完成情况待核实）。').join('\n')}`,
      )
      .join('\n\n');
    if (instruction) body += '\n\n补充要求（留待 AI 处理）\n' + instruction;
    body += '\n\n待跟进\n核对各项变更的验证结果，并确认未完成事项。';
    editor(
      {
        title,
        body,
        range: day || start + ' — ' + end,
        ids: reportScope.map((x) => x.id),
      },
      null,
    );
  };
};
function editor(r, index) {
  $('#drawer-title').textContent = '报告草稿';
  $('#drawer-subtitle').textContent = r.range + ' · 可编辑，附来源';
  $('#drawer-body').innerHTML =
    `<label class="field"><span>报告名称</span><input id="edit-title" value="${esc(r.title)}"></label><label class="field"><span>报告内容 <span class="report-tag">示例生成</span></span><textarea class="report-editor" id="edit-body">${esc(r.body)}</textarea></label><details><summary class="small">来源会话 · ${r.ids.length} 个</summary>${r.ids.map((id) => `<button class="source" data-source="${id}">${icon('chat')}${esc(data[id].title)} ↗</button>`).join('')}</details><p class="help">保存到此浏览器的原型存储，不写入 Steer 工作区。</p><div class="drawer-actions"><button id="download">导出 Markdown</button><button class="primary" id="save">保存报告</button></div>`;
  const current = () => ({
    ...r,
    title: $('#edit-title').value,
    body: $('#edit-body').value,
  });
  $('#save').onclick = () => {
    if (index === null) {
      reports.unshift(current());
      index = 0;
    } else reports[index] = current();
    try {
      localStorage.setItem(
        'steer-footprints-design-reports',
        JSON.stringify(reports),
      );
      renderReports();
      toast('报告已保存到当前浏览器');
    } catch {
      toast('浏览器存储不可用，请导出报告');
    }
  };
  $('#download').onclick = () => {
    const c = current(),
      blob = new Blob([`# ${c.title}\n\n${c.range}\n\n${c.body}`], {
        type: 'text/markdown',
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = 'Steer-足迹报告.md';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $('#drawer-body')
    .querySelectorAll('[data-source]')
    .forEach(
      (b) =>
        (b.onclick = () => {
          const draft = current();
          session(+b.dataset.source);
          const back = document.createElement('button');
          back.textContent = '← 返回报告草稿';
          back.onclick = () => editor(draft, index);
          $('#drawer-body').prepend(back);
        }),
    );
}
function toast(t) {
  $('#toast').textContent = t;
  $('#toast').hidden = false;
  setTimeout(() => ($('#toast').hidden = true), 2400);
}
document.addEventListener('click', (e) => {
  const dayButton = e.target.closest('[data-day]');
  if (dayButton) {
    day = day === dayButton.dataset.day ? null : dayButton.dataset.day;
    render();
  }
  const s = e.target.closest('[data-session]');
  if (s) session(+s.dataset.session);
  const r = e.target.closest('[data-report]');
  if (r) {
    open('报告草稿', '');
    editor(reports[+r.dataset.report], +r.dataset.report);
  }
});
$('#clear-day').onclick = () => {
  day = null;
  render();
};
$('#project').onchange = (e) => {
  project = e.target.value;
  day = null;
  render();
};
$('#metric').onchange = render;
document.querySelectorAll('[data-range]').forEach(
  (b) =>
    (b.onclick = () => {
      document
        .querySelectorAll('[data-range]')
        .forEach((x) => x.classList.toggle('chosen', x === b));
      $('.custom-dates').hidden = b.dataset.range !== 'custom';
      if (b.dataset.range === 'custom') return;
      start = b.dataset.range === 'today' ? '2026-10-25' : '2026-10-19';
      end = '2026-10-25';
      day = null;
      render();
    }),
);
$('#apply').onclick = () => {
  const s = $('#start').value,
    e = $('#end').value;
  if (!s || !e || s > e || (new Date(e) - new Date(s)) / 86400000 > 30) {
    $('#date-error').textContent = '请选择有效的日期范围（最多 31 天）';
    return;
  }
  $('#date-error').textContent = '';
  start = s;
  end = e;
  day = null;
  render();
};
document.querySelectorAll('[data-tab]').forEach(
  (b) =>
    (b.onclick = () => {
      document
        .querySelectorAll('[data-tab]')
        .forEach((x) => x.classList.toggle('selected', x === b));
      $('#overview').hidden = b.dataset.tab !== 'overview';
      $('#reports').hidden = b.dataset.tab !== 'reports';
    }),
);
render();
