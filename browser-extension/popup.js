const statusEl = document.getElementById('status');
const syncBtn = document.getElementById('syncBtn');

async function refreshStatus() {
  try {
    const response = await fetch('http://127.0.0.1:17321/health', { method: 'GET' });
    if (!response.ok) {
      throw new Error('health check failed');
    }
    statusEl.textContent = '状态：已连接桌面端';
    statusEl.style.color = '#22c55e';
  } catch {
    statusEl.textContent = '状态：未连接（请先启动桌面软件）';
    statusEl.style.color = '#f59e0b';
  }
}

syncBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'sync-now' }, () => {
    void refreshStatus();
  });
});

void refreshStatus();
