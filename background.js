// APS Vault — background service worker (MV3).
// Keeps the vault session, talks to the vault's REST API on behalf of the popup and the
// content scripts. The vault address comes from the options page (chrome.storage.sync),
// nothing is hard-coded.
//
// 0.3.0 (security review 05.10.2026): content scripts run inside pages we do not trust. They may ask only for the
// secrets whose URL matches THEIR OWN tab (the host is taken from `sender.tab.url`, never from the message) and only on
// https pages; unlocking, locking and listing everything are for the extension's own pages (popup, options). The
// session lives in chrome.storage.session — memory only, not readable by content scripts, gone with the browser.

const KEY_SESSION = 'vault_session';
const KEY_CSRF = 'vault_csrf';
const KEY_LASTUSED = 'vault_last_used';

export async function getConfig() {
  const r = await chrome.storage.sync.get({ vault_url: '', autolock_min: 30 });
  return { url: String(r.vault_url || '').replace(/\/+$/, ''), autolockMin: Number(r.autolock_min) || 30 };
}

const store = chrome.storage.session;   // 0.3.0: memory only; trusted contexts only (the default access level)
store.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
chrome.storage.local.remove([KEY_SESSION, KEY_CSRF, KEY_LASTUSED]);   // a 0.2 session left on disk is erased

async function getSession() {
  const r = await store.get([KEY_SESSION, KEY_CSRF, KEY_LASTUSED]);
  return { session: r[KEY_SESSION], csrf: r[KEY_CSRF], lastUsed: r[KEY_LASTUSED] };
}
async function setSession(session, csrf) {
  await store.set({ [KEY_SESSION]: session, [KEY_CSRF]: csrf, [KEY_LASTUSED]: Date.now() });
}
async function touch() { await store.set({ [KEY_LASTUSED]: Date.now() }); }
async function clearSession() { await store.remove([KEY_SESSION, KEY_CSRF, KEY_LASTUSED]); }

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

// URL matching for autofill: the exact host, or a page on a SUBdomain of the secret's host (login.example.com for a
// secret at example.com). 0.3.0: no longer the other way round — a secret for login.example.com is not offered on
// example.com or on any other subdomain of it.
export function hostMatches(secretUrl, pageHost) {
  if (!secretUrl || !pageHost) return false;
  try {
    const u = new URL(/^https?:\/\//i.test(secretUrl) ? secretUrl : `https://${secretUrl}`);
    return u.hostname === pageHost || pageHost.endsWith('.' + u.hostname);
  } catch { return false; }
}

// Who is asking: the extension's own pages (popup / options) are trusted; a content script speaks for its tab only.
function fromExtensionPage(sender) {
  return sender?.id === chrome.runtime.id && !sender.tab && String(sender.url || '').startsWith(chrome.runtime.getURL(''));
}
function tabHost(sender) {
  try {
    const u = new URL(sender?.tab?.url || '');
    return u.protocol === 'https:' ? u.hostname : '';   // autofill only on https pages
  } catch { return ''; }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (sender?.id !== chrome.runtime.id) throw new Error('foreign sender');
      const trusted = fromExtensionPage(sender);
      switch (msg.type) {
        case 'config': sendResponse({ ok: true, data: await getConfig() }); break;
        case 'health': sendResponse({ ok: true, data: await api.health() }); break;
        // the master password and the full list are for the extension's own pages only
        case 'unlock':
          if (!trusted) throw new Error('unlock is available only in the extension window');
          sendResponse({ ok: true, data: await api.unlock(msg.password, msg.totp) }); break;
        case 'lock': await api.lock(); sendResponse({ ok: true }); break;
        case 'list':
          if (!trusted) throw new Error('the full list is available only in the extension window');
          sendResponse({ ok: true, data: await api.list() }); break;
        case 'get': {
          if (trusted) { sendResponse({ ok: true, data: await api.get(msg.id) }); break; }
          // a content script: only a secret whose URL matches the sender's own https tab
          const host = tabHost(sender);
          const all = await api.list();
          const s = all.find(x => String(x.id) === String(msg.id));
          if (!host || !s || !hostMatches(s.url, host)) throw new Error('this secret does not belong to this site');
          sendResponse({ ok: true, data: await api.get(msg.id) });
          break;
        }
        case 'matches-for-host': {
          const host = trusted ? msg.host : tabHost(sender);      // never the host the page claims
          if (!host) { sendResponse({ ok: true, data: [] }); break; }
          const all = await api.list();
          sendResponse({ ok: true, data: all.filter(s => hostMatches(s.url, host)).map(s => ({ id: s.id, name: s.name, folder_name: s.folder_name })) });
          break;
        }
        case 'open-popup':
          try { await chrome.action.openPopup(); } catch { /* needs a user gesture in some browsers */ }
          sendResponse({ ok: true }); break;
        default: sendResponse({ ok: false, error: `unknown msg type: ${msg.type}` });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message || String(e), status: e.status, code: e.code });
    }
  })();
  return true;
});

// 0.3.0: the search palette lives in the extension window, not in the page
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'open-palette') return;
  try { await chrome.action.openPopup(); } catch { /* older browsers: the toolbar icon opens it */ }
});

// Auto-lock after inactivity (alarms survive service-worker suspension, setInterval does not).
chrome.alarms?.create('autolock', { periodInMinutes: 1 });
chrome.alarms?.onAlarm.addListener(async (a) => {
  if (a.name !== 'autolock') return;
  const { lastUsed } = await getSession();
  const { autolockMin } = await getConfig();
  if (lastUsed && Date.now() - lastUsed > autolockMin * 60 * 1000) await api.lock();
});
