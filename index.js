/**
 * @file data/default-user/extensions/SillyTavern-Securityze/index.js
 * @stamp {"utc":"2026-06-01T00:00:00.000Z"}
 * @architectural-role Stateful Owner
 * @description
 * Inactivity lock for SillyTavern. Two lock modes selectable per-device:
 *
 * Overlay mode (default): session stays alive, in-page password prompt on
 * timeout, fast unlock with no reload. Session is visible to direct URL access
 * while locked.
 *
 * Full logout mode: session destroyed on timeout, redirects to ST login page.
 * Secure against direct URL access while locked; requires full reload on
 * re-auth.
 *
 * F5/reload while overlay-locked is handled via a sessionStorage relay which
 * calls server-side logout before the page renders.
 *
 * @api-declaration
 * (no exports — self-registers on import)
 *
 * @contract
 *   assertions:
 *     purity: mutates
 *     state_ownership: [_locked, _idleTimer, _enabled, _fullLogout, _overlay]
 *     external_io: [/api/users/me, /api/users/login, /api/users/logout, DOM, localStorage, sessionStorage]
 */

import { getRequestHeaders } from '../../../../script.js';
import { getCurrentUserHandle } from '../../../../scripts/user.js';
import { SlashCommandParser } from '../../../../scripts/slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../../scripts/slash-commands/SlashCommand.js';

const MODULE           = 'Securityze';
const TIMEOUT_KEY      = 'securityze_timeout_minutes';
const ENABLED_KEY      = 'securityze_enabled';
const FULL_LOGOUT_KEY  = 'securityze_full_logout';
const VERBOSE_KEY      = 'securityze_verbose';
const RELAY_KEY        = 'securityze_locked_on_unload';
const ACTIVITY_KEY     = 'securityze_last_activity';
const DEFAULT_MINS     = 5;

// Paint an immediate black cover synchronously if a stale session is likely,
// before ST renders anything. Removed during init if not needed.
(function earlyBlind() {
    if (localStorage.getItem(ENABLED_KEY) === 'false') return;
    const last = parseInt(localStorage.getItem(ACTIVITY_KEY));
    if (!last) return;
    const mins    = parseInt(localStorage.getItem(TIMEOUT_KEY)) || DEFAULT_MINS;
    const timeout = mins * 60_000;
    if (Date.now() - last <= timeout) return;
    const cover = document.createElement('div');
    cover.id = 'securityze-early-cover';
    cover.style.cssText = 'position:fixed;inset:0;z-index:99998;background:#000;';
    document.body.appendChild(cover);
}());

let _locked      = false;
let _idleTimer   = null;
let _enabled     = localStorage.getItem(ENABLED_KEY) !== 'false';
let _fullLogout  = localStorage.getItem(FULL_LOGOUT_KEY) === 'true';
let _verbose     = localStorage.getItem(VERBOSE_KEY) === 'true';
let _overlay     = null;

function dbg(...args) {
    if (_verbose) console.log(`[${MODULE}]`, ...args);
}

// ─── Timer ────────────────────────────────────────────────────────────────────

function getTimeoutMs() {
    return (parseInt(localStorage.getItem(TIMEOUT_KEY)) || DEFAULT_MINS) * 60_000;
}

function resetIdleTimer() {
    clearTimeout(_idleTimer);
    if (_enabled) _idleTimer = setTimeout(lock, getTimeoutMs());
}

function recordActivity() {
    localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
    if (!_locked) resetIdleTimer();
}

function bindActivityEvents() {
    for (const ev of ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click']) {
        window.addEventListener(ev, recordActivity, { passive: true });
    }
}

function isStaleSession() {
    const last = parseInt(localStorage.getItem(ACTIVITY_KEY));
    if (!last) return false;
    const elapsed = Date.now() - last;
    dbg('Time since last activity:', Math.round(elapsed / 1000), 's, timeout:', getTimeoutMs() / 1000, 's');
    return elapsed > getTimeoutMs();
}

// ─── Logout ───────────────────────────────────────────────────────────────────

async function doLogout() {
    try {
        await fetch('/api/users/logout', {
            method:  'POST',
            headers: getRequestHeaders({ omitContentType: true }),
        });
    } catch (_) { /* best-effort */ }
    const p = new URLSearchParams(window.location.search);
    p.set('noauto', 'true');
    window.location.search = p.toString();
}

