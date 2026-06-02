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

**What to watch for if this regresses:** If `window.location.reload()` (or any navigation) is ever reintroduced into the unlock path, `_locked` must be set to `false` before the navigation triggers `beforeunload`. The relay stamping in `bindUnloadRelay` is intentionally conditional on `_locked`, so any navigation while `_locked = true` will cause a spurious logout on the next page load.

---

## Double login in full logout mode

**Symptom:** With full logout enabled, after the idle timeout fires and the user re-authenticates via the ST login page, they are immediately logged out again and must log in a second time.

**Root cause:** The same `beforeunload` relay mechanism. `lock()` sets `_locked = true` and calls `doLogout()`. `doLogout()` navigates away by setting `window.location.search`, which fires `beforeunload`. The relay handler sees `_locked = true` and stamps a fresh relay key. When the user logs back in and the main page loads, `checkUnloadRelay()` finds a recent key and calls `doLogout()` again — a second forced logout.

**Why the relay is wrong here:** The relay exists to handle overlay mode F5 — if the user refreshes while the overlay is showing, we need to force a server-side logout before the page renders. In full logout mode, the server-side logout already happened before navigation. The relay key is redundant and causes harm.

**Fix:** Set `_locked = false` at the top of `doLogout()`. Since `beforeunload` only stamps the relay when `_locked` is true, the programmatic logout navigation no longer triggers a relay stamp.

**What to watch for if this regresses:** Any code path that navigates while `_locked` is still `true` will trigger the relay. Always set `_locked = false` before any programmatic navigation in both `doLogout()` and any future unlock flows.
