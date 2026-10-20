const settings = await chrome.storage.local.get({ enabled: true, panelVisible: true });
for (const key of ['enabled', 'panelVisible']) {
  const input = document.getElementById(key);
  input.checked = settings[key];
  input.addEventListener('change', async () => { await chrome.storage.local.set({ [key]: input.checked }); await update(); });
}
async function update() {
  const status = document.getElementById('status');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'status' });
    status.textContent = result?.status || 'Open a supported chess game.';
  } catch { status.textContent = 'Open a Chess.com or Lichess game. Reload existing tabs after installing.'; }
}
await update();
