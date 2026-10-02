// APS Vault — background service worker (MV3).
// Keeps the vault session, talks to the vault's REST API on behalf of the popup and the
// content scripts. The vault address comes from the options page (chrome.storage.sync),
// nothing is hard-coded.

const KEY_SESSION = 'vault_session';
const KEY_CSRF = 'vault_csrf';
const KEY_LASTUSED = 'vault_last_used';

export async function getConfig() {
  const r = await chrome.storage.sync.get({ vault_url: '', autolock_min: 30 });
  return { url: String(r.vault_url || '').replace(/\/+$/, ''), autolockMin: Number(r.autolock_min) || 30 };
}

async function getSession() {
  const r = await chrome.storage.local.get([KEY_SESSION, KEY_CSRF, KEY_LASTUSED]);
  return { session: r[KEY_SESSION], csrf: r[KEY_CSRF], lastUsed: r[KEY_LASTUSED] };
}
async function setSession(session, csrf) {
  await chrome.storage.local.set({ [KEY_SESSION]: session, [KEY_CSRF]: csrf, [KEY_LASTUSED]: Date.now() });
}
async function touch() { await chrome.storage.local.set({ [KEY_LASTUSED]: Date.now() }); }
async function clearSession() { await chrome.storage.local.remove([KEY_SESSION, KEY_CSRF, KEY_LASTUSED]); }

class NoUrlError extends Error { constructor() { super('no-url'); this.code = 'no-url'; } }

async function vaultFetch(path, opts = {}) {
  const { url } = await getConfig();
  if (!url) throw new NoUrlError();
  const { session, csrf } = await getSession();
  const headers = { ...(opts.headers || {}), Accept: 'application/json' };
  if (opts.body) headers['Content-Type'] = 'application/json';
  if (csrf && opts.method && opts.method !== 'GET') headers['X-CSRF-Token'] = csrf;
  // The session cookie belongs to the vault origin; with host permission the browser sends it.
  const r = await fetch(url + path, { ...opts, headers, credentials: 'include' });
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = { _raw: text }; }
  if (!r.ok) { const err = new Error(data?.detail || `HTTP ${r.status}`); err.status = r.status; throw err; }
  if (session) touch();
  return data;
}

const api = {
  health: () => vaultFetch('/api/health'),
  async unlock(password, totp_code) {
    const { url } = await getConfig();
    if (!url) throw new NoUrlError();
    const body = totp_code ? { master_password: password, totp_code } : { master_password: password };
    const r = await fetch(url + '/api/auth/unlock', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'include',
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.detail || `HTTP ${r.status}`);
    const cookies = await chrome.cookies.getAll({ url });
    const sessionC = cookies.find(c => c.name === 'vault_session');
    const csrfC = cookies.find(c => c.name === 'vault_csrf');
    await setSession(sessionC?.value, csrfC?.value || data.csrf_token);
    return data;
  },
  async lock() {
    try { await vaultFetch('/api/auth/lock', { method: 'POST' }); } catch { /* already locked / unreachable */ }
    await clearSession();
  },
  list: () => vaultFetch('/api/secrets'),
  get: (id) => vaultFetch(`/api/secrets/${encodeURIComponent(id)}`),
};

// URL matching for autofill: exact host or a sub/super-domain of the secret's URL host.
export function hostMatches(secretUrl, pageHost) {
  if (!secretUrl) return false;
  try {
    const u = new URL(/^https?:\/\//i.test(secretUrl) ? secretUrl : `https://${secretUrl}`);
    return u.hostname === pageHost || pageHost.endsWith('.' + u.hostname) || u.hostname.endsWith('.' + pageHost);
  } catch { return false; }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case 'config': sendResponse({ ok: true, data: await getConfig() }); break;
        case 'health': sendResponse({ ok: true, data: await api.health() }); break;
        case 'unlock': sendResponse({ ok: true, data: await api.unlock(msg.password, msg.totp) }); break;
        case 'lock': await api.lock(); sendResponse({ ok: true }); break;
        case 'list': sendResponse({ ok: true, data: await api.list() }); break;
        case 'get': sendResponse({ ok: true, data: await api.get(msg.id) }); break;
        case 'matches-for-host': {
          const all = await api.list();
          sendResponse({ ok: true, data: all.filter(s => hostMatches(s.url, msg.host)) });
          break;
        }
        default: sendResponse({ ok: false, error: `unknown msg type: ${msg.type}` });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message || String(e), status: e.status, code: e.code });
    }
  })();
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'open-palette') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try { await chrome.tabs.sendMessage(tab.id, { type: 'show-palette' }); }
  catch { chrome.action.openPopup(); }
});

// Auto-lock after inactivity (alarms survive service-worker suspension, setInterval does not).
chrome.alarms?.create('autolock', { periodInMinutes: 1 });
chrome.alarms?.onAlarm.addListener(async (a) => {
  if (a.name !== 'autolock') return;
  const { lastUsed } = await getSession();
  const { autolockMin } = await getConfig();
  if (lastUsed && Date.now() - lastUsed > autolockMin * 60 * 1000) await api.lock();
});
