// APS Vault — content script (0.3.0): the autofill icon in password fields and its dropdown, nothing else.
// Everything the extension draws on a page lives in a CLOSED shadow root, so page scripts cannot read it through the
// DOM. The master password is never asked for here (a page could read a field in its own DOM): when the vault is
// locked the user is sent to the extension window. Values travel from the background only for secrets whose URL
// matches this tab, and only into the page's own login fields.
(() => {
  if (window.__APSV__) return;
  window.__APSV__ = true;
  const t = (k, ...subs) => chrome.i18n.getMessage(k, subs) || k;

  function sendMsg(msg) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          if (!resp?.ok) { const e = new Error(resp?.error || 'background error'); e.status = resp?.status; e.code = resp?.code; return reject(e); }
          resolve(resp.data);
        });
      } catch (e) { reject(e); }
    });
  }

  // one closed shadow host for everything we render
  const host = document.createElement('apsv-root');
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = "/* APS Vault \u2014 content styles. \u0418\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0435\u043c \u0443\u043d\u0438\u043a\u0430\u043b\u044c\u043d\u044b\u0439 prefix apsv- \u0447\u0442\u043e\u0431\u044b \u043d\u0435 \u043a\u043e\u043d\u0444\u043b\u0438\u043a\u0442\u043e\u0432\u0430\u0442\u044c \u0441\u043e \u0441\u0442\u0438\u043b\u044f\u043c\u0438 \u0441\u0442\u0440\u0430\u043d\u0438\u0446. */\n\n.apsv-input-icon {\n  width: 24px;\n  height: 24px;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  background: rgba(15, 19, 32, 0.92);\n  border: 1px solid #2a3149;\n  border-radius: 4px;\n  color: #94a3b8;\n  cursor: pointer;\n  transition: color .15s, border-color .15s;\n}\n.apsv-input-icon:hover {\n  color: #60a5fa;\n  border-color: #3b82f6;\n}\n\n.apsv-dropdown {\n  background: #0f1320;\n  border: 1px solid #1e2435;\n  border-radius: 8px;\n  padding: 4px;\n  max-height: 320px;\n  overflow-y: auto;\n  font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif;\n  font-size: 13px;\n  box-shadow: 0 10px 40px rgba(0,0,0,.5);\n}\n.apsv-row {\n  padding: 8px 10px;\n  border-radius: 4px;\n  cursor: pointer;\n  color: #cbd5e1;\n}\n.apsv-row:hover {\n  background: #1a2138;\n  color: white;\n}\n.apsv-row-name {\n  font-weight: 600;\n  font-family: ui-monospace, \"SF Mono\", Menlo, monospace;\n  font-size: 12px;\n}\n.apsv-row-meta {\n  font-size: 11px;\n  color: #64748b;\n  margin-top: 2px;\n}\n.apsv-empty {\n  padding: 12px;\n  color: #64748b;\n  font-size: 12px;\n  text-align: center;\n}\n\n/* Toast */\n.apsv-toast {\n  position: fixed;\n  top: 16px;\n  right: 16px;\n  z-index: 2147483647;\n  padding: 10px 16px;\n  border-radius: 8px;\n  font-family: -apple-system, BlinkMacSystemFont, sans-serif;\n  font-size: 13px;\n  box-shadow: 0 8px 24px rgba(0,0,0,.4);\n  color: white;\n  background: #1e293b;\n  border: 1px solid #334155;\n}\n.apsv-toast-success { background: #064e3b; border-color: #047857; }\n.apsv-toast-error   { background: #7f1d1d; border-color: #991b1b; }\n\n";
  shadow.appendChild(style);
  function mount() { if (!host.isConnected) (document.body || document.documentElement).appendChild(host); }

  function toast(text, type = 'info') {
    mount();
    const el = document.createElement('div');
    el.className = `apsv-toast apsv-toast-${type}`;
    el.textContent = text;
    shadow.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  function htmlEl(tag, props, ...children) {
    const e = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c == null) continue;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return e;
  }

  const LOCK_PATH = [['rect', { x: 3, y: 11, width: 18, height: 11, rx: 2 }], ['path', { d: 'M7 11V7a5 5 0 0 1 10 0v4' }]];
  function lockSvg() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    for (const [k, v] of Object.entries({ width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) svg.setAttribute(k, v);
    for (const [tag, attrs] of LOCK_PATH) { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); svg.appendChild(e); }
    return svg;
  }

  function attachIconTo(passInput) {
    if (passInput.__apsv_attached) return;
    passInput.__apsv_attached = true;
    mount();
    const icon = document.createElement('div');
    icon.className = 'apsv-input-icon';
    icon.title = t('cs_icon_title');
    icon.appendChild(lockSvg());
    icon.style.position = 'absolute';
    icon.style.zIndex = '2147483646';
    function reposition() {
      const r = passInput.getBoundingClientRect();
      icon.style.display = (r.width === 0 || passInput.offsetParent === null) ? 'none' : '';
      icon.style.top = `${window.scrollY + r.top + (r.height - 24) / 2}px`;
      icon.style.left = `${window.scrollX + r.right - 28}px`;
    }
    reposition();
    shadow.appendChild(icon);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    icon.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      try { showDropdown(passInput, await sendMsg({ type: 'matches-for-host' })); }
      catch (er) {
        if (er.status === 401 || /locked/i.test(er.message)) {
          toast(t('cs_locked_use_popup'), 'error');          // never a password field in the page
          sendMsg({ type: 'open-popup' }).catch(() => {});
        } else toast(t('cs_vault_error', er.message), 'error');
      }
    });
  }

  function scanAndInject() {
    for (const inp of document.querySelectorAll('input[type="password"]')) attachIconTo(inp);
  }

  // ── dropdown ─────────────────────────────────────────────────────────────
  let activeDropdown = null;
  function closeDropdown() { activeDropdown?.remove(); activeDropdown = null; }
  function showDropdown(passInput, matches) {
    closeDropdown();
    const dd = document.createElement('div');
    dd.className = 'apsv-dropdown';
    if (!matches.length) dd.appendChild(htmlEl('div', { class: 'apsv-empty' }, location.protocol === 'https:' ? t('cs_no_matches') : t('cs_https_only')));
    for (const s of matches) {
      dd.appendChild(htmlEl('div', { class: 'apsv-row', onclick: () => autofillFrom(passInput, s) },
        htmlEl('div', { class: 'apsv-row-name' }, s.name),
        htmlEl('div', { class: 'apsv-row-meta' }, s.folder_name || '')));
    }
    const r = passInput.getBoundingClientRect();
    Object.assign(dd.style, { position: 'absolute', zIndex: '2147483647', top: `${window.scrollY + r.bottom + 4}px`,
                              left: `${window.scrollX + r.left}px`, minWidth: `${Math.max(r.width, 280)}px` });
    shadow.appendChild(dd);
    activeDropdown = dd;
    setTimeout(() => document.addEventListener('mousedown', onDocDown, { once: true, capture: true }), 0);
  }
  function onDocDown(e) { if (activeDropdown && e.target !== host) closeDropdown(); }

  // ── autofill ─────────────────────────────────────────────────────────────
  async function autofillFrom(passInput, secret) {
    closeDropdown();
    try {
      const full = await sendMsg({ type: 'get', id: secret.id });
      setNativeValue(passInput, full.value);
      const form = passInput.closest('form') || document;
      let login = full.login || '';
      if (!login && full.notes) {
        const m = /(?:login|user|username|email)\s*[:=]\s*([^\s\n]+)/i.exec(full.notes);
        if (m) login = m[1];
      }
      const loginInput = findLoginInput(form, passInput);
      if (loginInput && login) setNativeValue(loginInput, login);
      const totpInput = findTotpInput(form);
      if (totpInput && full.totp) setNativeValue(totpInput, full.totp);
      toast(t('cs_filled', secret.name), 'success');
    } catch (er) { toast(t('cs_error', er.message), 'error'); }
  }
  function findLoginInput(form, passInput) {
    const all = [...form.querySelectorAll('input[type="text"], input[type="email"], input:not([type])')];
    let best = null;
    for (const c of all) {
      if (c === passInput) break;
      if (c.offsetParent === null) continue;
      const nm = `${c.name || ''} ${c.id || ''} ${c.placeholder || ''} ${c.autocomplete || ''}`.toLowerCase();
      if (/(user|login|email|account)/.test(nm)) return c;
      best = c;
    }
    return best;
  }
  function findTotpInput(form) {
    for (const c of form.querySelectorAll('input[type="text"], input[type="tel"], input[type="number"], input[inputmode="numeric"]')) {
      const nm = `${c.name || ''} ${c.id || ''} ${c.placeholder || ''} ${c.autocomplete || ''}`.toLowerCase();
      if (/(totp|2fa|otp|code|verif|one[-_]?time)/.test(nm)) return c;
    }
    return null;
  }
  function setNativeValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Skip the vault's own UI; otherwise attach to password fields and watch for new ones.
  sendMsg({ type: 'config' }).then((cfg) => {
    if (cfg.url && location.origin === new URL(cfg.url).origin) return;
    scanAndInject();
    new MutationObserver(scanAndInject).observe(document.body, { childList: true, subtree: true });
  }).catch(() => {});
})();
