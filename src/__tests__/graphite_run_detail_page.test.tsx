/**
 * Graphite run detail — composition read, state-driven actions, control
 * calls (supply / cancel modes / resume), banners, stranded errors, logs,
 * canonical realm redirect, polling cadence.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { run_detail, overview_for_realm, REALM } from './fixtures_realm';
import { gs_response } from './fixtures_overview';
import type { Run_detail_data } from '@/lib/realm_inbox';

const auth = {
	user: { id: 'u1', username: 'sapan', display_name: 'Sapan Shah', email: 's@x.com', role: 'user' as const, preferences: {} },
	loading: false,
	logout: vi.fn(),
	acting_as: null,
	stop_act_as: vi.fn(),
};
const stable_fetch = (url: string, init?: RequestInit) => fetch(url, init);
vi.mock('@/lib/auth_context', () => ({ useAuth: () => auth, useAuthFetch: () => stable_fetch }));
vi.mock('@/components/run_in_realm_dialog', () => ({
	Run_in_realm_dialog: (p: { scope: string; slug: string; fixed_realm: { id: string }; prefill_from: { inputs: unknown; run_name: string | null; source_run_id: string } }) => (
		<div role="dialog" aria-label="Run again">
			{p.scope}/{p.slug} in {p.fixed_realm.id} · {JSON.stringify(p.prefill_from)}
		</div>
	),
}));

import { Component as RunPage, LIVE_POLL_MS, IDLE_POLL_MS } from '@/pages/realm/run_detail_page';

function Where() {
	const loc = useLocation();
	return <div data-testid="where">{loc.pathname}{loc.search}</div>;
}

type Handler = (body: Record<string, unknown>) => { status?: number; body: unknown };

function route_fetch(detail: Run_detail_data | (() => Run_detail_data), handlers: Record<string, Handler> = {}) {
	return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
		const u = String(url);
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		if (u === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: overview_for_realm() }));
		if (u === '/v1/getting_started/get') return gs_response(u)!;
		if (u === '/v1/run_detail/get') {
			const d = typeof detail === 'function' ? detail() : detail;
			return new Response(JSON.stringify({ ok: true, data: d }));
		}
		if (handlers[u]) {
			const r = handlers[u](body);
			return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
		}
		throw new Error(`unexpected ${u}`);
	});
}

function calls(spy: ReturnType<typeof route_fetch>, path: string) {
	return spy.mock.calls.filter(([u]) => u === path).map(([, i]) => JSON.parse(String((i as RequestInit).body)));
}

function render_page(path = '/o/measureone/realms/prod-us/runs/run-77') {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route path="/o/:org/realms/:slug/runs/:run_id" element={<><RunPage /><Where /></>} />
				<Route path="*" element={<Where />} />
			</Routes>
		</MemoryRouter>,
	);
}

async function ready() {
	return screen.findByRole('heading', { level: 1 });
}

describe('Graphite run detail', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it('loads through one composition call with the run id and no Core fan-out', async () => {
		const spy = route_fetch(run_detail());
		render_page();
		expect(await ready()).toHaveTextContent('Nightly reconcile');
		expect(calls(spy, '/v1/run_detail/get')).toEqual([{ run_id: 'run-77' }]);
		const other = spy.mock.calls.map(([u]) => String(u)).filter((u) => !['/v1/run_detail/get', '/v1/run_telemetry/get', '/v1/overview/get', '/v1/getting_started/get'].includes(u));
		expect(other).toEqual([]);
	});

	it('always shows Files, with how agents publish them when the run has none', async () => {
		route_fetch(run_detail());
		render_page();
		await ready();
		expect(screen.getByTestId('run-artifacts')).toHaveTextContent('No files in this run. Agents publish files with cliq-artifact submit');
	});

	it('lists stored artifacts and downloads through artifacts/get_by_id', async () => {
		const open = vi.spyOn(window, 'open').mockReturnValue(null);
		const spy = route_fetch(
			run_detail({ artifacts: [{ artifact_id: 'a1', phase: 'report', name: 'report.pdf', description: 'Weekly', mime_type: 'application/pdf', size_bytes: 2048, created_at: 5 }] }),
			{ '/v1/artifacts/get_by_id': () => ({ body: { ok: true, data: { download_url: 'https://r2.example/report.pdf?sig' } } }) },
		);
		render_page();
		await ready();
		const row = screen.getByTestId('artifact-row');
		expect(row).toHaveTextContent('report.pdf');
		expect(row).toHaveTextContent('File · 2.0 KB · Weekly');
		expect(screen.getByTestId('artifact-phase-report')).toContainElement(row);
		fireEvent.click(screen.getByRole('button', { name: 'Download report.pdf' }));
		await waitFor(() => expect(open).toHaveBeenCalledWith('https://r2.example/report.pdf?sig', '_blank', 'noopener'));
		expect(calls(spy, '/v1/artifacts/get_by_id')).toEqual([{ artifact_id: 'a1' }]);
	});

	it('groups files and documents by phase (phase outputs stay on their phase): files download, documents read inline', async () => {
		const long = 'L'.repeat(2000);
		const spy = route_fetch(
			run_detail({ artifacts: [
				{ artifact_id: 'rec:1', source: 'record', kind: 'output', content_preview: 'design done', phase: 'design', name: 'phase_output', description: null, mime_type: 'text/plain', size_bytes: 11, created_at: 1 },
				{ artifact_id: 'rec:2', source: 'record', kind: 'chat_transcript', content_preview: long, phase: 'build', name: 'transcript', description: null, mime_type: 'text/plain', size_bytes: 9000, created_at: 2 },
				{ artifact_id: 'a1', source: 'file', kind: 'file', content_preview: null, phase: 'build', name: 'app.zip', description: null, mime_type: 'application/zip', size_bytes: 4096, created_at: 3 },
			] }),
			{ '/v1/artifacts/get_by_id': () => ({ body: { ok: true, data: { content: 'the whole transcript' } } }) },
		);
		render_page();
		await ready();
		expect(screen.queryByTestId('artifact-phase-design')).toBeNull();
		const build = screen.getByTestId('artifact-phase-build');
		expect(within(build).getAllByTestId('artifact-row')).toHaveLength(2);
		expect(within(build).getByRole('button', { name: 'Download app.zip' })).toBeInTheDocument();

		fireEvent.click(within(build).getByRole('button', { name: 'Read transcript' }));
		await waitFor(() => expect(within(build).getByTestId('artifact-text')).toHaveTextContent('the whole transcript'));
		expect(calls(spy, '/v1/artifacts/get_by_id')).toEqual([{ artifact_id: 'rec:2' }]);
	});

	it('shows each phase output as a summary, opens it formatted, and keeps the raw output one click away', async () => {
		const raw = JSON.stringify({ text: '## Exec Results\n\nFAIL fetch (exit 1)', data: { total: '1', failed: '1', results: [{ name: 'fetch', pass: 'false', exit_code: '1', duration_ms: '20' }] } });
		route_fetch(run_detail({
			phase_outputs: [{
				artifact_id: 'rec:9', phase: 'fetch', created_at: 1, raw, complete: true,
				view: {
					kind: 'commands', summary: '1 of 1 command failed', body_markdown: null, steps: [], verdict: null, sources: [], sub_run: null,
					commands: { total: 1, failed: 1, items: [{ label: 'fetch', command: 'fetch', pass: false, exit_code: 1, duration_ms: 20 }] },
				},
			}],
			artifacts: [{ artifact_id: 'rec:10', source: 'record', kind: 'handoff', content_preview: 'use the cached ledger', phase: 'fetch', name: 'handoff', description: null, mime_type: 'text/plain', size_bytes: 21, created_at: 2 }],
		}));
		render_page();
		await ready();
		expect(screen.getByTestId('phase-output-summary')).toHaveTextContent('1 of 1 command failed');
		expect(screen.queryByTestId('phase-output')).toBeNull();

		fireEvent.click(screen.getByRole('button', { name: 'Show output of fetch' }));
		const panel = screen.getByTestId('phase-output');
		expect(within(panel).getByTestId('output-commands')).toHaveTextContent('exit 1');
		expect(within(panel).getByTestId('output-handoffs')).toHaveTextContent('use the cached ledger');

		fireEvent.click(within(panel).getByRole('button', { name: 'Raw' }));
		expect(within(panel).getByTestId('output-raw')).toHaveTextContent('"exit_code": "1"');
		expect(screen.getByRole('button', { name: 'Download raw outputs' })).toBeInTheDocument();
		// Handoffs are on their phase, not in Files.
		expect(screen.getByTestId('run-artifacts')).toHaveTextContent('No files in this run.');
	});

	it('links a sub-team phase to its sub-run', async () => {
		route_fetch(run_detail({
			phase_outputs: [{
				artifact_id: 'rec:11', phase: 'match', created_at: 1, raw: '{}', complete: true,
				view: {
					kind: 'sub_team', summary: 'Ran acme/ingest — 1 phase', body_markdown: null, steps: [], verdict: null, sources: [], commands: null,
					sub_run: { run_id: 'run-sub', team_ref: 'acme/ingest', phases: [{ phase: 'pull', ok: true, summary: '1 command passed' }] },
				},
			}],
		}));
		render_page();
		await ready();
		fireEvent.click(screen.getByRole('button', { name: 'Show output of match' }));
		expect(screen.getByRole('link', { name: 'open the sub-run' })).toHaveAttribute('href', expect.stringContaining('/runs/run-sub'));
	});

	it('says when files could not be loaded', async () => {
		const d = run_detail({ partial: true });
		d.sections.artifacts = { status: 'error', error: 'storage down' };
		route_fetch(d);
		render_page();
		await ready();
		expect(screen.getByTestId('run-artifacts')).toHaveTextContent('Couldn’t load files: storage down.');
	});

	it('renders phases in workflow order with errors, the run error and details', async () => {
		route_fetch(run_detail());
		render_page();
		await ready();
		const rows = screen.getAllByTestId('phase-row');
		expect(rows.map((r) => r.querySelector('.g-mono')?.textContent)).toEqual(['fetch', 'match']);
		expect(screen.getByText('ledger timeout')).toBeInTheDocument();
		expect(screen.getByTestId('run-error')).toHaveTextContent('Timeout talking to ledger');
		expect(screen.getByRole('link', { name: 'ledger' })).toHaveAttribute('href', '/o/measureone/realms/prod-us/workspaces/ws-1');
		expect(screen.getByRole('link', { name: 'd-1' })).toHaveAttribute('href', '/o/measureone/realms/prod-us/daemons/d-1');
		expect(screen.getByText('month')).toBeInTheDocument();
		expect(screen.queryByRole('link', { name: /Timeline & DAG/ })).toBeNull();
	});

	it.each([
		['running', ['Cancel']],
		['awaiting_input', ['Provide input', 'Cancel', 'Resume from…']],
		['failed', ['Resume from…', 'Run again']],
		['crashed', ['Resume from…', 'Run again']],
		['completed', ['Run again']],
		['cancelled', []],
	])('state %s shows actions %j', async (state, expected) => {
		route_fetch(run_detail({}, { state, error: null }));
		render_page();
		await ready();
		const group = screen.getByRole('group', { name: 'Run actions' });
		const labels = Array.from(group.querySelectorAll('button')).map((b) => b.textContent);
		expect(labels).toEqual(expected);
	});

	it('hides Run again when team_id is not scope/slug', async () => {
		route_fetch(run_detail({}, { state: 'completed', team_id: 'broken' }));
		render_page();
		await ready();
		expect(screen.queryByRole('button', { name: 'Run again' })).toBeNull();
	});

	it('supply inputs posts key=value pairs, shows a notice and reloads', async () => {
		const spy = route_fetch(run_detail({}, { state: 'awaiting_input', error: null }), { '/v1/runs/supply_inputs': () => ({ body: { ok: true } }) });
		render_page();
		await ready();
		fireEvent.click(screen.getByRole('button', { name: 'Provide input' }));
		const send = screen.getByRole('button', { name: 'Send & resume' });
		expect(send).toBeDisabled();
		fireEvent.change(screen.getByLabelText('Inputs'), { target: { value: 'employer_name=Acme Corp\n# skip\nbad line' } });
		fireEvent.click(send);
		expect(await screen.findByText('Inputs sent — the run should resume shortly.')).toBeInTheDocument();
		expect(calls(spy, '/v1/runs/supply_inputs')).toEqual([{ run_id: 'run-77', inputs: { employer_name: 'Acme Corp' } }]);
		expect(calls(spy, '/v1/run_detail/get').length).toBeGreaterThanOrEqual(2);
		expect(screen.queryByTestId('supply-panel')).toBeNull();
	});

	it.each([
		['hub_terminated', /marked cancelled on the Hub/],
		['already_terminal', /already finished/],
		['queued', /Cancel queued/],
	])('cancel mode %s → matching notice', async (mode, text) => {
		const spy = route_fetch(run_detail({}, { state: 'running', error: null }), { '/v1/runs/cancel': () => ({ body: { ok: true, data: { mode } } }) });
		render_page();
		await ready();
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		fireEvent.click(screen.getByRole('button', { name: 'Confirm cancel' }));
		expect(await screen.findByText(text)).toBeInTheDocument();
		expect(calls(spy, '/v1/runs/cancel')).toEqual([{ run_id: 'run-77' }]);
	});

	it('resume defaults to the failed phase and posts from_phase', async () => {
		const spy = route_fetch(run_detail(), { '/v1/runs/resume': () => ({ body: { ok: true } }) });
		render_page();
		await ready();
		fireEvent.click(screen.getByRole('button', { name: 'Resume from…' }));
		expect(screen.getByTestId('resume-select')).toHaveValue('match');
		fireEvent.change(screen.getByTestId('resume-select'), { target: { value: 'fetch' } });
		fireEvent.click(screen.getByRole('button', { name: 'Resume from fetch' }));
		expect(await screen.findByText(/Resume queued from 'fetch'/)).toBeInTheDocument();
		expect(calls(spy, '/v1/runs/resume')).toEqual([{ run_id: 'run-77', from_phase: 'fetch' }]);
	});

	it('stranded control error offers Run again, prefilled from this run', async () => {
		route_fetch(run_detail({}, { state: 'running', error: null }), {
			'/v1/runs/cancel': () => ({ status: 409, body: { ok: false, code: 'run/daemon_stranded', error: { code: 'run/daemon_stranded', message: 'Daemon gone for 2 days' } } }),
		});
		render_page();
		await ready();
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		fireEvent.click(screen.getByRole('button', { name: 'Confirm cancel' }));
		const alert = await screen.findByRole('alert');
		expect(alert).toHaveTextContent('Daemon gone for 2 days');
		fireEvent.click(screen.getByRole('button', { name: 'Run again' }));
		const dlg = screen.getByRole('dialog', { name: 'Run again' });
		expect(dlg).toHaveTextContent(`measureone/recon in ${REALM.id}`);
		expect(dlg).toHaveTextContent('"source_run_id":"run-77"');
		expect(dlg).toHaveTextContent('"run_name":"Nightly reconcile (rerun)"');
	});

	it('a plain control error has no Run again shortcut and can be dismissed', async () => {
		route_fetch(run_detail({}, { state: 'running', error: null }), {
			'/v1/runs/cancel': () => ({ status: 403, body: { ok: false, error: { code: 'forbidden', message: 'Viewers cannot cancel' } } }),
		});
		render_page();
		await ready();
		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		fireEvent.click(screen.getByRole('button', { name: 'Confirm cancel' }));
		expect(await screen.findByRole('alert')).toHaveTextContent('Viewers cannot cancel');
		expect(screen.queryByRole('button', { name: 'Run again' })).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));
		expect(screen.queryByText('Viewers cannot cancel')).toBeNull();
	});

	it('pending control disables the matching action and shows the outbox banner', async () => {
		route_fetch(run_detail({}, {
			state: 'running', error: null,
			pending_control: { tx_id: 't', endpoint: '/v1/cancel', enqueued_at: Date.now() - 60_000, attempts: 3, max_attempts: 8, delivered_at: null, last_error: 'ECONNREFUSED', ack_status: null },
		}));
		render_page();
		await ready();
		expect(screen.getByRole('button', { name: 'Cancel pending…' })).toBeDisabled();
		const banner = screen.getByTestId('pending-control-banner');
		expect(banner).toHaveTextContent('Cancel pending on daemon d-1');
		expect(banner).toHaveTextContent('3/8 delivery attempts');
		expect(banner).toHaveTextContent('ECONNREFUSED');
		expect(banner).toHaveTextContent(/isn’t answering/);
	});

	it('lost state: orphan banner wins, Resume hidden, Run again offered', async () => {
		route_fetch(run_detail({}, {
			state: 'failed', state_lost_at: Date.now(),
			pending_control: { tx_id: 't', endpoint: '/v1/resume', enqueued_at: 1, attempts: 0, max_attempts: 8, delivered_at: null, last_error: null, ack_status: null },
		}));
		render_page();
		await ready();
		expect(screen.getByTestId('orphaned-run-banner')).toBeInTheDocument();
		expect(screen.queryByTestId('pending-control-banner')).toBeNull();
		expect(screen.queryByRole('button', { name: /Resume/ })).toBeNull();
		expect(screen.getAllByRole('button', { name: 'Run again' }).length).toBeGreaterThan(0);
	});

	it('hub force-terminate banner shows attribution and reason', async () => {
		route_fetch(run_detail({}, {
			state: 'cancelled', error: null,
			force_terminate: { already_terminated: true, terminated_at: Date.now() - 120_000, terminated_by_user_id: 'u-9', terminated_reason: 'daemon offline', eligible: false, trigger: 'daemon_offline', blocker: null },
		}));
		render_page();
		await ready();
		const b = screen.getByTestId('force-terminated-banner');
		expect(b).toHaveTextContent('Cancelled on the Hub by user u-9');
		expect(b).toHaveTextContent('Reason: daemon offline');
	});

	it('pending review on this run links to the review', async () => {
		route_fetch(run_detail({ reviews: [{ id: 'rev-9', title: 'Approve match results', phase: 'gate', requested_at: Date.now() - 60_000, message: null }] }, { state: 'awaiting_input', error: null }));
		render_page();
		await ready();
		expect(screen.getByTestId('run-reviews-banner')).toHaveTextContent('Waiting on a review: Approve match results');
		expect(screen.getByRole('link', { name: 'Review' })).toHaveAttribute('href', '/reviews/rev-9');
	});

	it('partial composition names the missing sections', async () => {
		const d = run_detail({ partial: true });
		d.sections.labels = { status: 'error', error: 'x' };
		route_fetch(d);
		render_page();
		await ready();
		expect(screen.getByText(/Some details couldn’t be loaded \(labels\)/)).toBeInTheDocument();
	});

	it('?tab=logs deep-links to logs, which read get_logs for this run and realm', async () => {
		const spy = route_fetch(run_detail(), {
			'/v1/runs/get_logs': () => ({ body: { ok: true, lines: [{ id: 'l1', created_at: Date.now(), level: 'error', message: 'ledger timeout after 30s' }], total: 1 } }),
		});
		render_page('/o/measureone/realms/prod-us/runs/run-77?tab=logs');
		await ready();
		expect(screen.getByRole('tab', { name: 'Logs' })).toHaveAttribute('aria-selected', 'true');
		expect(await screen.findByText('ledger timeout after 30s')).toBeInTheDocument();
		expect(calls(spy, '/v1/runs/get_logs')[0]).toMatchObject({ realm_id: REALM.id, run_ids: ['run-77'], offset: 0 });
		fireEvent.click(screen.getByRole('button', { name: 'error' }));
		await waitFor(() => expect(calls(spy, '/v1/runs/get_logs').at(-1)).toMatchObject({ levels: ['error'] }));
		fireEvent.click(screen.getByRole('tab', { name: /Phases/ }));
		expect(screen.getByTestId('where')).not.toHaveTextContent('tab=logs');
	});

	it('logs include the sub-teams\' runs, tagged, and can be narrowed to one run', async () => {
		const child = { run_id: 'run-lld', run_name: 'lld-1', team_label: '@measureone/design-lld', parent_phase: 'design', state: 'failed', started_at: Date.now() - 60_000, completed_at: Date.now(), realm_slug: null, org_slug: null };
		const spy = route_fetch(run_detail({ children: [child] }), {
			'/v1/runs/get_logs': () => ({ body: { ok: true, total: 2, lines: [
				{ id: 'l2', run_id: 'run-lld', created_at: Date.now(), level: 'info', message: 'draft-lld started' },
				{ id: 'l1', run_id: 'run-77', created_at: Date.now() - 1000, level: 'info', message: 'design started' },
			] } }),
		});
		render_page('/o/measureone/realms/prod-us/runs/run-77?tab=logs');
		await ready();
		expect(await screen.findByText('draft-lld started')).toBeInTheDocument();
		expect(calls(spy, '/v1/runs/get_logs')[0]).toMatchObject({ run_ids: ['run-77', 'run-lld'] });
		expect(screen.getAllByTestId('log-source').map((t) => t.textContent)).toEqual(['⤷ design-lld']);
		fireEvent.click(screen.getByRole('button', { name: '⤷ design-lld' }));
		await waitFor(() => expect(calls(spy, '/v1/runs/get_logs').at(-1)).toMatchObject({ run_ids: ['run-lld'] }));
		fireEvent.click(screen.getByRole('button', { name: 'This run' }));
		await waitFor(() => expect(calls(spy, '/v1/runs/get_logs').at(-1)).toMatchObject({ run_ids: ['run-77'] }));
	});

	it('redirects to the run’s real realm when opened under another realm URL', async () => {
		route_fetch(run_detail({ realm: { id: 'r-x', slug: 'sandbox', name: 'Sandbox', org_slug: 'acme-labs' } }));
		render_page('/o/measureone/realms/prod-us/runs/run-77');
		await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/o/acme-labs/realms/sandbox/runs/run-77'));
	});

	it('404 → not-found state', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
			if (String(url) === '/v1/overview/get') return new Response(JSON.stringify({ ok: true, data: overview_for_realm() }));
			if (String(url) === '/v1/getting_started/get') return gs_response(url)!;
			return new Response(JSON.stringify({ ok: false, error: { code: 'not_found', message: 'Run not found' } }), { status: 404 });
		});
		render_page();
		expect(await screen.findByText('This run doesn’t exist')).toBeInTheDocument();
	});

	it('polls every 4s while live and 20s once finished', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		let state = 'running';
		const spy = route_fetch(() => run_detail({}, { state, error: null }));
		render_page();
		await ready();
		const n0 = calls(spy, '/v1/run_detail/get').length;
		await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_POLL_MS + 10); });
		expect(calls(spy, '/v1/run_detail/get').length).toBe(n0 + 1);
		state = 'completed';
		await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_POLL_MS + 10); });
		const n1 = calls(spy, '/v1/run_detail/get').length;
		await act(async () => { await vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 2); });
		expect(calls(spy, '/v1/run_detail/get').length).toBe(n1);
		await act(async () => { await vi.advanceTimersByTimeAsync(IDLE_POLL_MS); });
		expect(calls(spy, '/v1/run_detail/get').length).toBe(n1 + 1);
	});
});

describe('Graphite run detail — run history', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	const H = 3_600_000;
	const design_phases = () => {
		const now = Date.now();
		return [
			{ phase: 'plan', status: 'completed', sequence: 0, started_at: now - 21 * H, completed_at: now - 20.5 * H, error: null, agent: 'planner', attempts: 1, previous_attempts: [] },
			{ phase: 'design', status: 'failed', sequence: 1, started_at: now - 20.5 * H, completed_at: now - 20 * H, error: 'sub-team run @measureone/design-lld failed', agent: null, attempts: 1, previous_attempts: [] },
		];
	};

	it('shows nothing extra for a run with one attempt', async () => {
		route_fetch(run_detail({ attempts: [{ n: 1, started_at: Date.now() - 600_000, from_phase: null, ended_at: Date.now() - 60_000, state: 'failed', failed_phase: 'match', error: null }], attempts_source: 'events', parent: null, children: [] }));
		render_page();
		await ready();
		expect(screen.queryByTestId('attempts-strip')).toBeNull();
		expect(screen.queryByTestId('parent-run')).toBeNull();
		expect(screen.queryByRole('region', { name: 'Sub-team runs' })).toBeNull();
	});

	it('shows the attempts strip for a resumed run: failed at a phase → resumed from it → completed', async () => {
		const now = Date.now();
		route_fetch(run_detail({
			attempts: [
				{ n: 1, started_at: now - 21 * H, from_phase: null, ended_at: now - 20 * H, state: 'failed', failed_phase: 'design', error: 'sub-team failed' },
				{ n: 2, started_at: now - 19 * H, from_phase: 'design', ended_at: now - 18 * H, state: 'completed', failed_phase: null, error: null, resumed_by: { username: 'sapan', display_name: 'Sapan Shah' } },
			],
			attempts_source: 'events',
		}, { state: 'completed', error: null }));
		render_page();
		await ready();
		const strip = screen.getByTestId('attempts-strip');
		expect(strip).toHaveTextContent('2 attempts');
		const items = within(strip).getAllByTestId('attempt');
		expect(items[0]).toHaveTextContent('Attempt 1 · failed at design · 20h ago');
		expect(items[1]).toHaveTextContent('Attempt 2 · completed');
		expect(within(strip).getByTestId('attempt-resume')).toHaveTextContent('Resumed from design by Sapan Shah · 19h ago');
		expect(strip).not.toHaveTextContent('from phase history');
	});

	it('a run that ran but whose daemon record is gone says so (not "no daemon assigned")', async () => {
		route_fetch(run_detail({}, { daemon_id: null, started_at: Date.now() - H }));
		render_page();
		await ready();
		expect(screen.getByText('daemon no longer registered')).toBeInTheDocument();
		expect(screen.queryByText('no daemon assigned')).toBeNull();
	});

	it('says when the attempts were worked out from phase history', async () => {
		route_fetch(run_detail({
			attempts: [
				{ n: 1, started_at: 1, from_phase: null, ended_at: 2, state: 'failed', failed_phase: 'match', error: null },
				{ n: 2, started_at: 3, from_phase: 'match', ended_at: null, state: 'running', failed_phase: null, error: null },
			],
			attempts_source: 'phases',
		}, { state: 'running', completed_at: null, error: null }));
		render_page();
		await ready();
		expect(screen.getByTestId('attempts-strip')).toHaveTextContent('from phase history');
		expect(within(screen.getByTestId('attempts-strip')).getAllByTestId('attempt')[1]).toHaveTextContent('Attempt 2 · running');
	});

	it('a sub-team run links back to the run and phase that spawned it', async () => {
		route_fetch(run_detail({ parent: { run_id: 'run-kf', run_name: 'kind-fern', phase: 'design', state: 'failed', realm_slug: 'prod-us', org_slug: 'measureone' } }));
		render_page();
		await ready();
		const parent = screen.getByTestId('parent-run');
		expect(parent).toHaveTextContent('kind-fern›design');
		expect(within(parent).getByRole('link', { name: 'kind-fern' })).toHaveAttribute('href', '/o/measureone/realms/prod-us/runs/run-kf');
	});

	it('lists the sub-team runs (failed ones too) in Details and on their phase, linked', async () => {
		const now = Date.now();
		route_fetch(run_detail({
			phases: design_phases(),
			children: [{ run_id: 'run-lld', run_name: 'lld-1', team_label: '@measureone/design-lld', parent_phase: 'design', state: 'failed', started_at: now - 20.4 * H, completed_at: now - 20 * H, realm_slug: null, org_slug: null }],
		}));
		render_page();
		await ready();
		const kids = within(screen.getByRole('region', { name: 'Sub-team runs' })).getAllByTestId('child-run');
		expect(kids).toHaveLength(1);
		expect(kids[0]).toHaveTextContent('lld-1');
		expect(kids[0]).toHaveTextContent('phase design · @measureone/design-lld');
		expect(within(kids[0]).getByRole('link', { name: 'lld-1' })).toHaveAttribute('href', '/o/measureone/realms/prod-us/runs/run-lld');
		const on_phase = screen.getByTestId('phase-child-run');
		expect(within(on_phase).getByRole('link', { name: 'lld-1' })).toHaveAttribute('href', '/o/measureone/realms/prod-us/runs/run-lld');
		expect(screen.queryByTestId('child-succeeded-later')).toBeNull();
	});

	it('flags a failed team phase whose sub-team run succeeded later, and offers resume from that phase', async () => {
		const now = Date.now();
		route_fetch(run_detail({
			phases: design_phases(),
			children: [{ run_id: 'run-lld', run_name: 'lld-1', team_label: '@measureone/design-lld', parent_phase: 'design', state: 'completed', started_at: now - 20.4 * H, completed_at: now - 2 * H, realm_slug: 'prod-us', org_slug: 'measureone' }],
		}));
		render_page();
		await ready();
		const note = screen.getByTestId('child-succeeded-later');
		expect(note).toHaveTextContent('Sub-team run lld-1 succeeded later, but this run is still failed. Resume it from design to continue.');
		fireEvent.click(within(note).getByRole('button', { name: 'Resume from design' }));
		expect(screen.getByTestId('resume-select')).toHaveValue('design');
	});

	it('shows earlier attempts of a phase compactly with "ran N×"', async () => {
		const now = Date.now();
		const phases = design_phases();
		phases[1] = { ...phases[1]!, attempts: 2, previous_attempts: [{ attempt: 0, status: 'failed', started_at: now - 30 * H, completed_at: now - 29 * H, error: 'first try' } as never] };
		route_fetch(run_detail({ phases }));
		render_page();
		await ready();
		const rows = screen.getAllByTestId('phase-row');
		const design = rows.find((r) => r.textContent?.includes('design'))!;
		expect(design).toHaveTextContent('ran 2×');
		expect(within(design).getByTestId('phase-earlier-attempts')).toHaveTextContent('earlier:failed29h ago');
	});
});

