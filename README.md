# APS Vault browser extension

Autofill and quick search for a self-hosted [APS Vault](https://github.com/kzhebenev/aps-vault).
Chrome / Edge / Firefox (Manifest V3). English and Russian UI (follows the browser language).

- **Autofill** — a small lock icon appears in every password field; click it to pick a secret
  whose URL matches the site. Login, password and the current TOTP code are filled in.
- **Palette** — `Ctrl+Shift+L` (`Cmd+Shift+L` on macOS) opens a search over all your secrets on
  any page; Enter copies the value to the clipboard for 30 seconds.
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
performs all API calls; content scripts only receive the data they asked for. No secret is
stored by the extension itself — only the session cookie and the CSRF token, which are
removed on lock or after the idle timeout. The content script is not injected on the vault's
own pages.

## Privacy

The extension talks only to the vault address you configured. There is no telemetry.

## License

MIT.
