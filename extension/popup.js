const $concurrent = document.getElementById('concurrent');
const $timeout = document.getElementById('timeout');
const $save = document.getElementById('save');
const $status = document.getElementById('status');

async function load() {
  const { settings } = await chrome.storage.local.get(['settings']);
  if (settings) {
    if (settings.concurrent) $concurrent.value = settings.concurrent;
    if (settings.perTabTimeoutMs) $timeout.value = Math.round(settings.perTabTimeoutMs / 1000);
  }
}

$save.addEventListener('click', async () => {
  const settings = {
    concurrent: Math.max(1, Math.min(4, parseInt($concurrent.value) || 3)),
    perTabTimeoutMs: Math.max(10, Math.min(120, parseInt($timeout.value) || 45)) * 1000,
  };
  await chrome.storage.local.set({ settings });
  $status.textContent = '✅ Đã lưu cấu hình!';
  setTimeout(() => { $status.textContent = 'Extension đã sẵn sàng.'; }, 1500);
});

load();
