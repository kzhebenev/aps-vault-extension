const t = (k) => chrome.i18n.getMessage(k) || k;
for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
document.getElementById('origin').textContent = `chrome-extension://${chrome.runtime.id}`;

const url = document.getElementById('url');
const autolock = document.getElementById('autolock');
const msg = document.getElementById('msg');

chrome.storage.sync.get({ vault_url: '', autolock_min: 30 }, (r) => {
  url.value = r.vault_url || '';
  autolock.value = r.autolock_min || 30;
});

function validUrl(v) {
  try {
    const u = new URL(v);
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
  } catch { return false; }
}

document.getElementById('save').addEventListener('click', () => {
  const v = url.value.trim().replace(/\/+$/, '');
  if (!validUrl(v)) { msg.textContent = t('opt_bad_url'); msg.className = 'err'; return; }
  const mins = Math.min(720, Math.max(1, parseInt(autolock.value, 10) || 30));
  chrome.storage.sync.set({ vault_url: v, autolock_min: mins }, () => {
    // the session belongs to the previous vault, if any
    chrome.storage.local.remove(['vault_session', 'vault_csrf', 'vault_last_used']);
    msg.textContent = t('opt_saved'); msg.className = 'ok';
    setTimeout(() => { msg.textContent = ''; }, 2000);
  });
});
