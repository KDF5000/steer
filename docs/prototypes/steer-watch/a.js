const a = instances.a;
const viewHints = {
  home: '任务列表 · 选择一个会话查看结果。',
  detail: '会话详情 · 已完成任务可以语音继续；运行中任务可以查看或停止。',
  voice: '模拟听写 · 点击完成后确认文字，尚未发送给 Agent。',
  confirm: '发送确认 · 可修改文字或保存草稿。',
  'failed-send': '尚未发送 · 草稿保留，连接恢复后可以重试。',
  sent: '发送成功 · 新任务进入执行队列。',
  chat: '会话 · 显示刚发送的要求与当前执行状态。',
  notification: '任务完成 · 查看新结果或直接语音继续。',
  phone: '手机接续 · 实际打开手机会话的动作在此为模拟。',
  'stop-confirm': '停止确认 · 只停止执行，不撤销已有改动。',
};
const updateHint = () => {
  document.querySelector('.live-context').textContent = viewHints[a.view] || '';
};
new MutationObserver(updateHint).observe(a.root.querySelector('.screen'), {
  childList: true,
});
updateHint();
document.querySelector('.scenario-grid').addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-scenario]');
  if (!trigger) return;
  simulate(a, 'reset');
  switch (trigger.dataset.scenario) {
    case 'running':
      act(a, 'detail', 'git');
      break;
    case 'result':
      act(a, 'detail', 'feishu');
      break;
    case 'failed':
      act(a, 'detail', 'site');
      break;
    case 'draft':
      a.draft = '先验证群聊里的图片引用，不要提交。';
      act(a, 'detail', 'feishu');
      act(a, 'voice');
      break;
    case 'offline':
      simulate(a, 'offline');
      break;
    case 'send-failed':
      simulate(a, 'failure');
      act(a, 'send');
      break;
    case 'completion':
      simulate(a, 'complete');
      switchTask(a, 'git');
      navigate(a, 'notification');
      break;
  }
});
