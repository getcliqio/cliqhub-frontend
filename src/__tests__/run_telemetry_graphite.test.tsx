/** Run page telemetry: the run line's cost and tokens, the phase list's clock (rounds, folded waits), Workflow, Usage; the Timeline component. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { run_detail, overview_for_realm, REALM } from './fixtures_realm';
import { gs_response } from './fixtures_overview';
import type { Run_telemetry_data } from '@/lib/run_telemetry';
import { critical_path, dag_layers, fmt_count, fmt_ms, fmt_usd, phase_model_costs, tick_step, by_agent_csv, time_scale } from '@/lib/run_telemetry';

const auth = { user: { id: 'u1', username: 'sapan', display_name: 'Sapan', email: 's@x.com', role: 'user' as const, preferences: {} }, loading: false, logout: vi.fn(), acting_as: null, stop_act_as: vi.fn() };
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));
vi.mock('@/components/run_in_realm_dialog', () => ({ Run_in_realm_dialog: () => null }));

import { Component as RunPage } from '@/pages/realm/run_detail_page';
import { Timeline, short_error } from '@/components/graphite/g_telemetry';
import type { Run_attempt } from '@/lib/realm_inbox';

const M = 60_000;
const now = Date.now();
const t0 = now - 600_000;
function telemetry(over: Partial<Run_telemetry_data> = {}): Run_telemetry_data {
	return {
		run: { run_id: 'run-77', state: 'failed', started_at: t0, completed_at: t0 + 10 * M, origin: 'hub' },
		window: { start_ms: t0, end_ms: t0 + 10 * M },
		totals: { duration_ms: 10 * M, cost_usd: 1.25, tokens_in: 120_000, tokens_out: 8_000, cached_in: 60_000, model_calls: 14, agent_runs: 3, reworks: 1, time: { working_ms: 5 * M, people_ms: 0, gates_ms: 3 * M, other_ms: 1 * M, queued_ms: 1 * M } },
		phases: [
			{ name: 'fetch', kind: 'connector', type: 'standard', status: 'completed', start_ms: t0, end_ms: t0 + 5 * M, duration_ms: 5 * M, cost_usd: null, tokens_in: null, tokens_out: null, runs: 1, gate_outcome: null, depends_on: [] },
			{ name: 'match', kind: 'gate', type: 'GATE', status: 'failed', start_ms: t0 + 5 * M, end_ms: t0 + 10 * M, duration_ms: 5 * M, cost_usd: 1.25, tokens_in: 120_000, tokens_out: 8_000, runs: 2, gate_outcome: 'fail', depends_on: ['fetch'] },
		],
		bars: [
			{ id: 'b1', phase: 'fetch', agent: 'fetcher', kind: 'connector', model: null, provider: null, start_ms: t0, end_ms: t0 + 1 * M, status: 'ok', outcome: 'success', exit_code: 0, attempts: 1, unit_kind: 'calls', units_in: 6, units_out: null, cached_in: null, calls: 6, cost_usd: null, cost_estimated: false, run_index: 1 },
			{ id: 'b2', phase: 'match', agent: 'matcher', kind: 'gate', model: 'claude-haiku-4.5', provider: 'anthropic', start_ms: t0 + 5 * M, end_ms: t0 + 6 * M, status: 'error', outcome: 'failure', exit_code: 1, attempts: 1, unit_kind: 'tokens', units_in: 20_000, units_out: 1_000, cached_in: null, calls: 3, cost_usd: 0.25, cost_estimated: true, run_index: 1 },
			{ id: 'b3', phase: 'match', agent: 'matcher', kind: 'gate', model: 'claude-sonnet-4.5', provider: 'anthropic', start_ms: t0 + 7 * M, end_ms: t0 + 10 * M, status: 'ok', outcome: 'success', exit_code: 0, attempts: 1, unit_kind: 'tokens', units_in: 100_000, units_out: 7_000, cached_in: 60_000, calls: 11, cost_usd: 1.0, cost_estimated: true, run_index: 2 },
		],
		by_model: [{ model: 'claude-sonnet-4.5', provider: 'anthropic', calls: 11, tokens_in: 100_000, tokens_out: 7_000, cached_in: 60_000, cost_usd: 1.0 }, { model: 'claude-haiku-4.5', provider: 'anthropic', calls: 3, tokens_in: 20_000, tokens_out: 1_000, cached_in: null, cost_usd: 0.25 }],
		by_agent: [{ agent: 'matcher', phase: 'match', kind: 'gate', runs: 2, duration_ms: 4 * M, unit_kind: 'tokens', units_in: 120_000, units_out: 8_000, cost_usd: 1.25, failures: 1, outcome: 'success' }, { agent: 'fetcher', phase: 'fetch', kind: 'connector', runs: 1, duration_ms: M, unit_kind: 'calls', units_in: 6, units_out: null, cost_usd: null, failures: 0, outcome: 'success' }],
		sections: { usage: 'ok', spans: 'ok', phases: 'ok', workflow: 'ok' },
		partial: false,
		...over,
	};
}
type Call = { url: string; body: Record<string, unknown> };
function route_fetch(tel: Run_telemetry_data | null = telemetry()) {
	const calls: Call[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		calls.push({ url: u, body });
		if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: overview_for_realm() }));
		if (u === '/v1/getting_started/get') return gs_response(u)!;
		if (u === '/v1/run_detail/get') return new Response(JSON.stringify({ ok: true, data: run_detail() }));
		if (u === '/v1/run_telemetry/get') return tel ? new Response(JSON.stringify({ ok: true, data: tel })) : new Response(JSON.stringify({ ok: false, error: { message: 'boom' } }), { status: 502 });
		if (u === '/v1/runs/get_logs') return new Response(JSON.stringify({ ok: true, lines: [{ id: 'l1', created_at: now, level: 'info', message: '[matcher] 12 rows matched' }], total: 1 }));
		return new Response(JSON.stringify({ ok: true, data: {} }));
	});
	return calls;
}
function open(path = '/o/measureone/realms/prod-us/runs/run-77') {
	return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/o/:org/realms/:slug/runs/:run_id" element={<RunPage />} /></Routes></MemoryRouter>);
}
/** Unmount what's rendered and open the run again with `search`. */
function cleanup_and_open(search: string) {
	cleanup();
	return open(`/o/measureone/realms/prod-us/runs/run-77${search}`);
}
afterEach(() => vi.restoreAllMocks());

