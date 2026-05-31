/**
 * @file data/default-user/extensions/SillyTavern-Securityze/index.js
 * @stamp {"utc":"2026-05-31T00:00:00.000Z"}
 * @architectural-role Stateful Owner
 * @description
 * Inactivity lock for SillyTavern. After N minutes of user inactivity the
 * session is terminated server-side via POST /api/plugins/securityze/lock and
 * the browser is redirected to /?noauto=true (ST's login page). There is no
 * overlay or client-side password prompt; re-authentication goes through ST's
 * own login page, which requires a real password.
 *
 * @api-declaration
 * (no exports — self-registers on import)
 *
 * @contract
 *   assertions:
 *     purity: mutates
 *     state_ownership: [_idleTimer, _enabled]
 *     external_io: [/api/plugins/securityze/lock, DOM, localStorage]
 */

import { getRequestHeaders } from '../../../../script.js';

const MODULE       = 'Securityze';
const TIMEOUT_KEY  = 'securityze_timeout_minutes';
const ENABLED_KEY  = 'securityze_enabled';
const DEFAULT_MINS = 5;

let _idleTimer = null;
let _enabled   = localStorage.getItem(ENABLED_KEY) !== 'false';

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
        window.addEventListener(ev, resetIdleTimer, { passive: true });
    }
}

// ─── Lock ─────────────────────────────────────────────────────────────────────

async function lock() {
    clearTimeout(_idleTimer);
    _idleTimer = null;
    try {
        await fetch('/api/plugins/securityze/lock', {
            method:  'POST',
            headers: getRequestHeaders({ omitContentType: true }),
        });
    } catch (_) { /* best-effort — redirect regardless */ }
    const p = new URLSearchParams(window.location.search);
    p.set('noauto', 'true');
    window.location.search = p.toString();
}

// ─── Settings panel ───────────────────────────────────────────────────────────

function injectSettings() {
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
                    <label class="securityze-toggle-label">
                        <input type="checkbox" id="securityze-enabled" ${_enabled ? 'checked' : ''} />
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

// ─── Init ─────────────────────────────────────────────────────────────────────

jQuery(async () => {
    bindActivityEvents();
    resetIdleTimer();
    injectSettings();
    console.log(`[${MODULE}] Initialized — timeout: ${getTimeoutMs() / 60_000} min, enabled: ${_enabled}`);
});
