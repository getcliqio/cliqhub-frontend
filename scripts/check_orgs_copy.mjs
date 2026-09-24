#!/usr/bin/env node
/**
 * CI grep-gate for the "organization" copy sweep (remove-orgs slice 3.5).
 *
 * The organizations concept was retired from user-facing primary nav
 * (slice 3.2/3.3) and its copy was swept from the mainstream flows
 * (slice 3.5). This script prevents accidental regressions —
 * without eradicating the word from every legitimately-org-scoped
 * surface that still exists (admin console, back-compat routes, and
 * internal identifiers that survive the retirement).
 *
 * How it works:
 *   1. Runs ripgrep for occurrences of "Organization" / "organization"
 *      under src/ (case-sensitive; the two forms cover title + body copy).
 *   2. Counts occurrences per file.
 *   3. Compares against an allow-list of accepted residue below. If a
 *      file's count *increases*, fail with a diff. If a new file
 *      appears with any count, fail.
 *
 * Update the allow-list only when the corresponding surface is
 * legitimately org-scoped and cannot be reworded, or when a slice
 * intentionally lowers the count (then update the number).
 *
 * Run manually:  node scripts/check_orgs_copy.mjs
 * Run in CI:     npm run check:orgs-copy   (see package.json)
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(REPO_ROOT, 'src');

/**
 * Accepted residue — count of "Organization" / "organization" hits per file.
 * Every entry needs a one-line justification (why the string is
 * intentionally kept).
 */
const ALLOWED = {
	// Site-admin surface — org tenancy is real and the concept is
	// still meaningful to platform admins operating multi-tenant.
	'src/pages/admin/orgs_page.tsx':          5,
	'src/pages/admin/org_detail_page.tsx':    3,
	'src/pages/admin/scopes_page.tsx':        1,
	'src/pages/admin/users_page.tsx':         1,

	// Legacy /orgs/:id detail page — still routable (invite emails
	// link there). Explicit "organization" phrasing scopes the page
	// vs. the user's realms.
	'src/pages/account/org_detail_page.tsx':  8,

	// Users/roles are org-scoped in the current backend model
	// (remove-orgs pass A dual-shape hasn't shipped yet). Rewording
	// would misrepresent the technical scope.
	'src/pages/account/account_users_panel.tsx': 8,

	// Scope-picker copy references the org-vs-personal split that
	// still exists in the scopes model.
	'src/pages/account/scopes_page.tsx':      3,

	// Multi-tenant org switcher label + PAT scope selector —
	// keeps org tenancy legible for enterprise callers until pass A
	// dual-shape permissions land.
	'src/components/app_top_bar.tsx':         1,
	'src/pages/account/tokens_page.tsx':      1,
	'src/components/builder/publish_dialog.tsx': 1,

	// Sidebar + docs — comment/legacy-nav references documenting
	// the retirement, plus the still-present /admin/orgs entry.
	'src/components/app_sidebar.tsx':         3,

	// Tab-name back-compat: users typing /settings?tab=organizations
	// still get redirected. Three references (parser + comment
	// documenting the retirement + "Organization" as a display-name
	// fallback for orgs with no display_name set).
	'src/pages/account/account_page.tsx':     3,

	// Developer comment documenting the /organizations → /realms
	// redirect rewiring; no user-visible copy.
	'src/pages/invite_accept_page.tsx':       1,

	// Router redirect targets from the retirement.
	'src/router.tsx':                          2,

	// org_context.tsx — the internal name of the auth context.
	// Not user-facing.
	'src/lib/org_context.tsx':                 1,
};

function run_ripgrep() {
	// -c gives per-file counts. Case-sensitive (default) so we only
	// match "Organization" + "organization" — not accidental substrings.
	// Test files document behaviour (they'll reference the retired
	// concept in fixtures / assertions); the gate targets user-visible
	// production code only.
	//
	// Falls back to grep -r when rg is not installed.
	let out;
	try {
		out = execFileSync(
			'rg',
			[
				'-c', '--no-heading',
				'-g', '!src/__tests__/**',
				'-g', '!**/*.test.ts',
				'-g', '!**/*.test.tsx',
				'-e', 'Organization',
				'-e', 'organization',
				'src',
			],
			{ cwd: REPO_ROOT, encoding: 'utf8' },
		);
	} catch (err) {
		if (err?.code === 'ENOENT') {
			// rg not installed — fall back to grep.
			try {
				out = execFileSync(
					'grep',
					[
						'-r', '-c',
						'--include=*.ts', '--include=*.tsx',
						'--exclude-dir=__tests__',
						'-e', 'Organization',
						'-e', 'organization',
						'src',
					],
					{ cwd: REPO_ROOT, encoding: 'utf8' },
				);
			} catch (grep_err) {
				// grep exits 1 when no matches — that's fine.
				out = grep_err?.stdout ?? '';
			}
		} else {
			throw err;
		}
	}
	const counts = {};
	for (const line of out.split('\n')) {
		if (!line.trim()) continue;
		const idx = line.lastIndexOf(':');
		const file = line.slice(0, idx);
		const count = parseInt(line.slice(idx + 1), 10);
		if (!Number.isFinite(count)) continue;
		counts[file] = count;
	}
	return counts;
}

function main() {
	const actual = run_ripgrep();
	const failures = [];
	const drift = [];

	for (const [file, count] of Object.entries(actual)) {
		const allowed = ALLOWED[file] ?? 0;
		if (count > allowed) {
			failures.push(`  ✗ ${file}: ${count} occurrences (allowed: ${allowed})`);
		}
		if (count < allowed) {
			// Successful reduction — remind the maintainer to update
			// the allow-list so it doesn't drift back up silently.
			drift.push(`  ↓ ${file}: ${count} occurrences (allowed: ${allowed}) — lower ALLOWED to ${count}`);
		}
	}

	for (const file of Object.keys(ALLOWED)) {
		if (!(file in actual)) {
			drift.push(`  ↓ ${file}: 0 occurrences (allowed: ${ALLOWED[file]}) — remove from ALLOWED`);
		}
	}

	if (failures.length > 0) {
		process.stderr.write(
			'\n"organization" copy-sweep gate failed (remove-orgs slice 3.5):\n\n'
			+ failures.join('\n')
			+ '\n\nReword the new occurrences to "realm" / "workspace" or, if the '
			+ 'string is legitimately org-scoped (site-admin, legacy compat), add '
			+ 'the file to scripts/check_orgs_copy.mjs ALLOWED with a justification.\n\n',
		);
		process.exit(1);
	}

	if (drift.length > 0) {
		process.stdout.write(
			'copy-sweep gate: successful reductions detected. '
			+ 'Update scripts/check_orgs_copy.mjs to lock them in:\n\n'
			+ drift.join('\n') + '\n\n',
		);
	}

	process.stdout.write('copy-sweep gate: OK\n');
}

main();
