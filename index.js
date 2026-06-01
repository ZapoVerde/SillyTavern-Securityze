/**
 * @file data/default-user/extensions/SillyTavern-Securityze/index.js
 * @stamp {"utc":"2026-06-01T00:00:00.000Z"}
 * @architectural-role Stateful Owner
 * @description
 * Inactivity lock for SillyTavern. After N minutes of user inactivity an
 * overlay is shown requiring the account password to continue. The session
 * remains alive while locked so the page does not need to reload on unlock.
 *
 * F5/reload while locked is handled via a sessionStorage relay: beforeunload
 * writes a flag, and the next page load reads it and calls server-side logout
 * before rendering, landing on the real ST login page.
 *
 * Unlock verifies credentials via POST /api/users/login (rate-limited by ST).
 *
 * @api-declaration
 * (no exports — self-registers on import)
 *
 * @contract
 *   assertions:
 *     purity: mutates
 *     state_ownership: [_locked, _idleTimer, _enabled, _overlay]
 *     external_io: [/api/users/login, /api/users/logout, DOM, localStorage, sessionStorage]
 */

import { getRequestHeaders } from '../../../../script.js';
import { getCurrentUserHandle } from '../../../../scripts/user.js';
import { SlashCommandParser } from '../../../../scripts/slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../../scripts/slash-commands/SlashCommand.js';

const MODULE       = 'Securityze';
const TIMEOUT_KEY  = 'securityze_timeout_minutes';
const ENABLED_KEY  = 'securityze_enabled';
const RELAY_KEY    = 'securityze_locked_on_unload';
const DEFAULT_MINS = 5;

let _locked    = false;
let _idleTimer = null;
let _enabled   = localStorage.getItem(ENABLED_KEY) !== 'false';
let _overlay   = null;

// ─── Timer ────────────────────────────────────────────────────────────────────

function getTimeoutMs() {
    return (parseInt(localStorage.getItem(TIMEOUT_KEY)) || DEFAULT_MINS) * 60_000;
}

function resetIdleTimer() {
    clearTimeout(_idleTimer);
    if (_enabled) _idleTimer = setTimeout(lock, getTimeoutMs());
}

function bindActivityEvents() {
    for (const ev of ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click']) {
        window.addEventListener(ev, () => { if (!_locked) resetIdleTimer(); }, { passive: true });
    }
}

// ─── Logout (relay target) ────────────────────────────────────────────────────

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

function lock() {
    if (_locked) return;
    _locked = true;
    clearTimeout(_idleTimer);
    _idleTimer = null;
    sessionStorage.setItem(RELAY_KEY, '1');
    renderOverlay();
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
                </div>
            </div>
        </div>
    `);

    document.getElementById('securityze-enabled').addEventListener('change', e => {
        _enabled = e.target.checked;
        localStorage.setItem(ENABLED_KEY, String(_enabled));
        const timeoutLabel = document.querySelector('.securityze-timeout-label');
        const timeoutInput = document.getElementById('securityze-timeout');
        timeoutLabel.classList.toggle('securityze-disabled', !_enabled);
        timeoutInput.disabled = !_enabled;
        _enabled ? resetIdleTimer() : clearTimeout(_idleTimer);
    });

    document.getElementById('securityze-timeout').addEventListener('change', e => {
        const v = parseInt(e.target.value);
        if (v > 0) {
            localStorage.setItem(TIMEOUT_KEY, String(v));
            resetIdleTimer();
        }
    });
}

// ─── Password check ───────────────────────────────────────────────────────────

async function hasPasswordSet() {
    try {
        const res = await fetch('/api/users/me', { headers: getRequestHeaders() });
        if (!res.ok) return true; // assume set if we can't check
        const data = await res.json();
        return !!data.password;
    } catch (_) {
        return true; // assume set on network error
    }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

jQuery(async () => {
    await checkUnloadRelay();

    const pwSet = await hasPasswordSet();
    if (!pwSet) {
        _enabled = false;
        console.warn(`[${MODULE}] No password set on account — lock disabled.`);
    }

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'szlock',
        callback: () => { lock(); return ''; },
        helpString: 'Lock the session immediately (Securityze).',
    }));

    bindActivityEvents();
    bindUnloadRelay();
    resetIdleTimer();
    injectSettings(pwSet);
    console.log(`[${MODULE}] Initialized — timeout: ${getTimeoutMs() / 60_000} min, enabled: ${_enabled}`);
});
