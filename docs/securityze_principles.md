# Securityze — Project Principles
*Read before writing any code. Applies to every session.*

---

## What a Principle Is

A principle is an enduring statement of design intent. It says what must be true and why it matters, not how it is currently implemented. A principle survives a complete rewrite.

---

## 1. The Lock Is a UI Gate Backed by Real Auth

Securityze is a convenience lock. Its job is to stop casual access when the user walks away from an open tab. It is not a replacement for ST's own authentication, network security, or server hardening.

The lock works by covering the screen with an overlay and requiring the account password to dismiss it. The session stays alive underneath — the page does not reload on unlock. This is intentional: the UX cost of a full reload is not justified for the threat model (casual access), and the password requirement provides genuine authentication.

The lock must never claim to be more than it is. A determined actor with dev tools can remove DOM elements. The extension deters the unintentional, not the intentional.

Requirements that cannot be relaxed:
- `enableUserAccounts: true` in ST's config.yaml. Without it there is no real auth and the lock is meaningless.
- A password on the default user. Without one, ST auto-logs in on every page load and bypasses the lock entirely.

---

## 2. Unlock Verifies via the Login Endpoint

Unlock calls `POST /api/users/login` with the current user's handle and the entered password. A successful response confirms the credentials are correct; the overlay is then dismissed and the idle timer resets.

This is intentional:
- The login endpoint is rate-limited by ST, so brute-force protection comes for free.
- The session remains valid throughout, so no CSRF token invalidation occurs.
- There is no dedicated password-verify endpoint needed.

---

## 3. F5 While Locked Goes Through Real Logout

If the user reloads or closes the tab while locked, a sessionStorage relay fires. On the next page load, the relay detects the flag, calls `POST /api/users/logout` to destroy the session server-side, and redirects to `/?noauto=true` (ST's login page).

This is the only server-side action the extension takes proactively. Everything else is client-side. The relay is the contract that closes the "F5 bypass" gap without requiring the session to be destroyed on every lock.

---

## 4. Extension Only — No Server Plugin

Securityze is a single client-side extension. It has no server plugin. Password setup is done once via ST's admin panel. This keeps the extension installable via ST's standard extension manager with no additional steps.

---

## 5. No Opinions About ST State

The extension does not read chat state, character state, or any ST-internal data beyond what `getRequestHeaders()` and `getCurrentUserHandle()` provide. It does not listen to ST event types. It does not care what the user was doing when the timer fired.

This constraint keeps the extension resilient to ST version changes and makes its behaviour predictable regardless of what the user is doing in the app.

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
