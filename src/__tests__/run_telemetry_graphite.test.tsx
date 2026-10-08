/** Run page telemetry: summary strip, phases clock, Timeline, Usage, DAG, span details. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { run_detail, overview_for_realm, REALM } from './fixtures_realm';
import { gs_response } from './fixtures_overview';
import type { Run_telemetry_data } from '@/lib/run_telemetry';
import { critical_path, dag_layers, fmt_count, fmt_ms, fmt_usd, phase_model_costs, tick_step, by_agent_csv } from '@/lib/run_telemetry';

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
		run: { run_id: 'run-77', state: 'failed', started_at: t0, completed_at: t0 + 10 * M },
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
	it('summary strip and phases clock with cost; no classic link', async () => {
		const calls = route_fetch();
		open();
		const strip = await screen.findByTestId('run-summary');
		await waitFor(() => expect(within(strip).getByText('$1.25')).toBeInTheDocument());
		expect(strip).toHaveTextContent('120k in');
		expect(strip).toHaveTextContent('50% of input from cache');
		expect(strip).toHaveTextContent('3 agent runs · 1 rework');
		expect(calls.find((c) => c.url === '/v1/run_telemetry/get')?.body).toEqual({ run_id: 'run-77' });
		const costs = screen.getAllByTestId('phase-cost').map((e) => e.textContent);
		expect(costs).toContain('$1.25');
		expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Phases 2', 'Timeline', 'Usage', 'DAG', 'Logs']);
	});

	it('timeline: a sub-team nests inside the phase that started it, with its steps and why it failed', async () => {
		const base = telemetry();
		const bar = (id: string, phase: string, agent: string, kind: 'llm' | 'human', s0: number, e0: number) => ({ ...base.bars[0], id, phase, agent, kind, start_ms: t0 + s0 * M, end_ms: t0 + e0 * M });
		const step = (name: string, status: string, s0: number, e0: number, kind: 'llm' | 'human') => ({ ...base.phases[0], name, kind, status, start_ms: t0 + s0 * M, end_ms: t0 + e0 * M });
		const design = {
			...step('design', 'failed', 1, 9, 'llm'),
			sub_runs: [{
				run_id: 'child-1', run_name: 'solar-lilac-fox', team: '@measureone/design-lld', state: 'failed',
				error: "Gate 'hug-lld' escalated: Review timed out after 30m", start_ms: t0 + 1 * M, end_ms: t0 + 9 * M,
				phases: [step('draft-lld', 'done', 1, 3, 'llm'), step('hug-lld', 'failed', 3, 9, 'human')],
				bars: [bar('c1', 'draft-lld', 'cursor', 'llm', 1, 3), bar('c2', 'hug-lld', 'hug', 'human', 3, 9)],
			}],
		};
		route_fetch(telemetry({ phases: [base.phases[0], design], bars: [base.bars[0]] }));
		open('/o/measureone/realms/prod-us/runs/run-77?tab=timeline');
		const lane = await screen.findByTestId('lane-design');
		// The sub-team is inside the design lane, not a sibling of it.
		const sub = within(lane).getByTestId('sub-run-child-1');
		expect(sub).toHaveTextContent('design-lld');
		expect(sub).toHaveTextContent('solar-lilac-fox · failed');
		expect(within(sub).getByTestId('sub-run-error-child-1')).toHaveTextContent('Failed: Gate \'hug-lld\' escalated: Review timed out after 30m');
		expect(within(sub).getByTestId('lane-design/child-1/draft-lld')).toBeInTheDocument();
		expect(within(sub).getByTestId('lane-design/child-1/hug-lld')).toBeInTheDocument();
		expect(within(sub).getByTestId('bar-c2')).toBeInTheDocument();
		expect(screen.queryByTestId('lane-draft-lld')).toBeNull();
		// One agent per step: one row each (the step name and its agent), not a header plus a row.
		expect(within(sub).getByTestId('lane-design/child-1/draft-lld')).toHaveTextContent('draft-lld');
		expect(within(sub).getByTestId('lane-design/child-1/draft-lld').querySelectorAll('[aria-expanded]')).toHaveLength(0);
		// Collapsing the parent phase hides the sub-team with it.
		fireEvent.click(within(lane).getAllByRole('button', { name: /design/ })[0]);
		expect(screen.queryByTestId('sub-run-child-1')).toBeNull();
	});

	it('timeline: lanes, filters, select a bar → details replace the side column → logs for that agent', async () => {
		const calls = route_fetch();
		open('/o/measureone/realms/prod-us/runs/run-77?tab=timeline');
		expect(await screen.findByTestId('timeline')).toBeInTheDocument();
		expect(screen.getByTestId('lane-fetch')).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'Gates' }));
		expect(screen.queryByTestId('lane-fetch')).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'All' }));
		expect(screen.getByRole('complementary', { name: 'Run details' })).toBeInTheDocument();
		fireEvent.click(screen.getByTestId('bar-b3'));
		const d = await screen.findByTestId('span-details');
		expect(d).toHaveTextContent('claude-sonnet-4.5 · anthropic');
		expect(d).toHaveTextContent('100k / 7k tokens · 60% cached');
		expect(d).toHaveTextContent('$1.00 (80% of run) · est.');
		expect(await within(d).findByText('[matcher] 12 rows matched')).toBeInTheDocument();
		expect(calls.find((c) => c.url === '/v1/runs/get_logs')?.body).toMatchObject({ realm_id: REALM.id, run_ids: ['run-77'], q: '[matcher]', limit: 4 });
		expect(screen.queryByRole('complementary', { name: 'Run details' })).toBeNull();
		fireEvent.click(within(d).getByRole('button', { name: /Logs for this agent/ }));
		expect(screen.getByRole('tab', { name: 'Logs' })).toHaveAttribute('aria-selected', 'true');
		expect(screen.getByDisplayValue('[matcher]')).toBeInTheDocument();
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

	it('DAG: nodes by dependency; clicking a node opens the timeline', async () => {
		route_fetch();
		open('/o/measureone/realms/prod-us/runs/run-77?tab=dag');
		expect(await screen.findByTestId('node-match')).toHaveTextContent('↻2');
		expect(screen.getByText('rework ×1')).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: 'cost' }));
		fireEvent.click(screen.getByTestId('node-match'));
		expect(await screen.findByTestId('timeline')).toBeInTheDocument();
	});

	it('no telemetry yet / read fails: page still works', async () => {
		route_fetch(telemetry({ bars: [], by_model: [], by_agent: [], totals: { ...telemetry().totals, cost_usd: null, tokens_in: null, tokens_out: null, cached_in: null, model_calls: null, agent_runs: 0, reworks: 0 }, sections: { usage: 'empty', spans: 'empty', phases: 'ok', workflow: 'ok' } }));
		const { unmount } = open('/o/measureone/realms/prod-us/runs/run-77?tab=timeline');
		expect(await screen.findByText(/No timeline yet/)).toBeInTheDocument();
		expect(screen.getByTestId('run-summary')).toHaveTextContent('No telemetry reported for this run yet');
		unmount(); vi.restoreAllMocks();
		route_fetch(null);
		open();
		expect(await screen.findByText('boom')).toBeInTheDocument();
		expect(screen.getAllByTestId('phase-row')).toHaveLength(2);
	});
});
