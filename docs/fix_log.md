# Securityze Fix Log

## Double login on timeout (overlay mode)

**Symptom:** After the idle timeout fires and the overlay appears, entering the correct password causes a second login prompt — either the overlay reappearing or the full ST login page showing.

**Root cause:** `lock()` writes a `RELAY_KEY` timestamp to `sessionStorage` the moment the overlay is shown. This is intentional — it lets `checkUnloadRelay()` on the next page load detect that the previous session was locked and trigger a server logout before the UI renders.

The problem arose when `attemptUnlock()` called `window.location.reload()` after a successful password entry. Triggering a reload fires `beforeunload`, and the `bindUnloadRelay` handler checks `_locked` to decide whether to re-stamp the relay key. Because `_locked` was never set to `false` before the reload, it was still `true` — so `beforeunload` wrote a fresh `RELAY_KEY` timestamp. The reloaded page then found a brand-new relay key, treated it as a locked-then-navigated session, and called `doLogout()`. The user then had to log in a second time via the ST login page.

**Why the reload was added:** After re-authentication via `/api/users/login`, a reload was used as a blunt fix to ensure the page was in a clean state. In overlay mode this is unnecessary — the ST session is never destroyed, the login call only verifies the password, and the DOM is intact throughout.

**Fix:** Remove `window.location.reload()` from the unlock success path. Instead, call `unlock()` directly, which:
1. Sets `_locked = false` (so `beforeunload` will not re-stamp the relay)
2. Removes the overlay from the DOM
3. Updates `ACTIVITY_KEY` in localStorage
4. Restarts the idle timer

**What to watch for if this regresses:** If `window.location.reload()` (or any navigation) is ever reintroduced into the unlock path, `_locked` must be set to `false` before the navigation triggers `beforeunload`. The relay stamping in `bindUnloadRelay` is intentionally unconditional on `_locked`, so any reload while `_locked = true` will cause a spurious logout on the next page load.
