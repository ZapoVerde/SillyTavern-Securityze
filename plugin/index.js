/**
 * @file plugin/index.js
 * @stamp {"utc":"2026-05-31T00:00:00.000Z"}
 * @architectural-role IO Wrapper — ST server plugin entry point
 * @description
 * SillyTavern server plugin for Securityze. Two responsibilities:
 *
 * 1. Password sync: on every init, if SECURITYZE_PASSWORD is set, the env
 *    var value is hashed (scrypt, same algorithm as ST) and written directly to
 *    the user's node-persist storage file. node-persist names each file by the
 *    SHA256 of its key; we compute that directly so no node-persist import is
 *    needed. The compose value is always the source of truth — every restart
 *    syncs it, so the password can never drift from the env var.
 *
 * 2. Lock endpoint: POST /lock destroys the current cookie-session server-side.
 *    Called by the client-side extension when the idle timer fires; the client
 *    then navigates to /?noauto=true which shows ST's real login page.
 *
 * @api-declaration
 * init(router) → Promise<void>   (called by ST on plugin load)
 * POST /lock           → 204   destroys session; client navigates to login
 * GET  /install-status → { needsSymlink, extensionFound, canWrite, isDocker }
 * POST /install-symlink → replace plugin dir with symlink to extension plugin/
 *
 * @contract
 *   assertions:
 *     purity: mutates
 *     state_ownership: [none]
 *     external_io: [_storage/ (direct file I/O), req.session (cookie-session), process.env]
 */

import crypto from 'node:crypto';
import fs     from 'node:fs';
import path   from 'node:path';
import { getInstallStatus, installSymlink } from './setup.js';

const DEFAULT_USER_KEY = 'user:default-user';

// ─── Password bootstrap ───────────────────────────────────────────────────────

// node-persist names each file by the SHA256 hex of its key.
function storageFile(dataRoot, key) {
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    return path.join(dataRoot, '_storage', hash);
}

function bootstrapPassword() {
    const initPw = process.env.SECURITYZE_PASSWORD;
    if (!initPw) return;

    const filePath = storageFile(globalThis.DATA_ROOT, DEFAULT_USER_KEY);
    if (!fs.existsSync(filePath)) {
        console.warn('[Securityze] Default user storage file not found — skipping password bootstrap.');
        return;
    }

    const record   = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const salt     = crypto.randomBytes(16).toString('base64');
    const password = crypto.scryptSync(initPw.normalize(), salt, 64).toString('base64');
    record.value   = { ...record.value, password, salt };
    fs.writeFileSync(filePath, JSON.stringify(record));
    console.log('[Securityze] Default user password synced from SECURITYZE_PASSWORD.');
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export const info = {
    id:          'securityze',
    name:        'Securityze Plugin',
    description: 'Session lock endpoint + password sync for Securityze.',
};

export async function init(router) {
    bootstrapPassword();

    router.post('/lock', (req, res) => {
        if (req.session) {
            req.session = null;
        }
        res.sendStatus(204);
    });

    router.get('/install-status', (req, res) => {
        res.json(getInstallStatus());
    });

    router.post('/install-symlink', async (req, res) => {
        try {
            await installSymlink();
            res.sendStatus(204);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
}
