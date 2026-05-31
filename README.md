# SillyTavern-Securityze

Inactivity lock for SillyTavern. After a configurable period of no mouse, keyboard, or touch activity, the session is terminated server-side and the browser is redirected to ST's login page. No overlay, no client-side gate — real logout.

---

## How it works

Two components work together:

| Component | File | Role |
|---|---|---|
| Browser extension | `index.js` | Idle timer, activity detection, settings UI |
| Server plugin | `plugin/index.js` | Session destruction endpoint, password sync |

When the idle timer fires, the extension POSTs to `/api/plugins/securityze/lock`. The plugin destroys the session cookie server-side. The browser is then redirected to `/?noauto=true`, which shows ST's real login page. Re-authentication requires the account password — there is no bypass.

---

## Requirements

- **SillyTavern 1.12+** with server plugins enabled (`enableServerPlugins: true` in `config.yaml`)
- **User accounts enabled** — add `enableUserAccounts: true` to `config.yaml`
- **A password on the default user** — without one, ST auto-logs in on every page load and the lock does nothing

---

## Installation

### 1. Install the extension

Via ST's built-in extension manager, or clone manually into your extensions directory:

```
[ST]/public/scripts/extensions/third-party/SillyTavern-Securityze/
```

### 2. Deploy the server plugin

The server plugin must be in ST's plugins directory. The preferred method is a symlink so the extension and plugin stay in sync:

**Option A — Symlink (recommended)**

```bash
ln -s ../public/scripts/extensions/third-party/SillyTavern-Securityze/plugin [ST]/plugins/securityze
```

The symlink path is relative inside the container or server — adjust to your setup. Once in place, the plugin self-manages; no `npm install` required (no external dependencies).

**Option B — Copy (if symlinks are unavailable)**

Copy the `plugin/` directory directly:

```bash
cp -r [ST]/public/scripts/extensions/third-party/SillyTavern-Securityze/plugin [ST]/plugins/securityze
```

Then call `POST /api/plugins/securityze/install-symlink` to have the plugin replace the copied directory with a symlink automatically (requires write access to the plugins directory).

### 3. Set the account password

Add `SECURITYZE_PASSWORD` to your environment (Docker Compose, `.env`, or however you run ST):

```yaml
environment:
  - SECURITYZE_PASSWORD=yourpassword
```

On every startup, the plugin hashes this value (scrypt, the same algorithm ST uses) and writes it to the default user's account. The environment variable is the source of truth — changing it and restarting updates the password.

Alternatively, set the password manually via ST's admin panel and omit the env var.

### 4. Restart ST

The plugin loads automatically. Check your server log for:

```
[Securityze] Default user password synced from SECURITYZE_PASSWORD.
```

---

## Configuration

Open **Extensions > Securityze** in the ST UI. The only setting is the idle timeout in minutes (default: 5, range: 1–120). The value is stored in `localStorage` per browser.

---

## Docker Compose example

```yaml
services:
  sillytavern:
    environment:
      - SILLYTAVERN_ENABLESERVERPLUGINS=true
      - SECURITYZE_PASSWORD=yourpassword
    volumes:
      - ./st-extensions:/home/node/app/public/scripts/extensions/third-party
      - ./st-plugins:/home/node/app/plugins
```

With `st-plugins/securityze` symlinked as described above, no further setup is needed.

---

## Security scope

Securityze is a convenience lock. It stops casual access when you walk away from an open tab. It is not a replacement for network security, HTTPS, or server hardening. A determined actor with physical access can refresh the browser before the timer fires.

Sessions are per-browser — being logged in on one device does not grant access on another.
