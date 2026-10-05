// 0.3.0: the background worker trusts only the extension's own pages for unlock and the full list; a content script
// gets only the secrets matching its own https tab. Run: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';

const EXT = 'chrome-extension://abcdefgh/';
let listener = null;
const calls = [];
const secrets = [
  { id: 1, name: 'bank', url: 'https://bank.example.com', folder_name: 'f' },
  { id: 2, name: 'mail', url: 'https://mail.example.org', folder_name: 'f' },
];
const memory = {};
globalThis.chrome = {
  runtime: { id: 'abcdefgh', getURL: (p) => EXT + p, onMessage: { addListener: (fn) => { listener = fn; } } },
  storage: {
    sync: { get: async (d) => ({ ...d, vault_url: 'https://vault.test' }) },
    session: { get: async (keys) => Object.fromEntries(keys.map(k => [k, memory[k]])), set: async (o) => Object.assign(memory, o), remove: async (keys) => keys.forEach(k => delete memory[k]), setAccessLevel: () => {} },
    local: { remove: async () => {} },
  },
  cookies: { getAll: async () => [{ name: 'vault_session', value: 's' }, { name: 'vault_csrf', value: 'c' }] },
  commands: { onCommand: { addListener: () => {} } },
  alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
  action: { openPopup: async () => {} },
};
globalThis.fetch = async (url, opts = {}) => {
  calls.push([opts.method || 'GET', url]);
  const body = url.endsWith('/api/secrets') ? secrets
    : /\/api\/secrets\/(\d+)$/.test(url) ? { ...secrets.find(s => String(s.id) === url.match(/(\d+)$/)[1]), value: 'VALUE-' + url.match(/(\d+)$/)[1] }
    : url.endsWith('/api/auth/unlock') ? { ok: true, csrf_token: 'c' } : {};
  return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body };
};
await import('../background.js');

const ask = (msg, sender) => new Promise((resolve) => listener(msg, sender, resolve));
const popup = { id: 'abcdefgh', url: EXT + 'popup.html' };
const page = (url) => ({ id: 'abcdefgh', url, tab: { id: 7, url } });

test('unlock and the full list only from the extension window', async () => {
  let r = await ask({ type: 'unlock', password: 'pw' }, page('https://evil.example.net/login'));
  assert.equal(r.ok, false); assert.match(r.error, /extension window/);
  assert.equal(calls.some(([, u]) => u.endsWith('/api/auth/unlock')), false, 'the master password never left for the vault');
  r = await ask({ type: 'list' }, page('https://evil.example.net/'));
  assert.equal(r.ok, false);
  r = await ask({ type: 'unlock', password: 'pw' }, popup);
  assert.equal(r.ok, true);
  r = await ask({ type: 'list' }, popup);
  assert.equal(r.ok, true); assert.equal(r.data.length, 2);
});

test('a content script sees only its own site, and the host comes from the tab, not the message', async () => {
  let r = await ask({ type: 'matches-for-host', host: 'bank.example.com' }, page('https://evil.example.net/'));
  assert.deepEqual(r.data, [], 'a page cannot claim another host');
  r = await ask({ type: 'matches-for-host' }, page('https://bank.example.com/login'));
  assert.deepEqual(r.data.map(s => s.id), [1]);
  assert.equal('url' in r.data[0], false, 'only id, name, folder go to the page');
  r = await ask({ type: 'matches-for-host' }, page('https://login.bank.example.com/'));
  assert.deepEqual(r.data.map(s => s.id), [1], 'a subdomain page gets the parent site\'s secret');
  r = await ask({ type: 'matches-for-host' }, page('https://example.com/'));
  assert.deepEqual(r.data, [], 'no longer offered on a parent domain');
  r = await ask({ type: 'matches-for-host' }, page('http://bank.example.com/'));
  assert.deepEqual(r.data, [], 'never on plain http');
});

test('get: a content script cannot read a secret of another site', async () => {
  let r = await ask({ type: 'get', id: 2 }, page('https://bank.example.com/'));
  assert.equal(r.ok, false); assert.match(r.error, /does not belong/);
  r = await ask({ type: 'get', id: 1 }, page('https://bank.example.com/'));
  assert.equal(r.ok, true); assert.equal(r.data.value, 'VALUE-1');
  r = await ask({ type: 'get', id: 2 }, popup);
  assert.equal(r.ok, true, 'the extension window can copy any secret');
});

test('messages from another extension are refused; the session lives in session storage', async () => {
  const r = await ask({ type: 'list' }, { id: 'other-extension', url: 'chrome-extension://other/popup.html' });
  assert.equal(r.ok, false);
  assert.equal(memory.vault_session, 's');
});