// ─── Lock ─────────────────────────────────────────────────────────────────────

async function lock() {
    if (_locked) return;
    _locked = true;
    clearTimeout(_idleTimer);
    _idleTimer = null;
    if (_fullLogout) {
        await doLogout();
    } else {
        sessionStorage.setItem(RELAY_KEY, '1');
        renderOverlay();
    }
}

// ─── Overlay ──────────────────────────────────────────────────────────────────

function renderOverlay() {
    if (_overlay) return;
    _overlay = document.createElement('div');
    _overlay.id = 'securityze-overlay';
    _overlay.innerHTML = `
        <div id="securityze-dialog">
            <div class="flex-container flexFlowColumn alignItemsCenter securityze-inner">
                <h3>Session Locked</h3>
                <input type="password" id="securityze-pw" class="text_pole" placeholder="Password" autocomplete="current-password" />
                <div id="securityze-err" class="neutral_warning"></div>
                <div id="securityze-btn" class="menu_button">Unlock</div>
            </div>
        </div>
    `;
    document.body.appendChild(_overlay);
    requestAnimationFrame(() => document.getElementById('securityze-pw')?.focus());
    document.getElementById('securityze-btn').addEventListener('click', attemptUnlock);
    document.getElementById('securityze-pw').addEventListener('keydown', e => {
        if (e.key === 'Enter') attemptUnlock();
    });
}

async function attemptUnlock() {
    const pwEl  = document.getElementById('securityze-pw');
    const errEl = document.getElementById('securityze-err');
    const btn   = document.getElementById('securityze-btn');
    const pw    = pwEl?.value;
    if (!pw) return;
    btn.disabled = true;
    errEl.textContent = '';
    try {
        const res = await fetch('/api/users/login', {
            method:  'POST',
            headers: getRequestHeaders(),
            body:    JSON.stringify({ handle: getCurrentUserHandle(), password: pw }),
        });
        if (res.ok) {
            _locked = false;
            sessionStorage.removeItem(RELAY_KEY);
            _overlay?.remove();
            _overlay = null;
            resetIdleTimer();
        } else {
            errEl.textContent = 'Incorrect password.';
            pwEl.value = '';
            pwEl.focus();
            btn.disabled = false;
        }
    } catch (_) {
        errEl.textContent = 'Connection error. Try again.';
        btn.disabled = false;
    }
}

// ─── Unload relay ─────────────────────────────────────────────────────────────

function bindUnloadRelay() {
    window.addEventListener('beforeunload', () => {
        if (_locked) sessionStorage.setItem(RELAY_KEY, '1');
    });
}

async function checkUnloadRelay() {
    if (!sessionStorage.getItem(RELAY_KEY)) return;
    sessionStorage.removeItem(RELAY_KEY);
    await doLogout();
}

// ─── Settings panel ───────────────────────────────────────────────────────────

