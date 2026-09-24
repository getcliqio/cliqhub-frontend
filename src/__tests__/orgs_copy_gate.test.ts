/**
 * Smoke test for the remove-orgs slice 3.5 copy-sweep gate.
 *
 * Ensures the script exists and runs green today — so a CI pipeline
 * that shells out to `npm run check:orgs-copy` gets a familiar exit
 * signal, and so anyone bumping the ALLOWED table in
 * scripts/check_orgs_copy.mjs gets a red vitest run if the numbers
 * are lower than reality (drift warnings are informational; the
 * script only exits 1 on regressions, so this test asserts exit 0
 * for the current tree).
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'check_orgs_copy.mjs');

describe('remove-orgs 3.5 — copy-sweep gate', () => {
    it('script exists on disk', () => {
        expect(existsSync(SCRIPT)).toBe(true);
    });

    it('exits 0 against the current source tree', () => {
        // If someone adds a new user-facing "organization" without
        // updating the ALLOWED table, this test flips red and points
        // to the script's stderr.
        const out = execFileSync('node', [SCRIPT], {
            cwd: REPO_ROOT,
            encoding: 'utf8',
        });
        expect(out).toContain('copy-sweep gate: OK');
    });
});