describe('run telemetry helpers', () => {
	it('formats and lays out', () => {
		expect(fmt_usd(1.234)).toBe('$1.23'); expect(fmt_usd(0.001)).toBe('<$0.01'); expect(fmt_usd(null)).toBe('—');
		expect(fmt_count(1_490_000)).toBe('1.49M'); expect(fmt_count(64_700)).toBe('65k'); expect(fmt_count(1204)).toBe('1.2k');
		expect(fmt_ms(3_840_000)).toBe('1h 04m'); expect(fmt_ms(342_000)).toBe('5m 42s');
		expect(tick_step(64 * M)).toBe(10 * M);
		const t = telemetry();
		expect([...critical_path(t.phases)]).toEqual(['match', 'fetch']);
		expect(dag_layers(t.phases).map((l) => l.map((p) => p.name))).toEqual([['fetch'], ['match']]);
		expect(phase_model_costs(t)).toEqual([{ phase: 'match', total: 1.25, parts: [{ model: 'claude-haiku-4.5', cost: 0.25 }, { model: 'claude-sonnet-4.5', cost: 1 }] }]);
		expect(by_agent_csv(t).split('\n')[1]).toBe('matcher,match,gate,2,240000,tokens,120000,8000,1.25,1,success');
	});
});

describe('time_scale (fold waiting)', () => {
	it('folds a long stretch with no work into a short gap and maps back', () => {
		// Work 0–10m and 50–60m; 40m of waiting in between.
		const sc = time_scale(0, 60 * M, [[0, 10 * M], [50 * M, 60 * M]], true);
		expect(sc.gaps).toEqual([{ start_ms: 10 * M, end_ms: 50 * M }]);
		expect(sc.x(10 * M)).toBeCloseTo(10 / 21.2, 3);
		expect(sc.x(60 * M)).toBeCloseTo(1, 6);
		expect(sc.x(50 * M) - sc.x(10 * M)).toBeLessThan(0.06);
		for (const ms of [5 * M, 30 * M, 55 * M]) expect(sc.t(sc.x(ms))).toBeCloseTo(ms, -1);
	});
	it('leaves short pauses and an unfolded scale linear', () => {
		expect(time_scale(0, 10 * M, [[0, 4 * M], [5 * M, 10 * M]], true).gaps).toEqual([]);
		const lin = time_scale(0, 60 * M, [[0, 10 * M], [50 * M, 60 * M]], false);
		expect(lin.gaps).toEqual([]);
		expect(lin.x(30 * M)).toBeCloseTo(0.5, 6);
	});
});

