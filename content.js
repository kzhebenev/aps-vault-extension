// APS Vault — content script: autofill icon in password fields, search palette, unlock overlay.
// Does nothing on the vault's own pages (the vault URL is read from the extension settings).
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

  function toast(text, type = 'info') {
    const el = document.createElement('div');
    el.className = `apsv-toast apsv-toast-${type}`;
    el.textContent = text;
    document.body.appendChild(el);
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

  const LOCK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

  function attachIconTo(passInput) {
    if (passInput.__apsv_attached) return;
    passInput.__apsv_attached = true;
    const icon = document.createElement('div');
    icon.className = 'apsv-input-icon';
    icon.title = t('cs_icon_title');
    icon.innerHTML = LOCK_SVG;   // static markup, no data
    icon.style.position = 'absolute';
    icon.style.zIndex = '2147483646';
    function reposition() {
      const r = passInput.getBoundingClientRect();
      icon.style.display = (r.width === 0 || passInput.offsetParent === null) ? 'none' : '';
      icon.style.top = `${window.scrollY + r.top + (r.height - 24) / 2}px`;
      icon.style.left = `${window.scrollX + r.right - 28}px`;
    }
    reposition();
    document.body.appendChild(icon);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    icon.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      try { showDropdown(passInput, await sendMsg({ type: 'matches-for-host', host: location.hostname })); }
      catch (er) {
        if (er.status === 401 || /locked/i.test(er.message)) showUnlockOverlay();
        else toast(t('cs_vault_error', er.message), 'error');
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
    if (!matches.length) dd.appendChild(htmlEl('div', { class: 'apsv-empty' }, t('cs_no_matches')));
    for (const s of matches) {
      dd.appendChild(htmlEl('div', { class: 'apsv-row', onclick: () => autofillFrom(passInput, s) },
        htmlEl('div', { class: 'apsv-row-name' }, s.name),
        htmlEl('div', { class: 'apsv-row-meta' }, [s.folder_name, s.tags].filter(Boolean).join(' · '))));
    }
    const r = passInput.getBoundingClientRect();
    Object.assign(dd.style, { position: 'absolute', zIndex: '2147483647', top: `${window.scrollY + r.bottom + 4}px`,
                              left: `${window.scrollX + r.left}px`, minWidth: `${Math.max(r.width, 280)}px` });
    document.body.appendChild(dd);
    activeDropdown = dd;
    setTimeout(() => document.addEventListener('mousedown', onDocDown, { once: true, capture: true }), 0);
  }
  function onDocDown(e) { if (activeDropdown && !activeDropdown.contains(e.target)) closeDropdown(); }

  // ── autofill ─────────────────────────────────────────────────────────────
  async function autofillFrom(passInput, secret) {
    closeDropdown();
    try {
      const full = await sendMsg({ type: 'get', id: secret.id });
      setNativeValue(passInput, full.value);
      const form = passInput.closest('form') || document;
      // login: the dedicated field first, then a "login: x" line in notes (older records)
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

  // ── palette ──────────────────────────────────────────────────────────────
  let paletteEl = null;
  function closePalette() { paletteEl?.remove(); paletteEl = null; }
  async function showPalette() {
    closePalette();
    let secrets;
    try { secrets = await sendMsg({ type: 'list' }); }
    catch (er) {
      if (er.status === 401 || /locked/i.test(er.message)) { showUnlockOverlay(); return; }
      toast(t('cs_vault_error', er.message), 'error'); return;
    }
    paletteEl = htmlEl('div', { class: 'apsv-palette-backdrop' });
    const card = htmlEl('div', { class: 'apsv-palette-card' });
    const input = htmlEl('input', { class: 'apsv-palette-input', type: 'text', placeholder: t('cs_search_ph') });
    const list = htmlEl('div', { class: 'apsv-palette-list' });
    card.append(input, list); paletteEl.appendChild(card); document.body.appendChild(paletteEl);
    let idx = 0;
    const score = (s, q) => {
      const hay = `${s.name} ${s.tags} ${s.url} ${s.folder_name}`.toLowerCase();
      if (s.name.toLowerCase().startsWith(q)) return 3;
      return hay.includes(q) ? 2 : 0;
    };
    function refresh() {
      const q = input.value.trim().toLowerCase();
      const matches = q
        ? secrets.map(s => ({ s, sc: score(s, q) })).filter(x => x.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, 30).map(x => x.s)
        : secrets.slice(0, 10);
      idx = Math.min(Math.max(0, idx), Math.max(matches.length - 1, 0));
      list.replaceChildren();
      matches.forEach((s, i) => list.appendChild(htmlEl('div', {
        class: 'apsv-palette-row' + (i === idx ? ' apsv-palette-row-sel' : ''),
        onclick: async () => { await copyValue(s); closePalette(); },
      }, htmlEl('div', { class: 'apsv-palette-name' }, s.name), htmlEl('div', { class: 'apsv-palette-meta' }, s.folder_name))));
      paletteEl.__matches = matches;
    }
    input.addEventListener('input', refresh);
    input.addEventListener('keydown', async (e) => {
      const m = paletteEl?.__matches || [];
      if (e.key === 'Escape') { closePalette(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(idx + 1, m.length - 1); refresh(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(idx - 1, 0); refresh(); }
      else if (e.key === 'Enter' && m[idx]) { e.preventDefault(); await copyValue(m[idx]); closePalette(); }
    });
    paletteEl.addEventListener('click', (e) => { if (e.target === paletteEl) closePalette(); });
    input.focus(); refresh();
  }
  async function copyValue(s) {
    try {
      const full = await sendMsg({ type: 'get', id: s.id });
      await navigator.clipboard.writeText(full.value);
      toast(t('cs_copied', s.name), 'success');
      setTimeout(async () => {
        try { if ((await navigator.clipboard.readText()) === full.value) await navigator.clipboard.writeText(''); } catch { /* no permission */ }
      }, 30000);
    } catch (er) { toast(t('cs_error', er.message), 'error'); }
  }

  // ── unlock overlay ───────────────────────────────────────────────────────
  function showUnlockOverlay() {
    closePalette();
    const overlay = htmlEl('div', { class: 'apsv-palette-backdrop' });
    const card = htmlEl('div', { class: 'apsv-palette-card', style: { maxWidth: '360px', padding: '16px' } });
    const title = htmlEl('div', { class: 'apsv-palette-name', style: { fontSize: '14px', marginBottom: '8px' } }, t('cs_unlock_title'));
    const mp = htmlEl('input', { type: 'password', class: 'apsv-palette-input', placeholder: t('ph_master') });
    const totp = htmlEl('input', { type: 'text', class: 'apsv-palette-input', placeholder: t('ph_totp'), inputmode: 'numeric', style: { marginTop: '8px', display: 'none' } });
    const btn = htmlEl('button', { class: 'apsv-palette-input', style: { marginTop: '12px', background: '#3b82f6', color: 'white', cursor: 'pointer', border: 'none' } }, t('btn_unlock'));
    btn.addEventListener('click', async () => {
      try {
        await sendMsg({ type: 'unlock', password: mp.value, totp: totp.value || undefined });
        overlay.remove(); toast(t('cs_unlocked'), 'success');
      } catch (er) {
        if (/2FA|totp/i.test(er.message)) { totp.style.display = 'block'; totp.focus(); }
        toast(er.message, 'error');
      }
    });
    for (const i of [mp, totp]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
    card.append(title, mp, totp, btn); overlay.appendChild(card);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay); mp.focus();
  }

  chrome.runtime.onMessage.addListener((msg) => { if (msg.type === 'show-palette') showPalette(); });

  // Skip the vault's own UI; otherwise attach to password fields and watch for new ones.
  sendMsg({ type: 'config' }).then((cfg) => {
    if (cfg.url && location.origin === new URL(cfg.url).origin) return;
    scanAndInject();
    new MutationObserver(scanAndInject).observe(document.body, { childList: true, subtree: true });
  }).catch(() => {});
})();
