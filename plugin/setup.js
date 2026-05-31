/**
 * @file plugin/setup.js
 * @stamp {"utc":"2026-05-31T00:00:00.000Z"}
 * @architectural-role IO Wrapper — filesystem install-status check and symlink creation
 * @description
 * Determines whether the deployed plugin directory is a symlink pointing to the
 * Securityze extension's plugin/ subdirectory, and replaces it with one on request.
 *
 * @api-declaration
 * getInstallStatus() → { needsSymlink: boolean, extensionFound: boolean, canWrite: boolean, isDocker: boolean }
 * installSymlink()   → Promise<void>   (throws on failure)
 *
 * @contract
 *   assertions:
 *     purity:          mutates (filesystem)
 *     state_ownership: [none]
 *     external_io:     [filesystem]
 */

import path              from 'node:path';
import fs                from 'node:fs';
import { fileURLToPath } from 'url';

const __filename     = fileURLToPath(import.meta.url);
const __dirname_here = path.dirname(__filename);   // [ST_ROOT]/plugins/securityze

const PLUGIN_DIR     = __dirname_here;
const ST_ROOT        = path.resolve(__dirname_here, '../..');
const EXT_PLUGIN_DIR = path.join(
    ST_ROOT, 'public', 'scripts', 'extensions', 'third-party', 'SillyTavern-Securityze', 'plugin',
);

export function getInstallStatus() {
    const isDocker = fs.existsSync('/.dockerenv');

    let needsSymlink = false;
    try {
        needsSymlink = !fs.lstatSync(PLUGIN_DIR).isSymbolicLink();
    } catch {
        return { needsSymlink: false, extensionFound: false, canWrite: false, isDocker };
    }

    const extensionFound = fs.existsSync(EXT_PLUGIN_DIR);

    let canWrite = false;
    try {
        fs.accessSync(path.dirname(PLUGIN_DIR), fs.constants.W_OK);
        canWrite = true;
    } catch { /* read-only mount or wrong owner */ }

    return { needsSymlink, extensionFound, canWrite, isDocker };
}

export async function installSymlink() {
    if (!fs.existsSync(EXT_PLUGIN_DIR)) {
        throw new Error(`Extension plugin directory not found: ${EXT_PLUGIN_DIR}`);
    }

    const backup    = path.join(path.dirname(PLUGIN_DIR), `securityze_bak_${Date.now()}`);
    const relTarget = path.relative(path.dirname(PLUGIN_DIR), EXT_PLUGIN_DIR);

    fs.renameSync(PLUGIN_DIR, backup);
    try {
        fs.symlinkSync(relTarget, PLUGIN_DIR, 'dir');
        fs.rmSync(backup, { recursive: true, force: true });
    } catch (err) {
        fs.renameSync(backup, PLUGIN_DIR); // rollback
        throw err;
    }
}