describe('Timeline history', () => {
	const at = (n: number, extra: Partial<Run_attempt> = {}): Run_attempt => ({ n, started_at: t0 + (n - 1) * 4 * M, from_phase: null, ended_at: null, state: 'failed', failed_phase: null, error: null, ...extra });
	it('says when a run was never resumed, and which phases re-ran', () => {
		render(<Timeline t={telemetry()} selected={null} on_select={() => {}} attempts={[at(1)]} now={t0 + 20 * M} />);
		expect(screen.getByTestId('timeline-history')).toHaveTextContent('Not resumed · Re-ran: match ×2');
		expect(screen.queryByTestId('resume-mark-2')).toBeNull();
	});
	it('names each resume, who asked for it, and marks it on the chart', () => {
		render(<Timeline t={telemetry()} selected={null} on_select={() => {}} attempts={[at(1), at(2, { from_phase: 'match', resumed_by: { username: 'krupali', display_name: 'Krupali' } })]} now={t0 + 20 * M} />);
		expect(screen.getByTestId('timeline-history')).toHaveTextContent(/Resumed 1× · from match by Krupali/);
		expect(screen.getByTestId('resume-mark-2')).toHaveAttribute('title', 'Resumed from match by Krupali');
	});
	it('trims a run error to one readable line', () => {
		expect(short_error("Phase 'hug-lld' failed: Gate 'hug-lld' escalated: Review adbf4c163079603a6915ff1cc4c9b18d timed out after 30m — escalating"))
			.toBe("Gate 'hug-lld' escalated: Review timed out after 30m");
	});
});

