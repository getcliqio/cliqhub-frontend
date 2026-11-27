/** The run, phase by phase (PLAN-run-page S1–S5): what each phase does, folding, what opens by itself, how it stopped. */
import { describe, it, expect } from 'vitest';
import { phase_purpose } from '@/lib/phase_purpose';
import { auto_open, fail_reason, fold_phases, rerun_point, route_backs_by, route_backs_of, stop_head } from '@/components/graphite/g_run_story';
import type { Run_detail_phase, Run_failure, Run_phase_def, Run_route_back } from '@/lib/realm_inbox';

const def = (over: Partial<Run_phase_def>): Run_phase_def => ({
	name: 'x', type: 'standard', agent: null, description: null, depends_on: [], route_targets: [], max_iterations: null, commands: [], hug: null, team: null, ...over,
});
const phase = (name: string, status: string, over: Partial<Run_detail_phase> = {}): Run_detail_phase => ({
	phase: name, status, sequence: 0, started_at: 1, completed_at: 2, error: null, agent: null, ...over,
});

describe('phase_purpose (S1)', () => {
	it('the team\'s own description first, as written', () => {
		expect(phase_purpose(def({ description: 'Writes the parser code', type: 'gate', route_targets: ['a'] }))).toEqual({ text: 'Writes the parser code', derived: false });
	});
	it('a gate: what it checks, where it sends work back, how often — marked derived', () => {
		expect(phase_purpose(def({ type: 'gate', depends_on: ['analyze-and-build'], route_targets: ['analyze-and-build'], max_iterations: 3 })))
			.toEqual({ text: 'Gate. Checks analyze-and-build; sends it back to analyze-and-build with the problems, up to 3 times', derived: true });
		expect(phase_purpose(def({ type: 'gate', agent: 'hug', depends_on: ['work'], route_targets: ['work'] })).text).toBe('Gate. A person checks work; sends it back to work with the problems');
	});
	it('a Hug, a sub-team, commands, a connector, an LLM agent', () => {
		expect(phase_purpose(def({ hug: 'approval' })).text).toBe('Asks a person to approve before it goes on');
		expect(phase_purpose(def({ hug: 'field-review' })).text).toBe('Asks a person (field-review)');
		expect(phase_purpose(def({ type: 'team', team: '@m/confirm' })).text).toBe('Runs the sub-team @m/confirm');
		expect(phase_purpose(def({ agent: 'exec', commands: ['npx vitest run a.ts', 'npx tsc --noEmit -p .', 'make lint'] })).text).toBe('Runs npx vitest, npx tsc and 1 more');
		expect(phase_purpose(def({ agent: 'git' })).text).toBe('Works with git');
		expect(phase_purpose(def({ agent: 'cursor', depends_on: ['classify'] })).text).toBe('AI agent (cursor), working from classify');
	});
	it('no definition (older BFF): only the agent', () => {
		expect(phase_purpose(undefined, 'matcher')).toEqual({ text: 'Runs matcher', derived: true });
	});
});

describe('the list (S2)', () => {
	it('waiting, failed and running phases open by themselves; the rest wait for a click', () => {
		const ps = [phase('a', 'completed'), phase('b', 'running'), phase('c', 'awaiting_input'), phase('d', 'failed'), phase('e', 'pending')];
		expect([...auto_open(ps, 'running')]).toEqual(['b', 'c', 'd']);
		// Once the run has ended nothing is still running or waiting.
		expect([...auto_open([phase('b', 'running')], 'cancelled')]).toEqual([]);
	});
	it('four or more finished phases in a row fold into one line; an open one never folds', () => {
		const done = ['a', 'b', 'c', 'd', 'e'].map((n) => phase(n, 'completed'));
		const items = fold_phases([...done, phase('f', 'failed'), phase('g', 'completed')], 'failed', new Set(['f']));
		expect(items.map((i) => (i.kind === 'fold' ? `fold:${i.phases.length}` : i.phase.phase))).toEqual(['fold:5', 'f', 'g']);
		expect(fold_phases(done, 'completed', new Set(['c'])).map((i) => (i.kind === 'fold' ? 'fold' : i.phase.phase))).toEqual(['a', 'b', 'c', 'd', 'e']);
	});
});

describe('tries and stops (S3, S5)', () => {
	const rb: Run_route_back[] = [
		{ at: 1, phase: 'build', routed_by: 'check', reason: 'two fail', iteration: 1, max_iterations: 3 },
		{ at: 2, phase: 'outer.build', routed_by: 'outer.check', reason: 'one fails', iteration: 2, max_iterations: 3 },
	];
	it('a phase\'s send-backs and a gate\'s, matching qualified names inside sub-teams', () => {
		expect(route_backs_of(rb, 'build')).toHaveLength(2);
		expect(route_backs_by(rb, 'check')).toHaveLength(2);
		expect(route_backs_of(rb, 'other')).toHaveLength(0);
	});
	it('how it stopped: out of tries, crashed, timed out, escalated, or failed', () => {
		expect(stop_head(phase('check', 'failed'), def({ type: 'gate', max_iterations: 3 }), rb, 'failed')).toBe('Still failing after 3 tries');
		expect(stop_head(phase('x', 'crashed'), undefined, [], 'crashed')).toBe('Crashed');
		expect(stop_head(phase('x', 'failed', { error: 'Phase timed out after 600s' }), undefined, [], 'failed')).toBe('Timed out');
		expect(stop_head(phase('x', 'failed', { error: "Gate 'x' escalated: bad" }), undefined, [], 'failed')).toBe('Escalated');
		expect(stop_head(phase('x', 'failed', { error: 'exit code 1' }), undefined, [], 'failed')).toBe('Failed');
	});
});

describe('a failed phase with no error of its own (seen live, 26 Nov)', () => {
	const failure = (chain: Run_failure['chain'], resume_from: string | null): Run_failure => ({
		reason: 'agent_error' as Run_failure['reason'], summary: 'The agent reported an error', detail: 'parsewright type-pack exited 2', hint: null, chain, resume_from, review: null,
	});
	it('the reason comes from the run\'s failure explanation, else the run\'s error — never "no reason" when one exists', () => {
		const p = phase('prepare-run', 'failed');
		expect(fail_reason(p, [], failure([{ run_id: 'r', run_name: null, team: null, phase: 'prepare-run' }], 'prepare-run'), null)).toBe('parsewright type-pack exited 2');
		expect(fail_reason(p, [], null, "Phase 'prepare-run' failed: HARNESS_FAILED")).toBe("Phase 'prepare-run' failed: HARNESS_FAILED");
		expect(fail_reason(phase('x', 'failed', { error: 'own' }), [], null, 'run')).toBe('own');
		expect(fail_reason(p, [], null, null)).toBeNull();
	});
	it('resume point: this run\'s own; a sub-team\'s failure resumes this run from the team phase, not a sub-team phase', () => {
		const own = new Set(['prepare-run', 'build']);
		expect(rerun_point(phase('prepare-run', 'failed'), undefined, failure([{ run_id: 'r', run_name: null, team: null, phase: 'prepare-run' }], 'prepare-run'), own)).toBe('prepare-run');
		const sub = failure([{ run_id: 'r', run_name: null, team: null, phase: 'build' }, { run_id: 's', run_name: null, team: '@m/parser-builder', phase: 'others-unchanged' }], 'others-unchanged');
		expect(rerun_point(phase('build', 'failed'), undefined, sub, own)).toBe('build');
		// A gate resumes from where it sends work back.
		expect(rerun_point(phase('check', 'failed'), def({ route_targets: ['build'] }), null, own)).toBe('build');
	});
});
