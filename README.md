# APS Vault browser extension

Autofill and quick search for a self-hosted [APS Vault](https://github.com/kzhebenev/aps-vault).
Chrome / Edge / Firefox (Manifest V3). English and Russian UI (follows the browser language).

- **Autofill** — a small lock icon appears in every password field on **https** sites; click it to
  pick a secret whose URL matches the site (the exact host or a subdomain of the secret's host).
  Login, password and the current TOTP code are filled in. When the vault is locked the icon says so
  and the toolbar popup opens.
- **Search and copy in the popup** — `Ctrl+Shift+L` (`Cmd+Shift+L` on macOS) opens the extension popup
  with a search over all your secrets; *Copy* puts the value on the clipboard for 30 seconds.
- **Unlock from the popup** with the master password (and TOTP if enabled); auto-lock after a
  configurable idle time (default 30 minutes).

## Install

1. Download or clone this repository.
2. Chrome/Edge: `chrome://extensions` → Developer mode → *Load unpacked* → this folder.
   Firefox: `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* → `manifest.json`.
3. Open the extension **Settings** and enter your vault address (`https://vault.example.com`).
4. Ask the vault administrator to add the extension's origin shown on the settings page
   (`chrome-extension://<id>`) to `VAULT_ALLOWED_ORIGINS` — the vault refuses credentialed
   requests from unknown origins.

## How it works

The background service worker keeps the vault session (cookie set by `/api/auth/unlock`) and
performs all API calls. No secret is stored by the extension itself — only the session cookie and
the CSRF token, kept in `chrome.storage.session` (memory, never on disk) and removed on lock or after
the idle timeout. The content script is not injected on the vault's own pages.

**What a web page can and cannot get (0.3.0).** Anything rendered inside a page can be read by that
page's scripts, so the extension never asks for the master password there and never lists secrets
there. Unlocking and the full list live only in the extension's own popup. The content script of a tab
may ask the background for exactly two things: the secrets matching *its own tab's* host (https only,
taken from the browser, not from the message), and the value of one of those. A request for any other
host, from an http page, or from another extension is refused. The in-page icon and picker are drawn in
a closed shadow root. `test/background.test.mjs` checks these rules; `test/page-check.mjs` runs a hostile
page against the real extension in Chrome.

## Changes

- **0.3.0** — security: unlock and the secret list moved out of web pages into the popup; the
  content script is bound to its tab's https host; closed shadow root; a page on a parent domain no
  longer gets the secrets of its subdomains; session kept in memory only. The in-page palette is replaced by the popup search.
- **0.2.0** — configurable vault address, English and Russian, auto-lock by alarms.

## Privacy

The extension talks only to the vault address you configured. There is no telemetry.

## License

MIT.
