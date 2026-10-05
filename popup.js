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
      loadList(); setTimeout(() => $('search').focus(), 0);
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

// 0.3.0: the search palette — in the extension window; the value goes to the clipboard from here, the page never sees it
let all = [], sel = 0;
async function loadList() {
  try { all = await sendMsg({ type: 'list' }); } catch (e) { all = []; setStatus(e.message, 'status-locked'); }
  render();
}
function render() {
  const q = $('search').value.trim().toLowerCase();
  const score = (s) => !q ? 1 : s.name.toLowerCase().startsWith(q) ? 3 : `${s.name} ${s.tags || ''} ${s.url || ''} ${s.folder_name || ''}`.toLowerCase().includes(q) ? 2 : 0;
  const shown = all.map(s => ({ s, sc: score(s) })).filter(x => x.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, 30).map(x => x.s);
  sel = Math.min(sel, Math.max(shown.length - 1, 0));
  const box = $('results'); box.replaceChildren();
  if (!shown.length) { const d = document.createElement('div'); d.className = 'empty'; d.textContent = t('search_empty'); box.appendChild(d); }
  shown.forEach((s, i) => {
    const row = document.createElement('div'); row.className = 'row' + (i === sel ? ' sel' : '');
    const n = document.createElement('span'); n.textContent = s.name;
    const m = document.createElement('span'); m.className = 'meta'; m.textContent = s.folder_name || '';
    row.append(n, m); row.addEventListener('click', () => copy(s)); box.appendChild(row);
  });
  box.__shown = shown;
}
async function copy(s) {
  try {
    const full = await sendMsg({ type: 'get', id: s.id });
    await navigator.clipboard.writeText(full.value);
    setStatus(t('copied', s.name), 'status-ok');
    const v = full.value;
    setTimeout(async () => { try { if ((await navigator.clipboard.readText()) === v) await navigator.clipboard.writeText(''); } catch { /* popup closed */ } }, 30000);
  } catch (e) { setStatus(e.message, 'status-locked'); }
}
$('search').addEventListener('input', () => { sel = 0; render(); });
$('search').addEventListener('keydown', (e) => {
  const shown = $('results').__shown || [];
  if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, shown.length - 1); render(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); }
  else if (e.key === 'Enter' && shown[sel]) { e.preventDefault(); copy(shown[sel]); }
});
$('btn-vault').addEventListener('click', async () => {
  const cfg = await sendMsg({ type: 'config' });
  if (cfg.url) chrome.tabs.create({ url: cfg.url + '/' });
});
$('btn-lock').addEventListener('click', async () => { await sendMsg({ type: 'lock' }); refresh(); });
$('btn-options').addEventListener('click', () => chrome.runtime.openOptionsPage());

refresh();