describe('Run page telemetry', () => {
	it('the run line carries cost and tokens; each phase its cost; views are Phases, Usage, Logs, Details', async () => {
		const calls = route_fetch();
		open();
		const meta = await screen.findByTestId('run-meta');
		await waitFor(() => expect(meta).toHaveTextContent('$1.25'));
		expect(meta).toHaveTextContent('120k in · 8k out');
		expect(screen.queryByTestId('run-summary')).toBeNull();
		expect(calls.find((c) => c.url === '/v1/run_telemetry/get')?.body).toEqual({ run_id: 'run-77' });
		expect(screen.getAllByTestId('phase-cost').map((e) => e.textContent)).toContain('$1.25');
		expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Phases', 'Usage', 'Logs', 'Details']);
	});

	it('phases: a team phase opens into its sub-team\'s steps, at any depth; a step opens its details beside', async () => {
		const base = telemetry();
		const step = (name: string, status: string, extra: Record<string, unknown> = {}) => ({ ...base.phases[0], name, status, start_ms: t0, end_ms: t0 + 2 * M, cost_usd: null, ...extra });
		const lint = { run_id: 'grand-1', run_name: 'small-lint', team: '@measureone/lint-lld', state: 'completed', error: null, start_ms: t0, end_ms: t0 + M,
			phases: [step('lint', 'done')], bars: [], usage: { cost_usd: null, tokens_in: null, tokens_out: null, cached_in: null, model_calls: null } };
		const lld = { run_id: 'child-1', run_name: 'brave-rust-anchor', team: '@measureone/design-lld', state: 'failed', error: 'Review expired', start_ms: t0, end_ms: t0 + 9 * M,
			phases: [step('draft-lld', 'done', { runs: 2, kind: 'llm', cost_usd: 1.1 }), step('assemble', 'done', { sub_runs: [lint] }), step('hug-lld', 'failed', { kind: 'human', runs: 2, error: "Gate 'hug-lld' escalated: Review expired" })],
			bars: [], usage: { cost_usd: 1.26, tokens_in: 1, tokens_out: 1, cached_in: null, model_calls: 3 } };
		route_fetch(telemetry({ phases: [base.phases[0], { ...base.phases[1], sub_runs: [lld] }] }));
		open('/o/measureone/realms/prod-us/runs/run-77');
		const node = await screen.findByTestId('tree-run-child-1');
		// Failed sub-teams start open; the completed one inside it starts folded.
		expect(within(node).getByTestId('tree-step-child-1-draft-lld')).toHaveTextContent('ran 2×');
		expect(within(node).getByTestId('tree-step-child-1-hug-lld')).toHaveTextContent('2 rounds');
		expect(within(node).getByTestId('tree-run-grand-1')).toHaveTextContent('1 step');
		expect(screen.queryByTestId('tree-step-grand-1-lint')).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Open sub-team lint-lld' }));
		expect(screen.getByTestId('tree-step-grand-1-lint')).toBeInTheDocument();
		fireEvent.click(screen.getByTestId('tree-step-child-1-hug-lld'));
		const d = screen.getByTestId('step-details');
		expect(within(d).getByTestId('step-path')).toHaveTextContent('Nightly reconcile › design-lld ›');
		expect(within(d).getByTestId('step-error')).toHaveTextContent('Review expired');
		expect(within(d).getByRole('link', { name: 'Resume sub-team from hug-lld' })).toHaveAttribute('href', '/o/measureone/realms/prod-us/runs/child-1?resume=hug-lld');
		fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
		expect(screen.queryByTestId('tree-step-child-1-draft-lld')).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
		expect(screen.getByTestId('tree-step-grand-1-lint')).toBeInTheDocument();
	});

	it('list clock: each round is its own segment on the phase\'s row; a long wait on people is folded', async () => {
		const base = telemetry();
		// ~9m of agents working in a 40m run: the 26m wait on people folds.
		const bars = base.bars.map((b) => (b.id === 'b3' ? { ...b, end_ms: t0 + 14 * M } : b));
		const wait = { ...base.bars[0], id: 'w1', phase: 'review', agent: 'hug', kind: 'human' as const, start_ms: t0 + 14 * M, end_ms: t0 + 40 * M };
		route_fetch(telemetry({ phases: [...base.phases, { ...base.phases[0], name: 'review', kind: 'human', status: 'completed', runs: 1, start_ms: t0 + 14 * M, end_ms: t0 + 40 * M }], bars: [...bars, wait], window: { start_ms: t0, end_ms: t0 + 40 * M } }));
		open();
		const match = await screen.findByTestId('clock-match');
		expect(within(match).getAllByTestId('clock-seg')).toHaveLength(2);
		expect(within(screen.getByTestId('clock-fetch')).getAllByTestId('clock-seg')).toHaveLength(1);
		expect(within(match).getAllByTestId('clock-gap').length).toBeGreaterThan(0);
		expect(screen.getByTestId('clock-legend')).toHaveTextContent('long wait folded');
		// Old ?tab=timeline links land on the phases.
		cleanup_and_open('?tab=timeline');
		expect(await screen.findByTestId('clock-match')).toBeInTheDocument();
		expect(screen.getByRole('tab', { name: 'Phases' })).toHaveAttribute('aria-selected', 'true');
	});
	it('list clock: a run that is mostly waiting isn\'t folded (a 0s script doesn\'t fill the bar)', async () => {
		const base = telemetry();
		const quick = { ...base.bars[0], start_ms: t0, end_ms: t0 + 5_000 };
		const wait = { ...base.bars[0], id: 'w1', phase: 'match', agent: 'hug', kind: 'human' as const, start_ms: t0 + 10_000, end_ms: t0 + 30 * M };
		route_fetch(telemetry({ phases: [{ ...base.phases[0], end_ms: t0 + 5_000 }, { ...base.phases[1], kind: 'human', runs: 1, start_ms: t0 + 10_000, end_ms: t0 + 30 * M }], bars: [quick, wait], window: { start_ms: t0, end_ms: t0 + 30 * M } }));
		open();
		const fetch_seg = within(await screen.findByTestId('clock-fetch')).getByTestId('clock-seg');
		expect(parseFloat(fetch_seg.style.width)).toBeLessThan(2);
		expect(screen.queryAllByTestId('clock-gap')).toHaveLength(0);
	});

	it('phases: the workflow graph on top, the table below — picking a phase in one marks it in the other', async () => {
		route_fetch();
		open();
		const graph = await screen.findByTestId('run-workflow');
		expect(graph).toHaveTextContent('fetch');
		expect(graph).toHaveTextContent('match');
		const row = (name: string) => screen.getAllByTestId('phase-row').find((r) => r.getAttribute('data-phase-row') === name)!;
		expect(row('match')).toHaveAttribute('aria-current', 'true'); // the failed phase is picked first
		fireEvent.click(within(graph).getAllByText('fetch')[0]);
		await waitFor(() => expect(row('fetch')).toHaveAttribute('aria-current', 'true'));
		expect(row('match')).not.toHaveAttribute('aria-current');
		fireEvent.click(within(row('match')).getByText('match'));
		await waitFor(() => expect(row('match')).toHaveAttribute('aria-current', 'true'));
	});
	it('usage: cost by phase, time, models and agents', async () => {
		route_fetch();
		open('/o/measureone/realms/prod-us/runs/run-77?tab=usage');
		expect(await screen.findByTestId('usage')).toBeInTheDocument();
		expect(screen.getByTestId('cost-match')).toHaveTextContent('$1.25');
		expect(screen.getByText('fetch: no model cost')).toBeInTheDocument();
		expect(screen.getByTestId('model-claude-sonnet-4.5')).toHaveTextContent('60%');
		expect(screen.getByTestId('agent-matcher')).toHaveTextContent('1 failed → success');
	});

	it('old ?tab=dag / ?tab=workflow links open the phases (graph on top)', async () => {
		route_fetch();
		open('/o/measureone/realms/prod-us/runs/run-77?tab=dag');
		expect(await screen.findByTestId('run-workflow')).toBeInTheDocument();
		expect(screen.getByRole('tab', { name: 'Phases' })).toHaveAttribute('aria-selected', 'true');
	});
	it('no telemetry yet / read fails: page still works', async () => {
		route_fetch(telemetry({ bars: [], by_model: [], by_agent: [], totals: { ...telemetry().totals, cost_usd: null, tokens_in: null, tokens_out: null, cached_in: null, model_calls: null, agent_runs: 0, reworks: 0 }, sections: { usage: 'empty', spans: 'empty', phases: 'ok', workflow: 'ok' } }));
		const { unmount } = open();
		expect(await screen.findAllByTestId('phase-row')).toHaveLength(2);
		expect(screen.getByTestId('run-meta')).not.toHaveTextContent('$');
		expect(screen.queryByTestId('clock-legend')).toBeNull();
		unmount(); vi.restoreAllMocks();
		route_fetch(null);
		open();
		expect(await screen.findByText('boom')).toBeInTheDocument();
		expect(screen.getAllByTestId('phase-row')).toHaveLength(2);
	});
});
