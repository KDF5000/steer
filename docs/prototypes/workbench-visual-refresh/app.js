const designData = {
  agents: [
    {
      id: 'agent-primary',
      name: 'Traex-GPT-5.6-Sol-Local',
      role: '开发与协作',
      runtimeProvider: 'trae',
      runtimeId: 'mac-mini/trae',
      model: 'GPT-6.1-Sol',
    },
    {
      id: 'agent-reviewer',
      name: 'Traex-Seed2.1-Turbo',
      role: '独立检查',
      runtimeProvider: 'trae',
      runtimeId: 'mac-mini/trae',
      model: 'Seed2.1-Turbo',
    },
    {
      id: 'agent-writer',
      name: 'Writer',
      role: '文案整理',
      runtimeProvider: 'trae',
      runtimeId: 'mac-mini/trae',
    },
  ],
  projects: [
    {
      id: 'relay',
      name: 'Relay',
      workspaceKind: 'local',
      workspaceSource: '/Users/kongdefei/Documents/Coding/relay',
      nodeId: 'mac-mini',
      executionMode: 'in_place',
    },
    {
      id: 'talorys',
      name: 'talorys',
      workspaceKind: 'local',
      workspaceSource: '/Users/kongdefei/Documents/Coding/steer',
      nodeId: 'mac-mini',
      executionMode: 'in_place',
    },
    {
      id: 'soundcore',
      name: 'Soundcore',
      workspaceKind: 'local',
      workspaceSource: '/Users/kongdefei/Documents/Coding/steer',
      nodeId: 'mac-mini',
      executionMode: 'in_place',
    },
    {
      id: 'steer',
      name: 'Steer',
      workspaceKind: 'local',
      workspaceSource: '/Users/kongdefei/Documents/Coding/steer',
      nodeId: 'mac-mini',
      executionMode: 'in_place',
    },
  ],
  sessions: [
    {
      id: 'main',
      title: '工作台 UI 与 Agent 协作',
      agentId: 'agent-primary',
      projectId: 'steer',
      executionRuntimeId: 'mac-mini/trae',
      createdAt: '2026-10-24T10:24:00+08:00',
      updatedAt: '2026-10-24T10:24:00+08:00',
    },
    {
      id: 'review',
      title: '检查状态回传与异常路径',
      agentId: 'agent-reviewer',
      projectId: 'steer',
      parentConversationId: 'main',
      executionRuntimeId: 'mac-mini/codex',
      createdAt: '2026-10-24T10:24:00+08:00',
      updatedAt: '2026-10-24T10:24:00+08:00',
    },
    {
      id: 'runtime',
      title: '运行环境与模型发现',
      agentId: 'agent-primary',
      projectId: 'steer',
      executionRuntimeId: 'mac-mini/trae',
      createdAt: '2026-10-24T10:24:00+08:00',
      updatedAt: '2026-10-24T10:24:00+08:00',
    },
    {
      id: 'feishu',
      title: '飞书机器人接入',
      agentId: 'agent-primary',
      projectId: 'steer',
      executionRuntimeId: 'mac-mini/trae',
      createdAt: '2026-10-24T10:24:00+08:00',
      updatedAt: '2026-10-24T10:24:00+08:00',
    },
    {
      id: 'website',
      title: '官网文案与云端部署',
      agentId: 'agent-primary',
      projectId: 'steer',
      executionRuntimeId: 'mac-mini/trae',
      createdAt: '2026-10-24T10:24:00+08:00',
      updatedAt: '2026-10-24T10:24:00+08:00',
    },
    {
      id: 'relay-work',
      title: '事件批量上传与性能验证',
      agentId: 'agent-primary',
      projectId: 'relay',
      executionRuntimeId: 'mac-mini/trae',
      createdAt: '2026-10-24T10:24:00+08:00',
      updatedAt: '2026-10-24T10:24:00+08:00',
    },
  ],
  messages: [
    {
      id: 'request',
      role: 'user',
      content:
        '让同一会话里的 Agent 可以接续工作，也能把一轮任务临时交给其他 Agent。',
      status: 'complete',
      createdAt: '2026-10-24T10:24:00+08:00',
      updatedAt: '2026-10-24T02:24:00.000Z',
    },
    {
      id: 'implementation',
      role: 'agent',
      content:
        '已完成同机 Agent 的协作能力。项目选择机器，Agent 决定执行方式。\n\n- 同一会话可切换 Trae、Codex 等不同 Runtime。\n- 临时委派使用独立上下文，并共享当前工作目录。\n- 任务结果回到原会话，可以交给主 Agent 继续。\n\n前后端验证通过，修改尚未提交。',
      status: 'succeeded',
      createdAt: '2026-10-24T10:24:00+08:00',
      updatedAt: '2026-10-24T02:24:37.000Z',
      context: {
        agentId: 'agent-primary',
        agentName: 'Traex-GPT-5.6-Sol-Local',
        ownerAgentId: 'agent-primary',
      },
    },
    {
      id: 'review-request',
      role: 'user',
      content: '检查状态回传和异常路径，先不要修改代码。',
      status: 'complete',
      createdAt: '2026-10-24T10:24:00+08:00',
      updatedAt: '2026-10-24T02:24:45.000Z',
      context: {
        agentId: 'agent-reviewer',
        agentName: 'Traex-Seed2.1-Turbo',
        ownerAgentId: 'agent-primary',
        delegated: true,
        delegationSessionId: 'review',
        parentConversationId: 'main',
        taskId: 'task-review',
        reference: {
          messageId: 'implementation',
          agentName: 'Traex-GPT-5.6-Sol-Local',
          content:
            '已完成同机 Agent 的协作能力。项目选择机器，Agent 决定执行方式。\n\n- 同一会话可切换 Trae、Codex 等不同 Runtime。\n- 临时委派使用独立上下文，并共享当前工作目录。\n- 任务结果回到原会话，可以交给主 Agent 继续。\n\n前后端验证通过，修改尚未提交。',
        },
      },
    },
    {
      id: 'review-result',
      role: 'agent',
      content:
        '检查完成。有两处值得继续关注：\n\n1. 主任务先开始、委派后完成时，下一轮仍需收到委派结果。\n2. 委派提交失败时，应保留用户输入和引用。\n\n相关回归已覆盖这两种情况，未发现新的阻塞问题。',
      status: 'succeeded',
      createdAt: '2026-10-24T10:24:00+08:00',
      updatedAt: '2026-10-24T02:25:03.000Z',
      context: {
        agentId: 'agent-reviewer',
        agentName: 'Traex-Seed2.1-Turbo',
        ownerAgentId: 'agent-primary',
        delegated: true,
        delegationSessionId: 'review',
        parentConversationId: 'main',
        taskId: 'task-review',
        reference: {
          messageId: 'implementation',
          agentName: 'Traex-GPT-5.6-Sol-Local',
          content:
            '已完成同机 Agent 的协作能力。项目选择机器，Agent 决定执行方式。\n\n- 同一会话可切换 Trae、Codex 等不同 Runtime。\n- 临时委派使用独立上下文，并共享当前工作目录。\n- 任务结果回到原会话，可以交给主 Agent 继续。\n\n前后端验证通过，修改尚未提交。',
        },
      },
    },
    {
      id: 'next',
      role: 'user',
      content: '先保留这个方案，我们继续优化工作台的视觉层级。',
      status: 'complete',
      createdAt: '2026-10-24T10:24:00+08:00',
      updatedAt: '2026-10-24T02:25:05.000Z',
    },
    {
      id: 'answer',
      role: 'agent',
      content:
        '可以。先提高侧栏文字和图标的辨识度，再收紧聊天间距，保留现有操作和会话结构。',
      status: 'succeeded',
      createdAt: '2026-10-24T10:24:00+08:00',
      updatedAt: '2026-10-24T02:25:14.000Z',
      context: {
        agentId: 'agent-primary',
        agentName: 'Traex-GPT-5.6-Sol-Local',
        ownerAgentId: 'agent-primary',
      },
    },
  ],
  primary: {
    agentId: 'agent-primary',
    agentName: 'Traex-GPT-5.6-Sol-Local',
    ownerAgentId: 'agent-primary',
  },
  delegated: {
    agentId: 'agent-reviewer',
    agentName: 'Traex-Seed2.1-Turbo',
    ownerAgentId: 'agent-primary',
    delegated: true,
    delegationSessionId: 'review',
    parentConversationId: 'main',
    taskId: 'task-review',
    reference: {
      messageId: 'implementation',
      agentName: 'Traex-GPT-5.6-Sol-Local',
      content:
        '已完成同机 Agent 的协作能力。项目选择机器，Agent 决定执行方式。\n\n- 同一会话可切换 Trae、Codex 等不同 Runtime。\n- 临时委派使用独立上下文，并共享当前工作目录。\n- 任务结果回到原会话，可以交给主 Agent 继续。\n\n前后端验证通过，修改尚未提交。',
    },
  },
};
(() => {
  const $ = (selector, root = document) =>
    (root || document).querySelector(selector);
  const $$ = (selector, root = document) => [
    ...(root || document).querySelectorAll(selector),
  ];
  const thread = $('.ws-chat-thread');
  const area = $('.ws-chat-center');
  const composer = $('.ws-inline-composer');
  const input = $('.ws-inline-editor');
  const line = $('.ws-inline-line');
  const quoteTemplate = $('.ws-quote-token').cloneNode(true);
  const mentionTemplate = $('.ws-mention-token').cloneNode(true);
  const agentTemplate = $('.ws-chat-message.agent').cloneNode(true);
  const userTemplate = $('.ws-chat-message.user').cloneNode(true);
  const arrow =
    $('.lucide-arrow-up-right')?.outerHTML ||
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M7 17 17 7M7 7h10v10"/></svg>';
  const spinner =
    '<svg viewBox="0 0 24 24" class="ws-delegation-spinner" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M12 3a9 9 0 1 1-8.4 5.8"/></svg>';
  const messages = new Map(
    designData.messages.map((message) => [message.id, message]),
  );
  $$('.ws-chat-message', thread).forEach((node, index) => {
    node.dataset.messageId = designData.messages[index]?.id;
  });
  const mainHtml = thread.innerHTML;
  let currentSession = 'main';
  let owner = designData.agents[0];
  let target = designData.agents[1];
  let quote = designData.messages.at(-1);
  let quoteRemoved = false;
  let menuIndex = 0;
  const rightSidebar = $('[data-slot="sidebar"][data-side="right"]');
  $('.ws-sidebar-resize-handle')?.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || innerWidth < 768) return;
    event.preventDefault();
    const wrapper = $('.ws');
    const startWidth = $(
      '[data-slot="sidebar-container"][data-side="left"]',
    ).getBoundingClientRect().width;
    const startX = event.clientX;
    const controller = new AbortController();
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener(
      'pointermove',
      (move) => {
        const width = Math.max(
          200,
          Math.min(420, startWidth + move.clientX - startX),
        );
        wrapper.style.setProperty('--design-sidebar-width', `${width}px`);
      },
      { signal: controller.signal },
    );
    const stop = () => {
      controller.abort();
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointerup', stop, {
      once: true,
      signal: controller.signal,
    });
    window.addEventListener('pointercancel', stop, {
      once: true,
      signal: controller.signal,
    });
  });
  const mainSnapshots = new Map([['main', mainHtml]]);
  const caption = $('.ws-chat-mode-note');
  function updateCaption() {
    caption.textContent = `${owner.name} · Mac mini / Trae · ${owner.model || 'Runtime default'}`;
  }
  function focus() {
    input.focus();
    const range = document.createRange();
    range.selectNodeContents(input);
    range.collapse(false);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
  function text(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = content;
    return element;
  }
  function toast(message) {
    $('.design-toast')?.remove();
    const node = text('div', 'design-toast', message);
    node.setAttribute('role', 'status');
    document.body.append(node);
    setTimeout(() => node.remove(), 2400);
  }
  function summary(content) {
    return content
      .replace(/[#*_`>]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
  }
  function renderComposer() {
    $('.ws-quote-token', composer)?.remove();
    $('.ws-mention-token', composer)?.remove();
    $('.ws-mention-picker', composer)?.remove();
    if (quote) {
      const node = quoteTemplate.cloneNode(true);
      $('summary > span:last-child', node).textContent = summary(quote.content);
      $('.ws-quote-preview', node).textContent = quote.content;
      $('.ws-quote-remove', node).onclick = () => {
        quote = null;
        quoteRemoved = true;
        renderComposer();
        focus();
      };
      composer.prepend(node);
    }
    if (target) {
      const node = mentionTemplate.cloneNode(true);
      $('button > span', node).textContent = '@' + target.name;
      $('button', node).setAttribute(
        'aria-label',
        `${target.name} · 按退格键移除`,
      );
      $('button', node).onclick = focus;
      line.prepend(node);
    }
    $$(
      '.ws-chat-message-actions button[aria-label="引用回复"]',
      thread,
    ).forEach((button) => {
      const selected =
        button.closest('.ws-chat-message').dataset.messageId === quote?.id;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('is-quoted', selected);
    });
    $('.ws-chat-send').disabled = !input.textContent.trim();
  }
  function setOwner(agent) {
    owner = agent;
    const button = $('.ws-composer-agent');
    $('.ws-agent-avatar', button).textContent = agent.name[0];
    const labels = $$('span', button);
    labels[1].textContent = agent.name;
    button.title = agent.name;
    target = null;
    updateCaption();
    renderComposer();
  }
  function openModal(title, content, onConfirm) {
    $('.design-modal')?.remove();
    const dialog = document.createElement('dialog');
    dialog.className = 'design-modal';
    dialog.append(text('h2', '', title));
    if (typeof content === 'string')
      dialog.insertAdjacentHTML('beforeend', content);
    else dialog.append(content);
    const actions = text('div', 'design-modal-actions', '');
    const cancel = text('button', '', '关闭');
    cancel.type = 'button';
    cancel.onclick = () => dialog.close();
    actions.append(cancel);
    if (onConfirm) {
      const confirm = text('button', 'design-primary', '确定');
      confirm.type = 'button';
      confirm.onclick = () => {
        onConfirm(dialog);
        dialog.close();
      };
      actions.append(confirm);
    }
    dialog.append(actions);
    document.body.append(dialog);
    dialog.addEventListener('close', () => dialog.remove());
    dialog.showModal();
    $('input,textarea,button', dialog)?.focus();
    return dialog;
  }
  function showAgentPicker() {
    const options = document.createElement('div');
    designData.agents.forEach((agent) => {
      const button = text('button', 'design-option', '');
      button.type = 'button';
      button.append(
        text('span', '', agent.name),
        text('small', '', agent.runtimeProvider === 'codex' ? 'Codex' : 'Trae'),
      );
      button.onclick = () => {
        setOwner(agent);
        button.closest('dialog').close();
        focus();
      };
      options.append(button);
    });
    openModal('选择 Agent', options);
  }
  $('.ws-composer-agent').onclick = showAgentPicker;
  $('.ws-search').onclick = () => {
    const list = document.createElement('div');
    const search = document.createElement('input');
    search.placeholder = '搜索项目、会话和 Agent';
    search.setAttribute('aria-label', '搜索');
    list.append(search);
    const results = document.createElement('div');
    list.append(results);
    const update = () => {
      results.replaceChildren();
      designData.sessions
        .filter((session) =>
          session.title.toLowerCase().includes(search.value.toLowerCase()),
        )
        .forEach((session) => {
          const button = text('button', 'design-option', session.title);
          button.onclick = () => {
            openSession(session.id);
            button.closest('dialog').close();
          };
          results.append(button);
        });
    };
    search.oninput = update;
    update();
    openModal('搜索', list);
  };
  $$('.ws-project-nav-item').forEach((row) => {
    const toggle = $('.ws-project-session-toggle', row);
    let list = $('.ws-session-list', row);
    if (toggle && !list) {
      const template = $('.ws-session-list');
      const projectName = $('.ws-project-nav-button', row)?.textContent.trim();
      const project = designData.projects.find(
        (item) => item.name === projectName,
      );
      const sessions = designData.sessions.filter(
        (item) => item.projectId === project?.id,
      );
      if (template && sessions.length) {
        list = template.cloneNode(false);
        for (const session of sessions) {
          const sessionRow = $('.ws-session-nav-item', template).cloneNode(
            true,
          );
          const button = $('[data-slot="sidebar-menu-button"]', sessionRow);
          button.textContent = session.title;
          button.setAttribute('data-active', 'false');
          list.append(sessionRow);
        }
        list.hidden = true;
        row.append(list);
      }
    }
    if (toggle && list)
      toggle.onclick = () => {
        const open = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', String(!open));
        list.hidden = open;
      };
    const projectButton = $('.ws-project-nav-button', row);
    if (projectButton)
      projectButton.onclick = () => {
        const project = designData.projects.find(
          (item) => item.name === projectButton.textContent.trim(),
        );
        if (project) {
          if (list) {
            list.hidden = false;
            toggle?.setAttribute('aria-expanded', 'true');
          }
          toast(`已选择 ${project.name} 项目`);
        }
      };
  });
  $$('.ws-session-nav-item').forEach((row) => {
    const button = $('[data-slot="sidebar-menu-button"]', row);
    if (!button) return;
    const session = designData.sessions.find(
      (item) => item.title === button.textContent.trim(),
    );
    if (!session) return;
    button.dataset.sessionId = session.id;
    button.title = session.title;
    button.onclick = () => openSession(session.id);
    if (session.parentConversationId) {
      const marker = text('span', 'design-agent-marker', '');
      marker.title = '委派给 Traex-Seed2.1-Turbo';
      marker.innerHTML = arrow;
      button.append(marker);
    }
    const action = $('[data-slot="sidebar-menu-action"]', row);
    if (action)
      action.onclick = (event) => {
        event.stopPropagation();
        openModal(
          '删除会话',
          `<p>确认从此设计预览移除「${session.title}」？</p>`,
          () => {
            row.remove();
            if (currentSession === session.id) openSession('main');
          },
        );
      };
  });
  function simpleThread(session) {
    const container = document.createElement('div');
    if (session.id === 'review') {
      const u = $(
        '[data-message-id="review-request"]',
        document.createRange().createContextualFragment(mainHtml),
      ).cloneNode(true);
      const a = $(
        '[data-message-id="review-result"]',
        document.createRange().createContextualFragment(mainHtml),
      ).cloneNode(true);
      const header = $('.ws-delegation-meta', a);
      header.className = 'ws-chat-response-meta is-complete';
      header.removeAttribute('aria-label');
      header.setAttribute('aria-expanded', 'false');
      header.title = '查看执行过程';
      $$('button[aria-label^="交给"]', a).forEach((button) => button.remove());
      container.append(u, a);
    } else {
      const content = {
        runtime: [
          '运行环境的模型列表能及时更新吗？',
          '可以。每次打开创建或编辑 Agent 的弹窗，都会获取最新的 Runtime 和模型列表，项目位置显示机器名称。',
        ],
        feishu: [
          '在飞书群里怎样继续同一个会话？',
          '在同一条话题或回复线程中继续交流即可。机器人会将该线程关联到同一个 Steer 会话，项目也可以通过 /project 命令切换。',
        ],
        website: [
          '官网和工作台的入口应该怎么安排？',
          '官网用于产品介绍，工作台用于实际工作。官网的工作台入口统一指向 steer-console.pcursor.run。',
        ],
        'relay-work': [
          '批量事件上传的优化效果如何？',
          '已验证事件批量上传能够明显减少逐条 HTTP 往返等待。Agent 输出与事件投递并行，完成后的额外等待显著缩短。',
        ],
      }[session.id] || [
        '开始这个项目的一项任务。',
        '选择 Agent 和项目后，在下方描述你的任务即可。',
      ];
      const u = userTemplate.cloneNode(true);
      u.dataset.messageId = 'sample-user';
      $('p', u).textContent = content[0];
      const a = agentTemplate.cloneNode(true);
      a.dataset.messageId = 'sample-agent';
      $('.ws-markdown', a).replaceChildren(text('p', '', content[1]));
      $('.ws-chat-response-meta span', a).textContent = 'Completed in 9s';
      container.append(u, a);
      messages.set('sample-agent', {
        id: 'sample-agent',
        role: 'agent',
        content: content[1],
        context: designData.primary,
      });
    }
    return container.innerHTML;
  }
  function openSession(id) {
    const session = designData.sessions.find((item) => item.id === id);
    if (!session) return;
    mainSnapshots.set(currentSession, thread.innerHTML);
    currentSession = id;
    thread.innerHTML = mainSnapshots.get(id) || simpleThread(session);
    $('[data-message-id="review-result"] .ws-delegation-meta', thread)
      ?.querySelector('span:nth-of-type(3)')
      ?.replaceChildren(document.createTextNode('Completed in 18s'));
    $('.ws-chat-appbar-context > strong').textContent = session.title;
    const project = designData.projects.find(
      (item) => item.id === session.projectId,
    );
    const pathLabel = $('.ws-chat-appbar-context > span small');
    if (pathLabel) pathLabel.textContent = project.workspaceSource;
    $$('.ws-session-nav-item [data-slot="sidebar-menu-button"]').forEach(
      (button) =>
        button.setAttribute(
          'data-active',
          String(button.dataset.sessionId === id),
        ),
    );
    const parent = $(`[data-session-id="${id}"]`)?.closest(
      '.ws-project-nav-item',
    );
    const group = $('.ws-session-list', parent);
    if (group) group.hidden = false;
    setOwner(
      designData.agents.find((agent) => agent.id === session.agentId) ||
        designData.agents[0],
    );
    quote = null;
    quoteRemoved = false;
    input.textContent = '';
    renderComposer();
    area.scrollTop = area.scrollHeight;
    document.body.classList.remove('design-mobile-sidebar');
  }
  function mentionMenu() {
    $('.ws-mention-picker', composer)?.remove();
    const match = input.textContent.match(/(?:^|\s)@([^\s@]*)$/);
    if (!match || target) return;
    const menu = text('div', 'ws-mention-picker', '');
    menu.setAttribute('role', 'listbox');
    const choices = designData.agents.filter(
      (agent) =>
        agent.id !== owner.id &&
        agent.name.toLowerCase().includes(match[1].toLowerCase()),
    );
    choices.forEach((agent, index) => {
      const button = text('button', '', '');
      button.type = 'button';
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(index === menuIndex));
      button.append(
        text('span', '', agent.name),
        text('small', '', agent.runtimeProvider),
      );
      button.onmousedown = (event) => event.preventDefault();
      button.onclick = () => {
        input.textContent = input.textContent.replace(/@[^\s@]*$/, '');
        target = agent;
        if (!quote && !quoteRemoved) {
          quote = [...messages.values()]
            .filter((message) => message.role === 'agent')
            .at(-1);
        }
        renderComposer();
        focus();
      };
      menu.append(button);
    });
    composer.append(menu);
  }
  input.addEventListener('input', () => {
    menuIndex = 0;
    renderComposer();
    mentionMenu();
  });
  input.addEventListener('paste', (event) => {
    event.preventDefault();
    const plain = event.clipboardData.getData('text/plain');
    const selection = getSelection();
    if (!selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(plain);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    renderComposer();
  });
  input.addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    const menu = $('.ws-mention-picker', composer);
    const options = menu ? $$('button', menu) : [];
    if (menu && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      menuIndex = Math.max(
        0,
        Math.min(
          options.length - 1,
          menuIndex + (event.key === 'ArrowDown' ? 1 : -1),
        ),
      );
      options.forEach((option, index) =>
        option.setAttribute('aria-selected', String(index === menuIndex)),
      );
      return;
    }
    if (menu && event.key === 'Escape') {
      event.preventDefault();
      menu.remove();
      return;
    }
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault();
      const selection = getSelection();
      if (selection.rangeCount) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const node = document.createTextNode('\n');
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      renderComposer();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (menu) {
        options[menuIndex]?.click();
        return;
      }
      submit();
      return;
    }
    if (event.key === 'Backspace' && !input.textContent) {
      if (target) {
        event.preventDefault();
        target = null;
      } else if (quote) {
        event.preventDefault();
        quote = null;
        quoteRemoved = true;
      }
      renderComposer();
      focus();
    }
  });
  $('.ws-chatbox').onsubmit = (event) => {
    event.preventDefault();
    submit();
  };
  composer.onpointerdown = (event) => {
    if (event.target === composer || event.target === line) {
      event.preventDefault();
      focus();
    }
  };
  function submit() {
    const prompt = input.textContent.trim();
    if (!prompt) return;
    const request = userTemplate.cloneNode(true);
    request.dataset.messageId = 'local-user-' + Date.now();
    $('p', request).replaceChildren();
    if (quote) {
      const ribbon = text('div', 'ws-message-reference', '');
      const details = document.createElement('details');
      const summaryNode = text('summary', '', summary(quote.content));
      details.append(summaryNode, text('div', '', quote.content));
      ribbon.append(details);
      $('strong', request).after(ribbon);
    }
    if (target)
      $('p', request).append(
        text('span', 'ws-sent-mention', '@' + target.name),
      );
    $('p', request).append(document.createTextNode(prompt));
    thread.append(request);
    const reply = agentTemplate.cloneNode(true);
    const messageId = 'local-agent-' + Date.now();
    reply.dataset.messageId = messageId;
    $('.ws-markdown', reply).replaceChildren();
    const receiver = target || owner;
    if (target) {
      $('.ws-chat-response-process', reply).replaceWith(
        document
          .createRange()
          .createContextualFragment(
            `<button type="button" class="ws-delegation-progress" title="查看委派会话">${spinner}<span class="ws-delegation-progress-agent"></span><span>正在处理</span><span class="ws-delegation-elapsed">· 1s</span>${arrow}</button>`,
          ),
      );
      $('.ws-delegation-progress-agent', reply).textContent = receiver.name;
      $('[aria-label="引用回复"]', reply)?.setAttribute('disabled', '');
      reply.onclick = () => openSession('review');
    } else {
      $('.ws-chat-response-meta span', reply).textContent = 'Working for 1s';
    }
    thread.append(reply);
    quote = null;
    target = null;
    quoteRemoved = false;
    input.textContent = '';
    renderComposer();
    area.scrollTop = area.scrollHeight;
    toast('正在演示消息提交与结果展示，不会调用真实 Agent');
    setTimeout(() => {
      const result =
        '这里会显示 ' +
        receiver.name +
        ' 的执行结果。当前为本地设计预览，未执行实际任务。';
      if ($('.ws-delegation-progress', reply)) {
        const header = $('.ws-chat-response-process', agentTemplate).cloneNode(
          true,
        );
        $('.ws-chat-response-meta span', header).textContent =
          receiver.name + ' | Completed in 2s';
        $('.ws-delegation-progress', reply).replaceWith(header);
      } else
        $('.ws-chat-response-meta span', reply).textContent = 'Completed in 2s';
      $('.ws-markdown', reply).append(text('p', '', result));
      reply.onclick = null;
      $('[aria-label="引用回复"]', reply)?.removeAttribute('disabled');
      messages.set(messageId, {
        id: messageId,
        role: 'agent',
        content: result,
        context: { ...designData.primary, agentName: receiver.name },
      });
      area.scrollTop = area.scrollHeight;
    }, 2000);
  }
  thread.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const row = button.closest('.ws-chat-message');
    const message = messages.get(row?.dataset.messageId);
    if (button.matches('.ws-delegation-meta')) {
      openSession('review');
      return;
    }
    if (button.matches('.ws-chat-response-meta')) {
      const expanded = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!expanded));
      $('.design-process', row)?.remove();
      if (!expanded) {
        const detail = text(
          'div',
          'design-process',
          '读取项目代码 → 检查会话与 Runtime 绑定 → 完成回归验证',
        );
        detail.style.cssText =
          'margin:10px 0;font-size:12px;color:#8b929f;line-height:1.7';
        $('.ws-chat-response-process', row).append(detail);
      }
      return;
    }
    if (button.getAttribute('aria-label') === '引用回复' && message) {
      quote = quote?.id === message.id ? null : message;
      quoteRemoved = !quote;
      renderComposer();
      focus();
      return;
    }
    if (button.getAttribute('aria-label')?.startsWith('交给') && message) {
      target = null;
      quote = message;
      quoteRemoved = false;
      input.textContent = '请根据这条结果继续推进。';
      renderComposer();
      focus();
      return;
    }
    if (button.getAttribute('aria-label') === 'Copy response' && message) {
      void navigator.clipboard?.writeText(message.content);
      toast('已复制回复');
      return;
    }
    if (button.getAttribute('aria-label') === 'Download response' && message) {
      const url = URL.createObjectURL(
        new Blob([message.content], { type: 'text/markdown' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'response.md';
      link.click();
      URL.revokeObjectURL(url);
      return;
    }
    if (button.getAttribute('aria-label') === 'Run again') {
      input.textContent = '继续处理上一轮任务。';
      focus();
      return;
    }
    toast('本地预览：正式分享沿用现有 Steer 功能');
  });
  $('.ws-new-chat-nav').onclick = () => {
    thread.replaceChildren();
    $('.ws-chat-appbar-context > strong').textContent = '新对话';
    quote = null;
    target = null;
    input.textContent = '';
    renderComposer();
    focus();
  };
  $('.ws-workspace-switcher').onclick = () =>
    openModal(
      '切换工作区',
      '<p>Personal workspace</p><p style="color:#9298a3;font-size:12px">本次设计保留现有 Workspace 切换方式。</p>',
    );
  $('.ws-chat-review-trigger').onclick = () => {
    if (rightSidebar) {
      const open = rightSidebar.dataset.state === 'expanded';
      rightSidebar.dataset.state = open ? 'collapsed' : 'expanded';
      rightSidebar.dataset.collapsible = open ? 'offcanvas' : '';
    }
  };
  $$('.ws-chat-appbar button')
    .find((button) => button.getAttribute('aria-label') === '展开或收起侧边栏')
    ?.addEventListener('click', () => {
      if (innerWidth < 768)
        document.body.classList.toggle('design-mobile-sidebar');
      else document.body.classList.toggle('design-sidebar-hidden');
    });
  $$(
    '.ws-sidebar [data-slot="sidebar-menu-button"]:not([data-session-id])',
  ).forEach((button) => {
    if (
      button.classList.contains('ws-project-nav-button') ||
      button.classList.contains('ws-new-chat-nav')
    )
      return;
    if (/智能体|运行环境|资产|工作日志|产物|设置/.test(button.textContent))
      button.onclick = () =>
        openModal(
          button.textContent.trim(),
          '<p style="font-size:13px;line-height:1.8">本版设计范围是侧栏与聊天工作区。此入口及配置页保留现有功能，不在本轮重新设计。</p>',
        );
  });
  const trigger = text('button', 'design-spec-trigger', '设计规格');
  trigger.type = 'button';
  trigger.setAttribute('aria-label', '查看设计规格');
  document.body.append(trigger);
  const panel = text('aside', 'design-panel', '');
  panel.hidden = true;
  panel.innerHTML =
    '<button class="design-panel-close" aria-label="关闭设计规格">×</button><h2>工作台视觉规范 · 02</h2><dl><dt>侧栏宽度</dt><dd>264 px</dd><dt>界面文字 / 正文</dt><dd>14 px / 14 px</dd><dt>正文行高</dt><dd>1.58（沿用原版）</dd><dt>最大阅读宽度</dt><dd>860 px，正文与输入框对齐</dd><dt>主文字</dt><dd>#24262B</dd><dt>侧栏文字</dt><dd>#34383F</dd><dt>输入框圆角</dt><dd>24 px（沿用原版）</dd><dt>消息间距</dt><dd>18 px</dd></dl><p>基于当前 Steer 页面 DOM、字体与 Lucide 图标。会话与耗时为演示数据，不连接后台。</p>';
  document.body.append(panel);
  trigger.onclick = () => (panel.hidden = !panel.hidden);
  $('.design-panel-close', panel).onclick = () => (panel.hidden = true);
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault();
      $('.ws-search').click();
    }
    if (event.key === 'Escape') {
      panel.hidden = true;
      document.body.classList.remove('design-mobile-sidebar');
    }
  });
  $('.ws-chat-appbar-context > strong').textContent =
    designData.sessions[0].title;
  const reviewDuration = $(
    '[data-message-id="review-result"] .ws-delegation-meta > span:nth-of-type(3)',
  );
  if (reviewDuration) reviewDuration.textContent = 'Completed in 18s';
  const lastDuration = $(
    '[data-message-id="answer"] .ws-chat-response-meta > span',
  );
  if (lastDuration) lastDuration.textContent = 'Completed in 9s';
  $('.ws-chat-share-trigger').onclick = () =>
    toast('当前为本地设计预览，正式分享沿用现有功能');
  const account = $('.ws-sidebar-footer button');
  if (account)
    account.onclick = () =>
      openModal(
        '账户',
        '<p>kongdefei</p><p style="font-size:12px;color:#9298a3">Personal workspace</p>',
      );
  $$('button')
    .filter((button) => button.textContent.trim() === '添加项目')
    .forEach(
      (button) =>
        (button.onclick = () =>
          openModal(
            '添加项目',
            '<label>项目名称<input placeholder="例如：Steer" aria-label="项目名称"></label><label>执行机器<select><option>Mac mini</option></select></label><label>本地目录或 Git 仓库<input placeholder="/Users/kongdefei/Documents/Coding/steer" aria-label="项目目录"></label>',
            () => toast('本地设计预览：配置不会保存到服务端'),
          )),
    );
  mainSnapshots.set('main', thread.innerHTML);
  updateCaption();
  renderComposer();
  area.scrollTop = 0;
})();
