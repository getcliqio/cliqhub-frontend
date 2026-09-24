/**
 * Smoke test for the resume slice 3.5 "re-run" copy-sweep gate.
 *
 * Fails if user-visible "re-run" / "Rerun" copy creeps back in
 * without an ALLOWED entry.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'check_rerun_copy.mjs');

describe('resume 3.5 — "re-run" copy-sweep gate', () => {
    it('script exists on disk', () => {
        expect(existsSync(SCRIPT)).toBe(true);
    });

    it('exits 0 against the current source tree', () => {
        const out = execFileSync('node', [SCRIPT], {
            cwd: REPO_ROOT,
            encoding: 'utf8',
        });
        expect(out).toContain('"re-run" gate: OK');
    });
});
