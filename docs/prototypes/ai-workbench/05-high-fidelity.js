const dialog = document.querySelector('[data-capture-dialog]');
const toast = document.querySelector('[data-toast-output]');
let toastTimer;

function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
}

function openCapture() {
  dialog?.classList.add('open');
  dialog?.querySelector('textarea')?.focus();
}

function closeCapture() {
  dialog?.classList.remove('open');
}

document.querySelectorAll('[data-toast]').forEach((element) => {
  element.addEventListener('click', (event) => {
    event.preventDefault();
    showToast(element.dataset.toast);
  });
});

document.querySelectorAll('[data-capture-open]').forEach((button) => button.addEventListener('click', openCapture));
document.querySelectorAll('[data-capture-close]').forEach((button) => button.addEventListener('click', closeCapture));
dialog?.addEventListener('click', (event) => event.target === dialog && closeCapture());

document.querySelector('[data-capture-form]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const textarea = event.currentTarget.querySelector('textarea');
  if (!textarea.value.trim()) return textarea.focus();
  textarea.value = '';
  closeCapture();
  showToast('已记录，AI 会在后台整理和关联');
});

document.querySelector('[data-composer]')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const textarea = event.currentTarget.querySelector('textarea');
  if (!textarea.value.trim()) return textarea.focus();
  showToast('演示任务已发送给 Codex');
});

document.querySelector('[data-attention-open]')?.addEventListener('click', () => {
  document.querySelector('[data-attention-section]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    document.querySelector('.hf-search')?.click();
  }
  if (event.key === 'Escape') closeCapture();
});
