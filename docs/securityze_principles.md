# Securityze — Project Principles
*Read before writing any code. Applies to every session.*

---

## What a Principle Is

A principle is an enduring statement of design intent. It says what must be true and why it matters, not how it is currently implemented. A principle survives a complete rewrite.

---

## 1. The Lock Is Real Logout, Not an Overlay

Securityze is an inactivity guard that performs genuine server-side logout. It is not a visual overlay, not a client-side gate, and not a replacement for ST's own authentication. Its job is to terminate the session when the user walks away.

This means:
- `enableUserAccounts: true` in ST's config.yaml is a hard requirement. Without it, logout is a no-op (the server re-populates `request.user` from the default user on every request).
- The default user **must have a password set**. Without a password, ST's auto-login will bypass the lock on the next page load.
- The lock must never claim to be more than it is. A determined actor can still refresh before the timer fires. The extension deters the unintentional, not the intentional.

---

## 2. Lock Calls the Plugin Endpoint, Not the Browser API

When the idle timer fires, the extension POSTs to `/api/plugins/securityze/lock`. This endpoint destroys `req.session` (which clears the signed cookie-session cookie) and returns 204. The client then navigates to `/?noauto=true`.

This is intentional:
- Server-side destruction of the session is the authoritative action. If it succeeds, the session is dead.
- The redirect to `/?noauto=true` suppresses ST's single-user auto-login so the real login page is shown.
- If the POST fails (network error), the redirect still happens as best-effort.

The `/api/users/logout` endpoint exists and does the same thing, but routing through the plugin's dedicated `/lock` endpoint keeps the Securityze concern explicit and extensible.

---

## 3. Re-authentication Goes Through ST's Login Page

There is no overlay, no password input, and no unlock flow in this extension. When the session is locked, the user sees ST's real login page and must enter their password there.

This is intentional. ST's login page is rate-limited. The extension does not need to duplicate that logic.

---

## 4. The Plugin and Extension Are One Feature

Securityze consists of two parts: a client-side extension (`index.js`) and a server-side plugin (`plugin/index.js`). They are co-located in the same extension directory and symlinked into `st-plugins/` following the same pattern as CNZ/Canonize.

The client owns: the idle timer, activity event binding, and the settings panel UI.
The server plugin owns: the `/lock` route that destroys the session cookie.

If either half grows beyond its stated scope, that is a signal to reconsider the split.

---

## 5. No Opinions About ST State

The extension does not read chat state, character state, or any ST-internal data beyond what `getRequestHeaders()` provides. It does not listen to ST event types. It does not care what the user was doing when the timer fired.

This constraint keeps the extension resilient to ST version changes and makes its behavior predictable regardless of what the user is doing in the app.

---

## 6. Every Module Is Self-Describing

Every source file opens with a structured preamble declaring its architectural role, public API surface, and contracts.

```javascript
/**
 * @file {path}
 * @stamp {utc timestamp}
 * @architectural-role {role} — {one line}
 * @description {2-4 sentences}
 * @api-declaration {exports or "(no exports)"}
 * @contract
 *   assertions:
 *     purity: {classification}
 *     state_ownership: [{domains}]
 *     external_io: [{services}]
 */
```
