/**
 * The form's checks say what the SDK says. Core validates every answer with the SDK's
 * `validate_values`; `lib/hug.ts` mirrors it for messages before sending. The same cases go
 * through both (the built SDK from the sibling cliq-sdk checkout — `npm run build` there; skipped
 * without it).
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { value_problems, type Requested_input } from '@/lib/hug';

/** Tests run from the frontend's root; cliq-sdk is its sibling checkout (its build: plain JS Node can load). */
const SDK = resolve(process.cwd(), '../cliq-sdk/dist/hug/requested_inputs.js');
const has_sdk = existsSync(SDK);

/** The SDK's verdict on every case, from a plain `node` (the SDK is outside this project, so Vitest won't load it). */
function sdk_problems(inputs: unknown, cases: unknown[]): string[][] {
	const script = `import(process.argv[1]).then(({ validate_values }) => {
		const { inputs, cases } = JSON.parse(process.argv[2]);
		process.stdout.write(JSON.stringify(cases.map((c) => { const r = validate_values(inputs, c); return r.ok ? [] : r.problems; })));
	});`;
	return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script, SDK, JSON.stringify({ inputs, cases })], { encoding: 'utf8' }));
}

const INPUTS: Requested_input[] = [
	{ name: 'title', type: 'text', min_length: 3, max_length: 8 },
	{ name: 'note', type: 'text', required: false },
	{ name: 'count', type: 'number', min: 0, max: 10, integer: true },
	{ name: 'ok', type: 'boolean' },
	{ name: 'pick', type: 'enum', choices: [{ value: 'a' }, { value: 'b' }] },
	{ name: 'many', type: 'enum', multiple: true, required: false, choices: [{ value: 'a' }, { value: 'b' }] },
	{ name: 'file', type: 'file', required: false },
	{ name: 'files', type: 'file', multiple: true, required: false },
	{ name: 'to', type: 'channel', required: false },
];

const CASES: Array<Record<string, unknown>> = [
	{},
	{ title: 'abc', count: 3, ok: true, pick: 'a' },
	{ title: 'ab', count: -1, ok: 'yes', pick: 'c' },
	{ title: 'ABCD', count: 2.5, ok: false, pick: 'b' },
	{ title: 'abcdefghij', count: 11, ok: true, pick: 1 },
	{ title: '   ', count: 'x', ok: true, pick: 'a', note: 5 },
	{ title: 'abc', count: 1, ok: true, pick: 'a', many: ['a', 'a'] },
	{ title: 'abc', count: 1, ok: true, pick: 'a', many: ['z'], file: { artifact_id: '' }, files: [{ artifact_id: 'x' }] },
	{ title: 'abc', count: 1, ok: true, pick: 'a', file: { artifact_id: 'f' }, files: 'nope', to: ['a', 'b'] },
	{ title: 'abc', count: 1, ok: true, pick: 'a', to: [' '] },
	{ title: 'abc', count: 1, ok: true, pick: 'a', files: Array.from({ length: 11 }, (_, i) => ({ artifact_id: `f${i}` })) },
];

describe.skipIf(!has_sdk)('the form checks match the SDK (Core\'s validator)', () => {
	const theirs = has_sdk ? sdk_problems(INPUTS, CASES) : [];
	it.each(CASES.map((c, i) => [i, c] as const))('case %i', (i, values) => {
		const ours = Object.entries(value_problems(INPUTS, values)).map(([k, v]) => `${k}: ${v}`);
		expect(ours.sort()).toEqual([...theirs[i]!].sort());
	});
});
