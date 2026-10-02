const t = (k, ...subs) => chrome.i18n.getMessage(k, subs) || k;
for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
for (const el of document.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh);
if (/Mac/i.test(navigator.platform)) document.getElementById('hotkey').textContent = 'Cmd+Shift+L';

const $ = (id) => document.getElementById(id);
function sendMsg(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!resp?.ok) { const e = new Error(resp?.error || 'background error'); e.code = resp?.code; e.status = resp?.status; return reject(e); }
      resolve(resp.data);
    });
  });
}
function setStatus(text, cls) {
  const s = $('status'); s.textContent = text;
  s.classList.remove('status-ok', 'status-locked'); if (cls) s.classList.add(cls);
}

async function refresh() {
  try {
    const cfg = await sendMsg({ type: 'config' });
    if (!cfg.url) { setStatus(t('status_no_url'), 'status-locked'); $('form-unlock').style.display = 'none'; $('form-unlocked').style.display = 'none'; return; }
    const h = await sendMsg({ type: 'health' });
    if (!h.initialized) { setStatus(t('status_not_initialized'), 'status-locked'); return; }
    if (h.unlocked) {
      setStatus(t('status_unlocked'), 'status-ok');
      $('form-unlock').style.display = 'none'; $('form-unlocked').style.display = 'block';
    } else {
      setStatus(t('status_locked'), 'status-locked');
      $('form-unlock').style.display = 'block'; $('form-unlocked').style.display = 'none';
    }
  } catch (e) {
    setStatus(e.code === 'no-url' ? t('status_no_url') : t('status_error', e.message), 'status-locked');
  }
}

$('btn-unlock').addEventListener('click', async () => {
  try {
    await sendMsg({ type: 'unlock', password: $('mp').value, totp: $('totp').value || undefined });
    $('mp').value = ''; $('totp').value = '';
    refresh();
  } catch (e) {
    if (/2FA|totp/i.test(e.message)) { $('totp').style.display = 'block'; $('totp').focus(); }
    setStatus(e.message, 'status-locked');
  }
});
for (const id of ['mp', 'totp']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-unlock').click(); });

$('btn-palette').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try { await chrome.tabs.sendMessage(tab.id, { type: 'show-palette' }); window.close(); }
  catch { setStatus(t('palette_unavailable'), 'status-locked'); }
});
$('btn-vault').addEventListener('click', async () => {
  const cfg = await sendMsg({ type: 'config' });
  if (cfg.url) chrome.tabs.create({ url: cfg.url + '/' });
});
$('btn-lock').addEventListener('click', async () => { await sendMsg({ type: 'lock' }); refresh(); });
$('btn-options').addEventListener('click', () => chrome.runtime.openOptionsPage());

refresh();
