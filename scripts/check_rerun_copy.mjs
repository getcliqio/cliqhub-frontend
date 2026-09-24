#!/usr/bin/env node
/**
 * CI grep-gate for the "re-run" / "Rerun" copy sweep
 * (resume-and-run-again slice 3.5).
 *
 * The user-facing action was renamed to "Run again" in slice 3.2
 * (cliqhub e624b26). This gate prevents accidental regressions —
 * making sure new user-visible copy uses the canonical phrasing.
 *
 * How it works:
 *   1. Runs ripgrep for occurrences of the *word* forms
 *      `\brerun\b`, `\bRerun\b`, `\bre-run\b`, `\bRe-run\b`
 *      under src/.
 *   2. Word boundaries exclude accidental substrings like
 *      "fixture-run" (the `re-run` substring inside 'fixtu**re**-**run**' is
 *      preceded by a word char, so `\b` doesn't fire).
 *   3. Excludes test files (they document behaviour, will keep
 *      referencing the retired term in fixtures / assertions).
 *   4. Compares against an allow-list of accepted residue below.
 *
 * Internal snake_case identifiers (e.g. `rerun_busy`) don't match
 * these patterns — they're `rerun_busy` (word char + underscore),
 * not `\brerun\b`. The gate deliberately only targets natural-language
 * copy.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

/**
 * Accepted residue — count of "\brerun\b" / "\bRerun\b" /
 * "\bre-run\b" / "\bRe-run\b" hits per file. Every entry needs a
 * one-line justification.
 */
const ALLOWED = {
	// Developer comments that reference the retired action name to
	// document the retirement itself. Two matches: the "re-runs
	// from `from_phase`" comment explaining resume semantics, and
	// the "re-run on every unrelated state change" comment
	// explaining a useMemo. Not user-visible.
	'src/pages/runs/run_detail_page.tsx':      2,
	'src/components/dispatch/run_dialogs.tsx': 1,
	// `${run_name} (rerun)` suffix applied to the copied-forward run
	// name when the row-level "Run again" action opens the dialog.
	// Matches the identical suffix produced by run_detail_page.tsx so
	// downstream tooling sees consistent naming for both entry points.
	'src/pages/runs/runs_page.tsx':            1,
};

function run_ripgrep() {
	// Word-boundary flavoured PCRE-style regex; ripgrep understands
	// `\b` as non-word-char transition. `re-?run` covers both
	// hyphenated and mashed forms in a single pattern.
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
				'-e', '\\b[Rr]e-?run\\b',
				'src',
			],
			{ cwd: REPO_ROOT, encoding: 'utf8' },
		);
	} catch (err) {
		if (err?.code === 'ENOENT') {
			// rg not installed — fall back to grep with ERE.
			try {
				out = execFileSync(
					'grep',
					[
						'-r', '-c', '-E',
						'--include=*.ts', '--include=*.tsx',
						'--exclude-dir=__tests__',
						'-e', '\\b[Rr]e-?run\\b',
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
			'\n"re-run" copy-sweep gate failed (resume slice 3.5):\n\n'
			+ failures.join('\n')
			+ '\n\nUser-facing action is "Run again" (see cliqhub e624b26). '
			+ 'Reword the new occurrences, or if the string is genuinely '
			+ 'a developer-note comment about the retirement itself, add '
			+ 'the file to scripts/check_rerun_copy.mjs ALLOWED with a '
			+ 'justification.\n\n',
		);
		process.exit(1);
	}

	if (drift.length > 0) {
		process.stdout.write(
			'"re-run" gate: successful reductions detected. '
			+ 'Update scripts/check_rerun_copy.mjs to lock them in:\n\n'
			+ drift.join('\n') + '\n\n',
		);
	}

	process.stdout.write('"re-run" gate: OK\n');
}

main();
