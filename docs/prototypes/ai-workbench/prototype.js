const dialog = document.querySelector('[data-capture-dialog]');
const toast = document.querySelector('[data-toast]');
let toastTimer;

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2200);
}

document.querySelectorAll('[data-open-capture]').forEach((button) => {
  button.addEventListener('click', () => {
    dialog?.classList.add('open');
    dialog?.querySelector('textarea')?.focus();
  });
});

document.querySelectorAll('[data-close-capture]').forEach((button) => {
  button.addEventListener('click', () => dialog?.classList.remove('open'));
});

dialog?.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.classList.remove('open');
});

document.querySelectorAll('[data-entry-type]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-entry-type]').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
  });
});

document.querySelector('[data-capture-form]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const value = event.currentTarget.querySelector('textarea').value.trim();
  if (!value) return;
  dialog.classList.remove('open');
  event.currentTarget.reset();
  showToast('已记录，AI 会建议分类和关联');
});

document.querySelectorAll('[data-demo-action]').forEach((button) => {
  button.addEventListener('click', () => showToast(button.dataset.demoAction || '操作已完成'));
});

document.querySelectorAll('[data-tab]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-tab]').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    showToast(`已切换到「${button.textContent.trim()}」视图`);
  });
});

document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    dialog?.classList.add('open');
    dialog?.querySelector('textarea')?.focus();
  }
  if (event.key === 'Escape') dialog?.classList.remove('open');
});