function injectSettings(pwSet = true) {
    const container = document.getElementById('extensions_settings');
    if (!container) return;
    const mins = parseInt(localStorage.getItem(TIMEOUT_KEY)) || DEFAULT_MINS;
    container.insertAdjacentHTML('beforeend', `
        <div class="securityze-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Securityze</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    ${!pwSet ? `<div class="securityze-no-pw-warning">Securityze requires user accounts to be enabled in config.yaml (<code>enableUserAccounts: true</code>) and a password set on this account (User Settings &rarr; Admin Panel).</div>` : ''}
                    <label class="securityze-toggle-label ${!pwSet ? 'securityze-disabled' : ''}">
                        <input type="checkbox" id="securityze-enabled" ${_enabled ? 'checked' : ''} ${!pwSet ? 'disabled' : ''} />
                        Enable idle lock
                    </label>
                    <label class="securityze-timeout-label ${_enabled ? '' : 'securityze-disabled'}">
                        Lock after
                        <input type="number" id="securityze-timeout" value="${mins}" min="1" max="120" ${_enabled ? '' : 'disabled'} />
                        minutes of inactivity
                    </label>
                    <label class="securityze-toggle-label ${_enabled ? '' : 'securityze-disabled'}">
                        <input type="checkbox" id="securityze-full-logout" ${_fullLogout ? 'checked' : ''} ${!_enabled ? 'disabled' : ''} />
                        Full logout on lock
                    </label>
                    <div class="securityze-mode-hint">
                        ${_fullLogout
                            ? 'Session is destroyed on lock. Secure against direct URL access; requires full page reload to re-authenticate.'
                            : 'Session stays alive on lock. Fast unlock with no reload; direct URL access remains possible while locked.'}
                    </div>
                    <label class="securityze-toggle-label" style="margin-top:0.5rem;">
                        <input type="checkbox" id="securityze-verbose" ${_verbose ? 'checked' : ''} />
                        Verbose logging
                    </label>
                </div>
            </div>
        </div>
    `);

    document.getElementById('securityze-enabled').addEventListener('change', e => {
        _enabled = e.target.checked;
        localStorage.setItem(ENABLED_KEY, String(_enabled));
        const timeoutLabel  = document.querySelector('.securityze-timeout-label');
        const timeoutInput  = document.getElementById('securityze-timeout');
        const logoutToggle  = document.getElementById('securityze-full-logout');
        timeoutLabel.classList.toggle('securityze-disabled', !_enabled);
        timeoutInput.disabled  = !_enabled;
        logoutToggle.disabled  = !_enabled;
        _enabled ? resetIdleTimer() : clearTimeout(_idleTimer);
    });

    document.getElementById('securityze-timeout').addEventListener('change', e => {
        const v = parseInt(e.target.value);
        if (v > 0) {
            localStorage.setItem(TIMEOUT_KEY, String(v));
            resetIdleTimer();
        }
    });

    document.getElementById('securityze-full-logout').addEventListener('change', e => {
        _fullLogout = e.target.checked;
        localStorage.setItem(FULL_LOGOUT_KEY, String(_fullLogout));
        const hint = document.querySelector('.securityze-mode-hint');
        hint.textContent = _fullLogout
            ? 'Session is destroyed on lock. Secure against direct URL access; requires full page reload to re-authenticate.'
            : 'Session stays alive on lock. Fast unlock with no reload; direct URL access remains possible while locked.';
        dbg('fullLogout set to:', _fullLogout);
    });

    document.getElementById('securityze-verbose').addEventListener('change', e => {
        _verbose = e.target.checked;
        localStorage.setItem(VERBOSE_KEY, String(_verbose));
        console.log(`[${MODULE}] Verbose logging ${_verbose ? 'enabled' : 'disabled'}.`);
    });
}

// ─── Password check ───────────────────────────────────────────────────────────

async function hasPasswordSet() {
    try {
        dbg('Checking /api/users/me...');
        const res = await fetch('/api/users/me', { headers: getRequestHeaders() });
        dbg('/api/users/me status:', res.status);
        if (!res.ok) {
            dbg('Non-OK response — assuming password set');
            return true;
        }
        const data = await res.json();
        dbg('/api/users/me response:', JSON.stringify(data));
        dbg('password field:', data.password);
        return !!data.password;
    } catch (err) {
        dbg('Error fetching /api/users/me:', err.message);
        return true;
    }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

jQuery(async () => {
    dbg('Init starting — enabled:', _enabled, 'fullLogout:', _fullLogout, 'verbose:', _verbose);
    await checkUnloadRelay();

    const pwSet = await hasPasswordSet();
    dbg('hasPasswordSet result:', pwSet);
    if (!pwSet) {
        _enabled = false;
        console.warn(`[${MODULE}] No password set on account — lock disabled.`);
    }

    if (_enabled && isStaleSession()) {
        dbg('Stale session detected on load — locking immediately.');
        document.getElementById('securityze-early-cover')?.remove();
        await lock();
        return;
    }

    // Not stale — remove the early cover if it was painted
    document.getElementById('securityze-early-cover')?.remove();

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'szlock',
        callback: () => { lock(); return ''; },
        helpString: 'Lock the session immediately (Securityze).',
    }));

    bindActivityEvents();
    bindUnloadRelay();
    resetIdleTimer();
    injectSettings(pwSet);
    console.log(`[${MODULE}] Initialized — timeout: ${getTimeoutMs() / 60_000} min, enabled: ${_enabled}, fullLogout: ${_fullLogout}`);
});
