# SillyTavern-Securityze

Inactivity lock for SillyTavern. After a configurable period of no mouse, keyboard, or touch activity, a full-screen overlay appears requiring your account password. The session stays alive underneath — on unlock the page continues exactly where it left off, no reload.

F5 or tab close while locked triggers a real server-side logout, landing on ST's login page.

---

## Requirements

Two settings must be enabled in ST's `config.yaml`:

```yaml
enableUserAccounts: true
enableServerPlugins: false   # not required — no plugin needed
```

**`enableUserAccounts: true` is mandatory.** Without it ST has no real auth, logout is a no-op, and the lock does nothing.

**The default user must have a password set.** Without one, ST auto-logs in on every page load, bypassing the lock entirely. Set it via:

> User Settings (person icon) → Admin Panel → your user → Change Password

---

## Installation

Via ST's built-in extension manager, or clone manually into your extensions directory:

```
[ST]/public/scripts/extensions/third-party/SillyTavern-Securityze/
```

No server plugin. No `npm install`. No extra setup beyond the config changes above.

---

## Configuration

Open **Extensions > Securityze** in the ST UI:

- **Enable idle lock** — toggle the lock on/off without uninstalling
- **Lock after N minutes** — idle timeout (default 5, range 1–120). Stored in `localStorage` per browser.

---

## How it works

- Idle timer resets on any mouse, keyboard, touch, scroll, or click event
- On timeout: full-screen black overlay with a password prompt appears
- **Correct password** → overlay dismissed, timer resets, session continues
- **Wrong password** → error shown, try again (rate-limited server-side by ST)
- **F5 / reload while locked** → sessionStorage relay fires, real server-side logout, ST login page

---

## Security scope

Securityze is a convenience lock. It stops casual access when you walk away from an open tab. It is not a replacement for network security, HTTPS, or server hardening.

Sessions are per-browser — being logged in on one device does not grant access on another.

---

## License

AGPL-3.0 — see [LICENSE](LICENSE)
